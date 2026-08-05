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
  /** Runtime expression yielding a WindowStage (window recipe). */
  windowStageExpr?: string;
  /** Runtime expression yielding a Window (window recipe). */
  windowExpr?: string;
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
  const ctx = {
    uiContextExpr: opts.uiContextExpr ?? "this.getUIContext()",
    windowStageExpr: opts.windowStageExpr ?? "this.windowStage",
    windowExpr: opts.windowExpr ?? "this.window",
  };
  // Resolve a deprecated kit's indexed module move. A cross-kit member whose
  // replacement kit lines up with this move is "effectively same-kit": the
  // rewrite-import step re-points the binding, so the member is reached on the
  // same binding (no member-level splice needed when the chain is unchanged).
  const kitMove: KitMoveResolver = (k) => map.kitIndex[k]?.newKit;
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
    const exportIndex = map.exportIndex ?? {};
    for (const [binding, kit] of bindings) {
      const entries = memberIndex[kit];
      if (!entries) continue;
      for (const e of entries) {
        if (since && e.since > since) continue;
        // If this member's enclosing export is itself same-kit renamed
        // (e.g. `By.text` where `By` -> `On`), the rename-export rule already
        // aliases the import so `By.text` resolves to `On.text`. Skip the
        // redundant member finding to avoid double-reporting / a wrong splice.
        if (e.dep.exportName && exportIndex[`${kit}\0${e.dep.exportName}`]) continue;
        const members = e.dep.members!;
        const pattern = binding + "\\." + members.map(escapeRe).join("\\.");
        const re = new RegExp(`\\b${pattern}\\b`, "g");
        for (const m of content.matchAll(re)) {
          if (m.index === undefined) continue;
          const matchEnd = m.index + m[0].length;
          const f = memberFinding(
            file, projectRoot, m.index, matchEnd, content, binding, members, e, ctx, kitMove,
          );
          // Suppressed members are covered by another rule (e.g. an aligned
          // kit move) — emit no finding for them.
          if (!f) continue;
          const key = `${f.file}:${f.line}:${f.oldSymbol}`;
          const prev = dedupe.get(key);
          if (!prev || (prev.needsManual && !f.needsManual)) dedupe.set(key, f);
        }
      }
    }
  }

  // Drop findings whose match span is subsumed by a longer match at the same
  // call site. The SDK marks both a class rename (`rpc.MessageParcel` ->
  // `rpc.MessageSequence`) and its members (`rpc.MessageParcel.create` ->
  // `rpc.MessageSequence.create`); both regex-match the same source span and
  // would double-report / produce overlapping rewriter edits. Keep the longer
  // (more specific) match per span.
  const deduped = dedupeOverlappingSpans([...dedupe.values()]);
  return { findings: deduped, filesScanned: files.length };
}

/**
 * Keep the longest member finding per overlapping match span (per file).
 * Findings without a match span (e.g. manual / rewrite-import) pass through.
 */
function dedupeOverlappingSpans(findings: Finding[]): Finding[] {
  const withSpan = findings.filter(
    (f): f is Finding & { matchStart: number; matchEnd: number } =>
      f.matchStart != null && f.matchEnd != null,
  );
  const without = findings.filter((f) => f.matchStart == null || f.matchEnd == null);
  // Group by file, sort longest-first, drop any whose span overlaps a kept one.
  const byFile = new Map<string, Array<Finding & { matchStart: number; matchEnd: number }>>();
  for (const f of withSpan) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }
  const kept: Finding[] = [...without];
  for (const arr of byFile.values()) {
    const sorted = [...arr].sort((a, b) => a.matchStart - b.matchStart || b.matchEnd - a.matchEnd);
    let lastEnd = -1;
    for (const f of sorted) {
      if (f.matchStart < lastEnd) continue; // overlaps a kept (longer) span
      kept.push(f);
      lastEnd = f.matchEnd;
    }
  }
  return kept;
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
  ctx: { uiContextExpr: string; windowStageExpr: string; windowExpr: string },
  kitMove: KitMoveResolver,
): Finding | null {
  const fileRel = relative(projectRoot, file).split(sep).join("/");
  const oldSymbol = `${binding}.${members.join(".")}`;
  const ov = findMemberOverride(e.dep.kit, members, e.repl, ctx);
  const desc: MemberReplacement = ov
    ? { newSymbol: ov.replacement, rule: "override", note: ov.note, replacement: ov.replacement }
    : describeMemberReplacement(binding, e.dep.kit, members, e.repl, kitMove);
  // Suppressed: the call site is covered by another rule (e.g. an aligned kit
  // move via rewrite-import). Emit no finding.
  if (desc.suppressed) return null;
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
  /**
   * True when the member call site is already covered by another rule and
   * should NOT yield a finding. Set when the member's replacement kit equals
   * the deprecated kit's indexed move target AND the member chain is unchanged
   * — `rewrite-import` re-points the binding to the new kit, so
   * `binding.<chain>` resolves on the new kit without a member-level splice.
   */
  suppressed?: boolean;
}

