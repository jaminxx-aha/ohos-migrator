/**
 * Scanner: walk a project, extract imports, match against the deprecation map.
 *
 * MVP scope = import-level (module) matching. A file that imports a kit present
 * in `kitIndex` yields one finding per import:
 *   - `kitIndex[spec].newKit` set  -> `rewrite-import` (safe auto-fix)
 *   - `kitIndex[spec].manual` true -> `manual` (report only)
 *
 * Member-level detection (specific deprecated methods/properties) is phase 2
 * and requires AST parsing of `.ts`; not done here.
 */

import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { walkFiles } from "../walk.js";
import { extractImports, type ImportInfo } from "./import-extractor.js";
import type { DeprecationMap, Finding } from "../rules/types.js";

const IGNORE_DIRS = new Set([
  "node_modules",
  "oh_modules",
  ".preview",
  "build",
  ".cxx",
  ".test",
]);

export interface ScanOptions {
  projectRoot: string;
  map: DeprecationMap;
  /** Only report deprecations with `since <= since` (0 = no filter). */
  since?: number;
}

export interface ScanResult {
  findings: Finding[];
  filesScanned: number;
}

export function scanProject(opts: ScanOptions): ScanResult {
  const { projectRoot, map } = opts;
  const since = opts.since ?? 0;
  const files = collectSourceFiles(projectRoot);
  const findings: Finding[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const imp of extractImports(content)) {
      const kitInfo = map.kitIndex[imp.specifier];
      if (!kitInfo) continue;
      if (since && kitInfo.since > since) continue;
      findings.push(toFinding(file, projectRoot, imp, kitInfo));
    }
  }

  return { findings, filesScanned: files.length };
}

function toFinding(
  file: string,
  projectRoot: string,
  imp: ImportInfo,
  kitInfo: { since: number; newKit?: string; manual?: boolean },
): Finding {
  const fileRel = relative(projectRoot, file).split(sep).join("/");
  if (kitInfo.newKit) {
    return {
      file: fileRel,
      line: imp.line,
      oldSymbol: imp.specifier,
      newSymbol: kitInfo.newKit,
      since: kitInfo.since,
      rule: "rewrite-import",
      needsManual: false,
      note: `kit moved -> rewrite import specifier to ${kitInfo.newKit}`,
    };
  }
  return {
    file: fileRel,
    line: imp.line,
    oldSymbol: imp.specifier,
    newSymbol: null,
    since: kitInfo.since,
    rule: "manual",
    needsManual: true,
    note: `deprecated since ${kitInfo.since} with no @useinstead replacement`,
  };
}

function collectSourceFiles(projectRoot: string): string[] {
  return walkFiles(projectRoot, {
    extensions: [".ts", ".ets"],
    ignoreDirs: IGNORE_DIRS,
  });
}

/**
 * Export-rename scanner: finds named imports of a deprecated same-kit export
 * whose name moved (e.g. `import { By } from '@ohos.UiTest'` where `By` -> `On`).
 *
 * Each finding rewrites the imported-name token in the import clause. To keep
 * the local binding valid without touching every reference, a no-alias import
 * `{ By }` becomes `{ On as By }` (import the new name, alias to the old local
 * so `By.text`, `new By()`, and `x: By` all resolve to `On`); an aliased
 * `import { By as B }` becomes `import { On as B }` (the `as B` stays).
 *
 * No body rewrite is needed — the alias preserves the local binding.
 */
