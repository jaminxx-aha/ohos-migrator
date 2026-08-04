/**
 * Member-level deprecation scanner.
 *
 * The module-level scanner catches whole-kit moves (import rewrites). Many
 * real deprecations, however, are individual functions/methods/properties/
 * enum-members inside a kit that is *not* itself deprecated (e.g.
 * `router.push` since 9, `router.pushUrl` since 18, `window.WindowType.*`).
 *
 * We resolve these tolerantly (no full AST — ArkUI `.ets` can't be parsed by
 * tsc): build a per-file `local-binding -> kit` map from imports, then for
 * each deprecated member entry whose kit the file imports, search the source
 * for `<binding>.<member-chain>` via regex.
 *
 * Precision: binding resolution from imports keeps false positives low, but
 * shadowing is possible. This is a *scan report* — humans review findings.
 */

import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { walkFiles } from "../walk.js";
import { findMemberOverride } from "../rewriter/overrides.js";
import type { DeprecationEntry, DeprecationMap, Finding, ReplSymbol } from "../rules/types.js";

/** Binding -> the kit specifier it was imported from. */
type BindingMap = Map<string, string>;

export interface MemberScanOptions {
  projectRoot: string;
  map: DeprecationMap;
  since?: number;
  /** Runtime expression yielding a UIContext, for cross-kit overrides. */
  uiContextExpr?: string;
}

/** Per-kit index of deprecated members (entries that have a member chain). */
export interface MemberIndex {
  [kit: string]: DeprecationEntry[];
}

export function buildMemberIndex(map: DeprecationMap): MemberIndex {
  const idx: MemberIndex = {};
  for (const e of map.entries) {
    if (!e.dep.members || e.dep.members.length === 0) continue;
    (idx[e.dep.kit] ??= []).push(e);
  }
  return idx;
}

export interface MemberScanResult {
  findings: Finding[];
  filesScanned: number;
}

export function scanProjectMembers(opts: MemberScanOptions): MemberScanResult {
  const { projectRoot, map } = opts;
  const since = opts.since ?? 0;
  const uiContextExpr = opts.uiContextExpr ?? "this.getUIContext()";
  const memberIndex = buildMemberIndex(map);
  const files = walkFiles(projectRoot, { extensions: [".ts", ".ets"] });
  const findings: Finding[] = [];
  // Dedupe by (file, line, oldSymbol): the SDK often has several deprecated
  // entries for the same symbol (overloads / repeated @useinstead), which
  // would otherwise emit duplicate findings for one call site. Prefer an
  // auto-fixable rename-member over a manual one.
  const dedupe = new Map<string, Finding>();

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const bindings = extractBindingMap(content);
    for (const [binding, kit] of bindings) {
      const entries = memberIndex[kit];
      if (!entries) continue;
      for (const e of entries) {
        if (since && e.since > since) continue;
        const members = e.dep.members!;
        const pattern = binding + "\\." + members.map(escapeRe).join("\\.");
        const re = new RegExp(`\\b${pattern}\\b`, "g");
        for (const m of content.matchAll(re)) {
          if (m.index === undefined) continue;
          const matchEnd = m.index + m[0].length;
          const f = memberFinding(
            file, projectRoot, m.index, matchEnd, content, binding, members, e, uiContextExpr,
          );
          const key = `${f.file}:${f.line}:${f.oldSymbol}`;
          const prev = dedupe.get(key);
          if (!prev || (prev.needsManual && !f.needsManual)) dedupe.set(key, f);
        }
      }
    }
  }

  return { findings: [...dedupe.values()], filesScanned: files.length };
}

function memberFinding(
  file: string,
  projectRoot: string,
  offset: number,
  matchEnd: number,
  content: string,
  binding: string,
  members: string[],
  e: DeprecationEntry,
  uiContextExpr: string,
): Finding {
  const fileRel = relative(projectRoot, file).split(sep).join("/");
  const oldSymbol = `${binding}.${members.join(".")}`;
  const ov = findMemberOverride(e.dep.kit, members, e.repl, uiContextExpr);
  const { newSymbol, rule, note } = ov
    ? { newSymbol: ov.replacement as string, rule: "override" as const, note: ov.note }
    : describeMemberReplacement(binding, e.repl);
  const needsManual = rule === "manual";
  const finding: Finding = {
    file: fileRel,
    line: lineAt(content, offset),
    oldSymbol,
    newSymbol,
    since: e.since,
    rule,
    needsManual,
    note,
  };
  if (ov) {
    finding.matchStart = offset;
    finding.matchEnd = matchEnd;
    finding.replacement = ov.replacement;
  }
  return finding;
}

export function describeMemberReplacement(
  binding: string,
  repl: ReplSymbol | null,
): { newSymbol: string | null; rule: Finding["rule"]; note: string } {
  if (!repl || !repl.members || repl.members.length === 0) {
    return { newSymbol: null, rule: "manual", note: "no @useinstead replacement" };
  }
  const leaf = repl.members[repl.members.length - 1];
  if (repl.kit) {
    // Cross-kit: architectural change (e.g. router.pushUrl -> UIContext.Router.pushUrl).
    return {
      newSymbol: `${repl.kit}/${repl.members.join(".")}`,
      rule: "manual",
      note: `cross-kit replacement -> ${repl.kit} (requires UIContext wiring)`,
    };
  }
  // Same-kit member rename: auto-fixable later (rename property access).
  return {
    newSymbol: `${binding}.${leaf}`,
    rule: "rename-member",
    note: `rename member -> ${leaf}`,
  };
}

/** Build local-binding -> kit map, handling default / namespace / named imports. */
export function extractBindingMap(content: string): BindingMap {
  const map: BindingMap = new Map();
  const re =
    /import\s+(?:type\s+)?(?:(\*\s+as\s+([A-Za-z_$][\w$]*))|(\{[^}]*\})|([A-Za-z_$][\w$]*))\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(re)) {
    const spec = m[5];
    if (m[2]) {
      // `import * as X from '...'`
      map.set(m[2], spec);
    } else if (m[3]) {
      // `import { a, b as c } from '...'`
      for (const part of m[3].slice(1, -1).split(",")) {
        const t = part.trim();
        const asM = t.match(/^(\w+)\s+as\s+(\w+)$/);
        map.set(asM ? asM[2] : t, spec);
      }
    } else if (m[4]) {
      // `import X from '...'` (default/namespace binding)
      map.set(m[4], spec);
    }
  }
  return map;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}