/**
 * Optional resolver: returns the new kit for a deprecated kit that has a safe
 * module-level move (`kitIndex[dep.kit].newKit`), or undefined. Threading this
 * in lets `describeMemberReplacement` treat a cross-kit replacement whose kit
 * matches the deprecated kit's move target as "effectively same-kit": once
 * `rewrite-import` re-points the binding, the member lives on the same binding.
 */
export type KitMoveResolver = (depKit: string) => string | undefined;

/**
 * Classify a deprecated member's replacement.
 *
 * - Same-kit rename (repl.kit absent, or repl.kit === dep.kit) on a same-length
 *   chain is auto-fixable: the matched `binding.<dep chain>` is spliced to
 *   `binding.<repl chain>` -> `rename-member`. This covers a leaf-only rename
 *   (`router.push` -> `router.pushUrl`), a container/mid-segment rename
 *   (`rpc.MessageParcel.create` -> `rpc.MessageSequence.create`), or both
 *   (`media.MediaErrorCode.MSERR_OK` -> `media.AVErrorCode.AVERR_OK`). When the
 *   full chain is identical the replacement is a no-op (self-referential) and is
 *   flagged for review.
 * - A cross-kit replacement whose `repl.kit` equals the deprecated kit's
 *   indexed move target (`kitMove(dep.kit) === repl.kit`) is treated as
 *   same-kit too: `rewrite-import` re-points the binding to `repl.kit`, so the
 *   member is reached on the same binding. Same rules then apply (suppress on a
 *   no-op, `rename-member` on a same-length chain change).
 * - Any other cross-kit target is `manual` (requires wiring changes). A
 *   multi-segment replacement chain with no resolved kit is a parse artifact
 *   (the kit prefix wasn't recognised) and is treated as `manual` rather than
 *   silently producing a wrong same-kit rewrite. A replacement chain whose
 *   length differs from the deprecated chain is also `manual` — the call shape
 *   changed (e.g. an instance method becoming a namespace function), which a
 *   text splice cannot express.
 */