export function scanProjectExportRenames(opts: ScanOptions): ScanResult {
  const { projectRoot, map } = opts;
  const since = opts.since ?? 0;
  const exportIndex = map.exportIndex ?? {};
  const files = collectSourceFiles(projectRoot);
  const findings: Finding[] = [];
  const sinceForExport: Record<string, number> = {}; // kit\0old -> since

  for (const e of map.entries) {
    if (!e.dep.members?.length && e.dep.exportName && !e.dep.members?.length) {
      const key = `${e.dep.kit}\0${e.dep.exportName}`;
      if (exportIndex[key] === e.repl?.members?.[0]) {
        sinceForExport[key] = Math.min(sinceForExport[key] ?? Infinity, e.since);
      }
    }
  }

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const fileRel = relative(projectRoot, file).split(sep).join("/");
    for (const imp of extractImports(content)) {
      for (const b of imp.bindings) {
        if (b.nameStart == null || b.nameEnd == null) continue; // not a named import
        const key = `${imp.specifier}\0${b.imported}`;
        const newExport = exportIndex[key];
        if (!newExport || newExport === b.imported) continue;
        const depSince = sinceForExport[key] ?? 0;
        if (since && depSince > since) continue;
        // Preserve the local binding: no-alias -> `New as Local`; aliased -> `New`.
        const replacement =
          b.local === b.imported ? `${newExport} as ${b.local}` : newExport;
        findings.push({
          file: fileRel,
          line: lineAtOffset(content, b.nameStart),
          oldSymbol: b.imported,
          newSymbol: newExport,
          since: depSince,
          rule: "rename-export",
          needsManual: false,
          note: `rename export ${b.imported} -> ${newExport}` +
            (b.local === b.imported ? " (aliased to preserve local binding)" : ""),
          matchStart: b.nameStart,
          matchEnd: b.nameEnd,
          replacement,
        });
      }
    }
  }

  return { findings, filesScanned: files.length };
}

function lineAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Cross-kit named-import drop-in: rewrite a named-import clause's specifier
 * when every binding in the clause is an export that moved to another kit
 * *under the same name* (e.g. `import { RouterOptions } from '@system.router'`
 * -> `from '@ohos.router'`, because `@system.router.RouterOptions` ->
 * `@ohos.router.RouterOptions`). Per-clause: a mixed clause or one containing
 * a removed export (no drop-in target) is left untouched so nothing breaks.
 *
 * Kits with an indexed module-level move are skipped — `scanProject` already
 * rewrites their specifier wholesale.
 */
export function scanProjectCrossKitDropin(opts: ScanOptions): ScanResult {
  const { projectRoot, map } = opts;
  const since = opts.since ?? 0;
  const dropin = map.crossKitDropin ?? {};
  const files = collectSourceFiles(projectRoot);
  const findings: Finding[] = [];

  // `kit\0export` -> since (min over entries), for the --since filter.
  const sinceFor: Record<string, number> = {};
  for (const e of map.entries) {
    if (!e.dep.members?.length && e.dep.exportName) {
      const key = `${e.dep.kit}\0${e.dep.exportName}`;
      if (dropin[key] === e.repl?.kit && e.repl?.members?.[0] === e.dep.exportName) {
        sinceFor[key] = Math.min(sinceFor[key] ?? Infinity, e.since);
      }
    }
  }

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const fileRel = relative(projectRoot, file).split(sep).join("/");
    for (const imp of extractImports(content)) {
      const named = imp.bindings.filter((b) => b.nameStart != null && b.nameEnd != null);
      if (named.length === 0) continue;
      let target: string | undefined;
      let depSince = 0;
      let ok = true;
      for (const b of named) {
        const t = dropin[`${imp.specifier}\0${b.imported}`];
        if (!t) { ok = false; break; }
        const s = sinceFor[`${imp.specifier}\0${b.imported}`] ?? 0;
        if (since && s > since) { ok = false; break; }
        if (target && t !== target) { ok = false; break; } // mixed targets
        target = t;
        depSince = Math.max(depSince, s);
      }
      if (!ok || !target || target === imp.specifier) continue;
      findings.push({
        file: fileRel,
        line: imp.line,
        oldSymbol: imp.specifier,
        newSymbol: target,
        since: depSince,
        rule: "rewrite-import",
        needsManual: false,
        note: `cross-kit drop-in -> rewrite specifier to ${target} (${named.length} binding${named.length > 1 ? "s" : ""})`,
      });
    }
  }

  return { findings, filesScanned: files.length };
}
