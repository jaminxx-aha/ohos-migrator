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