export function describeMemberReplacement(
  binding: string,
  depKit: string,
  depMembers: string[],
  repl: ReplSymbol | null,
  kitMove?: KitMoveResolver,
): MemberReplacement {
  if (!repl || !repl.members || repl.members.length === 0) {
    return { newSymbol: null, rule: "manual", note: "no @useinstead replacement" };
  }
  const rMembers = repl.members;
  // A cross-kit target that lines up with the deprecated kit's indexed module
  // move is "effectively same-kit": the import rewrite re-points the binding.
  const aligned = !!(repl.kit && kitMove && kitMove(depKit) === repl.kit);
  const sameKit = !repl.kit || repl.kit === depKit || aligned;
  // A bare @useinstead with no resolved kit is only trustworthy as a single
  // segment; a multi-segment chain without a kit is a parse artifact.
  const trustworthy = repl.kit ? true : rMembers.length === 1;
  // The replacement is a same-length chain splice only when the shapes match.
  const sameLength = depMembers.length > 0 && depMembers.length === rMembers.length;
  const chainEqual = sameLength && depMembers.every((x, i) => x === rMembers[i]);
  const isNoOp = sameKit && chainEqual;
  if (isNoOp) {
    // If the chain is unchanged AND the kit is moved to exactly this
    // replacement kit, `rewrite-import` already migrates every call site of
    // this binding — the member finding is redundant. Suppress it.
    if (aligned) {
      return {
        newSymbol: `${binding}.${rMembers.join(".")}`,
        rule: "manual",
        note: "covered by kit move (rewrite-import re-points the binding)",
        suppressed: true,
      };
    }
    return {
      newSymbol: `${binding}.${rMembers.join(".")}`,
      rule: "manual",
      note: "replacement identical to deprecated symbol (review needed)",
    };
  }
  // Same-kit (or kit-move-aligned) chain rename at any depth. The matched
  // `binding.<dep chain>` is spliced to `binding.<repl chain>`. Requires a
  // resolved kit (trustworthy) for multi-segment chains to avoid parse
  // artifacts, and equal lengths so the call shape is preserved.
  if (sameKit && trustworthy && sameLength) {
    const chain = rMembers.join(".");
    const replacement = `${binding}.${chain}`;
    return {
      newSymbol: replacement,
      rule: "rename-member",
      note: `rename member -> ${chain}` +
        (aligned ? " (after kit move re-points the binding)" : ""),
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

/* ------------------------------------------------------------------ */
/* Instance-method scanner — resolves typed local variables as the    */
/* receiver (e.g. `let r: resourceManager.ResourceManager; r.getString()`),*/
/* which the binding-only scanner above cannot see.                   */
/* ------------------------------------------------------------------ */

/** A typed variable resolved to its declaring kit + the type's head name. */
export interface TypedVar {
  kit: string;
  /** The type name segment used to key the instance index. */
  typeHead: string;
}

/**
 * Resolve a type expression (from a `let v: <expr>` or param annotation) to
 * `(kit, typeHead)` using the import binding->kit map.
 *   - Qualified `ns.Type`  -> kit of the `ns` binding, typeHead `Type`.
 *   - Simple `T`           -> kit of the `T` named-import binding, typeHead `T`.
 * Deeper qualified names (`a.b.c`), generics, and unions are not inferred.
 */
function resolveType(
  typeExpr: string,
  bindingKit: BindingMap,
): TypedVar | undefined {
  const parts = typeExpr.split(".");
  if (parts.length === 1) {
    const kit = bindingKit.get(parts[0]);
    return kit ? { kit, typeHead: parts[0] } : undefined;
  }
  if (parts.length === 2) {
    const kit = bindingKit.get(parts[0]);
    return kit ? { kit, typeHead: parts[1] } : undefined;
  }
  return undefined;
}

/**
 * Build variable-name -> TypedVar from typed declarations and params. Works on
 * both `.ts` and `.ets` (regex, no tsc). Only explicitly-typed bindings are
 * resolved; untyped `let v = expr()` is missed (a later tsc-based increment).
 */
export function extractTypedVars(content: string, bindingKit: BindingMap): Map<string, TypedVar> {
  const out = new Map<string, TypedVar>();
  // `let|const|var v : <TypeExpr>`
  const decl =
    /(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/g;
  // function/arrow params: `(v: T` or `, v?: T` (optional `?`)
  const param =
    /[(,]\s*([A-Za-z_$][\w$]*)\??\s*:\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/g;
  for (const re of [decl, param]) {
    for (const m of content.matchAll(re)) {
      const resolved = resolveType(m[2], bindingKit);
      if (resolved) out.set(m[1], resolved);
    }
  }
  return out;
}

/** Per (kit, typeHead) index of deprecated instance members. */
export interface InstanceIndexEntry {
  /** The member chain accessed on the receiver, NOT including the type. */
  accessChain: string[];
  entry: DeprecationEntry;
}

export function buildInstanceIndex(map: DeprecationMap): Map<string, InstanceIndexEntry[]> {
  const exportIndex = map.exportIndex ?? {};
  const exportRenamed = (e: DeprecationEntry) =>
    !!e.dep.exportName && !!exportIndex[`${e.dep.kit}\0${e.dep.exportName}`];
  const idx = new Map<string, InstanceIndexEntry[]>();
  for (const e of map.entries) {
    if (!e.dep.members || e.dep.members.length === 0 || e.dep.members.length > 2) continue;
    if (!e.dep.exportName) continue;
    if (exportRenamed(e)) continue; // covered by the rename-export alias
    // Shape 1: members=[Type, leaf] -> type=members[0], access=members.slice(1).
    // Shape 2: members=[leaf]      -> type=exportName, access=members.
    const typeHead =
      e.dep.members.length >= 2 ? e.dep.members[0] : e.dep.exportName;
    const accessChain =
      e.dep.members.length >= 2 ? e.dep.members.slice(1) : e.dep.members.slice();
    const key = `${e.dep.kit}\0${typeHead}`;
    (idx.get(key) ?? idx.set(key, []).get(key)!).push({ accessChain, entry: e });
  }
  return idx;
}

export interface InstanceScanResult {
  findings: Finding[];
  filesScanned: number;
}

/**
 * Scan for deprecated instance-method usages reached through a typed local
 * variable (the receiver), e.g. `r.getString()` where `r` is typed
 * `resourceManager.ResourceManager`. The binding-only `scanProjectMembers`
 * misses these (the receiver is not an import name).
 *
 * - `instanceSafe` entries (SDK-verified sibling rename) -> `rename-member`,
 *   splicing `var.<leaf>` -> `var.<repl leaf>` on the same receiver.
 * - Everything else (cross-kit receiver change / namespace-function repl /
 *   unverified) -> `manual`, naming the @useinstead target. Crucially this
 *   turns a silent miss into a reported finding.
 */
export function scanProjectInstanceMembers(opts: MemberScanOptions): InstanceScanResult {
  const { projectRoot, map } = opts;
  const since = opts.since ?? 0;
  const kitMove: KitMoveResolver = (k) => map.kitIndex[k]?.newKit;
  const instanceIndex = buildInstanceIndex(map);
  const files = walkFiles(projectRoot, { extensions: [".ts", ".ets"] });
  const findings: Finding[] = [];
  const dedupe = new Map<string, Finding>();

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const fileRel = relative(projectRoot, file).split(sep).join("/");
    const bindingKit = extractBindingMap(content);
    const typedVars = extractTypedVars(content, bindingKit);

    for (const [varName, { kit, typeHead }] of typedVars) {
      const entries = instanceIndex.get(`${kit}\0${typeHead}`);
      if (!entries) continue;
      for (const { accessChain, entry: e } of entries) {
        if (since && e.since > since) continue;
        const pattern = varName + "\\." + accessChain.map(escapeRe).join("\\.");
        const re = new RegExp(`\\b${pattern}\\b`, "g");
        for (const m of content.matchAll(re)) {
          if (m.index === undefined) continue;
          const matchEnd = m.index + m[0].length;
          const oldSymbol = `${varName}.${accessChain.join(".")}`;
          const f = instanceFinding(
            fileRel, m.index, matchEnd, content, varName, accessChain, e, kitMove,
          );
          if (!f) continue; // suppressed (e.g. no-op)
          const key = `${f.file}:${f.line}:${f.oldSymbol}`;
          const prev = dedupe.get(key);
          if (!prev || (prev.needsManual && !f.needsManual)) dedupe.set(key, f);
        }
      }
    }
  }

  const deduped = dedupeOverlappingSpans([...dedupe.values()]);
  return { findings: deduped, filesScanned: files.length };
}

function instanceFinding(
  file: string,
  offset: number,
  matchEnd: number,
  content: string,
  varName: string,
  accessChain: string[],
  e: DeprecationEntry,
  kitMove: KitMoveResolver,
): Finding | null {
  const oldSymbol = `${varName}.${accessChain.join(".")}`;
  const repl = e.repl;
  if (!repl || !repl.members || repl.members.length === 0) {
    return {
      file, line: lineAt(content, offset), oldSymbol, newSymbol: null,
      since: e.since, rule: "manual", needsManual: true,
      note: "no @useinstead replacement",
    };
  }
  const sameKit = !repl.kit || repl.kit === e.dep.kit;
  const aligned = !!(repl.kit && kitMove(e.dep.kit) === repl.kit);
  // No-op: a VERIFIED instance method whose replacement leaf equals the
  // deprecated leaf (self-referential). NB: when instanceSafe is false and
  // the leaf is equal, the replacement is a namespace function (e.g.
  // `i18n.I18NUtil.getUnicodeWrappedFilePath` -> the namespace fn
  // `getUnicodeWrappedFilePath`) — the receiver changes, so it is NOT a no-op;
  // fall through to manual.
  const newLeaf = repl.members[repl.members.length - 1];
  const oldLeaf = accessChain[accessChain.length - 1];
  if (e.instanceSafe && repl.members.length === 1 && newLeaf === oldLeaf) {
    return null; // suppress — identical splice would be a confusing no-op
  }
  // Auto-fix: verified instance-safe same-kit/aligned single-leaf rename.
  if (e.instanceSafe && (sameKit || aligned) && repl.members.length === 1) {
    const replacement = `${varName}.${repl.members[0]}`;
    return {
      file, line: lineAt(content, offset), oldSymbol, newSymbol: replacement,
      since: e.since, rule: "rename-member", needsManual: false,
      note: `rename instance member -> ${repl.members[0]}`,
      matchStart: offset, matchEnd, replacement,
    };
  }
  // Otherwise: report manual, naming the @useinstead target so it is not a
  // silent miss (cross-kit receiver change, namespace-function repl, etc.).
  const target = repl.kit
    ? `${repl.kit}/${repl.members.join(".")}`
    : repl.members.join(".");
  return {
    file, line: lineAt(content, offset), oldSymbol, newSymbol: target,
    since: e.since, rule: "manual", needsManual: true,
    note: `instance method -> ${target} (requires wiring changes)`,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}
