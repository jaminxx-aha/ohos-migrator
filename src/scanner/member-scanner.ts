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
  const desc: MemberReplacement = ov
    ? { newSymbol: ov.replacement, rule: "override", note: ov.note, replacement: ov.replacement }
    : describeMemberReplacement(binding, e.dep.kit, members, e.repl);
  const needsManual = desc.rule === "manual";
  const finding: Finding = {
    file: fileRel,
    line: lineAt(content, offset),
    oldSymbol,
    newSymbol: desc.newSymbol,
    since: e.since,
    rule: desc.rule,
    needsManual,
    note: desc.note,
  };
  // Override and rename-member both splice replacement text at the match offsets.
  if (desc.replacement) {
    finding.matchStart = offset;
    finding.matchEnd = matchEnd;
    finding.replacement = desc.replacement;
  }
  return finding;
}

export interface MemberReplacement {
  newSymbol: string | null;
  rule: Finding["rule"];
  note: string;
  /** Exact text to splice at matchStart..matchEnd, when auto-fixable. */
  replacement?: string;
}

/**
 * Classify a deprecated member's replacement.
 *
 * - Same-kit rename (repl.kit absent, or repl.kit === dep.kit) on a flat
 *   single-segment member is auto-fixable: the matched `binding.<member>` only
 *   needs its leaf changed -> `rename-member`.
 * - Any other cross-kit target is `manual` (requires wiring changes). A
 *   multi-segment replacement chain with no resolved kit is a parse artifact
 *   (the kit prefix wasn't recognised) and is treated as `manual` rather than
 *   silently producing a wrong same-kit rewrite.
 */
export function describeMemberReplacement(
  binding: string,
  depKit: string,
  depMembers: string[],
  repl: ReplSymbol | null,
): MemberReplacement {
  if (!repl || !repl.members || repl.members.length === 0) {
    return { newSymbol: null, rule: "manual", note: "no @useinstead replacement" };
  }
  const leaf = repl.members[repl.members.length - 1];
  const sameKit = !repl.kit || repl.kit === depKit;
  const flat = depMembers.length === 1;
  // A bare @useinstead with no resolved kit is only trustworthy as a single
  // segment; a multi-segment chain without a kit is a parse artifact.
  const trustworthy = repl.kit ? true : repl.members.length === 1;
  // No-op: the replacement leaf matches the deprecated leaf (e.g. an API kept
  // under the same name but flagged for removal). Splicing an identical symbol
  // would be a confusing no-op diff; report it for review instead.
  const isNoOp = flat && leaf === depMembers[depMembers.length - 1];
  if (isNoOp) {
    return {
      newSymbol: `${binding}.${leaf}`,
      rule: "manual",
      note: "replacement identical to deprecated symbol (review needed)",
    };
  }
  if (sameKit && flat && trustworthy) {
    const replacement = `${binding}.${leaf}`;
    return {
      newSymbol: replacement,
      rule: "rename-member",
      note: `rename member -> ${leaf}`,
      replacement,
    };
  }
  if (repl.kit) {
    return {
      newSymbol: `${repl.kit}/${repl.members.join(".")}`,
      rule: "manual",
      note: `cross-kit replacement -> ${repl.kit} (requires wiring changes)`,
    };
  }
  return {
    newSymbol: repl.members.join("."),
    rule: "manual",
    note: "unresolved replacement chain (kit not resolved)",
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
