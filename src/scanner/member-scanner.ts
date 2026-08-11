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
import { extractImports } from "./import-extractor.js";
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
  // Inject-import findings (zero-length spans at the import-block anchor) are
  // collected separately and appended AFTER the member-span overlap filter,
  // which would otherwise drop a zero-length span nested under a body match.
  const injectFindings: Finding[] = [];
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
    // Reverse map (kit -> existing local binding) to REUSE a binding when the
    // consumer already imports the cross-kit target, avoiding a redundant
    // injected import; plus the set of local names already in use for
    // collision-free allocation of new bindings.
    const kitToBinding = new Map<string, string>();
    const usedBindings = new Set<string>();
    for (const [b, k] of bindings) {
      usedBindings.add(b);
      if (!kitToBinding.has(k)) kitToBinding.set(k, b);
    }
    // Newly allocated bindings for cross-kit targets the file does NOT yet
    // import: kit -> { binding, planned }. planned marks that an
    // `inject-import` finding must be emitted for this (file, kit).
    const allocated = new Map<string, { binding: string; planned: true }>();
    const pickBinding = (kit: string): { binding: string; injected: boolean } => {
      const existing = kitToBinding.get(kit);
      if (existing) return { binding: existing, injected: false };
      const hit = allocated.get(kit);
      if (hit) return { binding: hit.binding, injected: true };
      // Derive a stable name from the kit's last segment, suffixing on
      // collision with an existing or already-allocated local name.
      const base = kit.split(".").pop() ?? "mod";
      let name = base;
      let n = 2;
      while (usedBindings.has(name) || [...allocated.values()].some((a) => a.binding === name)) {
        name = `${base}${n++}`;
      }
      usedBindings.add(name);
      allocated.set(kit, { binding: name, planned: true });
      return { binding: name, injected: true };
    };
    // Anchor offset for injecting new imports: start of the line after the
    // last existing import (a file needing injection always has the old
    // binding's import). Falls back to end-of-file.
    const imps = extractImports(content);
    const maxSpecEnd = imps.length ? Math.max(...imps.map((i) => i.specEnd)) : -1;
    const anchor = maxSpecEnd >= 0
      ? (() => { const nl = content.indexOf("\n", maxSpecEnd); return nl === -1 ? content.length : nl + 1; })()
      : 0;

    const exportIndex = map.exportIndex ?? {};
    const crossKitDropin = map.crossKitDropin ?? {};
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
        // If this export has a cross-kit same-name drop-in (named export or a
        // `export default` moved wholesale to another kit under the same name),
        // the import-specifier rewrite already re-points the binding to the new
        // kit. When the member chain is unchanged the member resolves on the
        // re-pointed binding, so the member finding is redundant — suppress it
        // (mirrors the exportIndex / aligned-kit-move suppression). A changed
        // chain still needs a member-level splice (or a wiring change), so only
        // suppress when the chains are identical.
        if (e.dep.exportName && e.repl && e.repl.members && e.dep.members) {
          const dropin =
            crossKitDropin[`${kit}\0${e.dep.exportName}`] ??
            crossKitDropin[`${kit}\0default`];
          if (
            memberCoveredByContainerDropin(
              e.dep.exportName,
              e.dep.members,
              e.repl,
              dropin,
            )
          ) {
            continue;
          }
        }
        const members = e.dep.members!;
        const pattern = binding + "\\." + members.map(escapeRe).join("\\.");
        const re = new RegExp(`\\b${pattern}\\b`, "g");
        for (const m of content.matchAll(re)) {
          if (m.index === undefined) continue;
          const matchEnd = m.index + m[0].length;
          // Cross-kit equal-length member move verified at index time: instead
          // of a manual finding, rebind the receiver to a (reused or injected)
          // binding for repl.kit and keep/rename the chain. Covers 1-seg leaf
          // moves (e.g. startBackgroundRunning) and 2-seg path-preserving moves
          // (e.g. A2dpSourceProfile.connect). The call-site splice reuses the
          // rename-member rewriter path; the import line is added by a single
          // per-file inject-import finding emitted after the loop.
          if (e.crossKitMemberDropin && e.repl?.kit && e.repl?.members?.length) {
            const { binding: newBinding } = pickBinding(e.repl.kit);
            const replChain = e.repl.members.join(".");
            const replacement = `${newBinding}.${replChain}`;
            const f: Finding = {
              file: relative(projectRoot, file).split(sep).join("/"),
              line: lineAt(content, m.index),
              oldSymbol: `${binding}.${members.join(".")}`,
              newSymbol: replacement,
              since: e.since,
              rule: "rename-member",
              needsManual: false,
              note: `cross-kit rebind -> ${e.repl.kit}.${replChain} (injected import)`,
              matchStart: m.index,
              matchEnd,
              replacement,
            };
            const key = `${f.file}:${f.line}:${f.oldSymbol}`;
            const prev = dedupe.get(key);
            if (!prev || (prev.needsManual && !f.needsManual)) dedupe.set(key, f);
            continue;
          }
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
    // Emit one inject-import finding per file that allocated new bindings,
    // combining all pending imports into a single insertion (avoids the
    // exact-span dedup that would silently drop a second same-offset insert).
    if (allocated.size > 0) {
      const text =
        [...allocated.entries()]
          .map(([k, a]) => `import * as ${a.binding} from '${k}';`)
          .join("\n") + "\n";
      injectFindings.push({
        file: relative(projectRoot, file).split(sep).join("/"),
        line: lineAt(content, anchor),
        oldSymbol: "",
        newSymbol: null,
        since: 0,
        rule: "inject-import",
        needsManual: false,
        note: `inject ${allocated.size} import(s) for cross-kit member rebind`,
        matchStart: anchor,
        matchEnd: anchor,
        replacement: text,
      });
    }
  }

  // Drop findings whose match span is subsumed by a longer match at the same
  // call site. The SDK marks both a class rename (`rpc.MessageParcel` ->
  // `rpc.MessageSequence`) and its members (`rpc.MessageParcel.create` ->
  // `rpc.MessageSequence.create`); both regex-match the same source span and
  // would double-report / produce overlapping rewriter edits. Keep the longer
  // (more specific) match per span.
  const deduped = dedupeOverlappingSpans([...dedupe.values()]);
  return { findings: [...deduped, ...injectFindings], filesScanned: files.length };
}

/**
 * Keep the longest member finding per overlapping match span (per file).
 * Findings without a match span (e.g. manual / rewrite-import) pass through.
 */
export function dedupeOverlappingSpans(findings: Finding[]): Finding[] {
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
 * Resolve a deprecated export's cross-kit same-name drop-in target kit, i.e.
 * the kit the export moved to wholesale under the same name (named export or a
 * `export default`). `map.crossKitDropin[\`${kit}\0${exportName}\`]` (or the
 * `\0default` variant). Returns undefined when the export has no drop-in.
 *
 * Threaded into the instance scanners so an instance member whose *container*
 * moved cross-kit via a drop-in can be suppressed: `rewrite-import` re-points
 * the import specifier to the drop-in kit, so an unchanged member chain (e.g.
 * `cfg.language` on a `Configuration` that moved to `@ohos.app.ability.
 * Configuration`) already resolves on the re-pointed binding — the instance
 * finding is redundant.
 */
export type ContainerDropinResolver = (depKit: string, exportName: string) => string | undefined;

/**
 * Whether a member deprecation is already covered by its container's
 * cross-kit same-name drop-in (the import-specifier rewrite re-points the
 * binding to the container's new kit, so an unchanged member chain resolves on
 * the re-pointed binding — the member finding is redundant). Two shapes,
 * both requiring the member's `@useinstead` target kit to equal the drop-in
 * target (the member traveled with the container):
 *
 *   - symmetric:  the container is a moved export in `dep.exportName` and the
 *                 repl chain EQUALS the dep chain (container not restated) —
 *                 e.g. `Configuration.language` -> repl `[language]`.
 *   - asymmetric: the container is a moved class/interface in `dep.exportName`
 *                 (its members live in `dep.members`), and the repl chain
 *                 RESTATES the container as `members[0]` — e.g. `Stat.ino`
 *                 (dep.exportName=Stat, dep.members=[ino]) -> repl
 *                 `[Stat, ino]`. The container and leaf are unchanged; only
 *                 the kit differs. (A class/interface member is reached via
 *                 an instance `s.ino`, not `binding.Stat.ino`, so the binding
 *                 scanner never matches it — but the instance scanner would
 *                 otherwise emit a spurious "wiring changes" manual finding;
 *                 suppressing mirrors the symmetric case.)
 */
function memberCoveredByContainerDropin(
  exportName: string | undefined,
  depMembers: string[],
  repl: ReplSymbol | null,
  dropin: string | undefined,
): boolean {
  if (!exportName || !dropin || !repl) return false;
  const rm = repl.members;
  if (!repl.kit || repl.kit !== dropin || !rm) return false;
  // symmetric: container in exportName, repl chain == dep chain
  if (rm.length === depMembers.length) {
    return depMembers.every((m, i) => m === rm[i]);
  }
  // asymmetric: container in exportName, repl = [exportName, ...depMembers]
  if (rm.length === depMembers.length + 1 && rm[0] === exportName) {
    return depMembers.every((m, i) => m === rm[i + 1]);
  }
  return false;
}

/**
 * Classify a deprecated member's replacement.
 *
 * - Same-kit rename (repl.kit absent, or repl.kit === dep.kit) on a same-length
 *   chain is auto-fixable: the matched `binding.<dep chain>` is spliced to
 *   `binding.<repl chain>` -> `rename-member`. This covers a leaf-only rename
 *   (`router.push` -> `router.pushUrl`), a container/mid-segment rename
 *   (`rpc.MessageParcel.create` -> `rpc.MessageSequence.create`), or both
 *   (`media.MediaErrorCode.MSERR_OK` -> `media.AVErrorCode.AVERR_OK`). When the
 *   full chain is identical the replacement is a no-op (self-referential): the
 *   call site already targets the right symbol, so a splice would change
 *   nothing — it is suppressed (no finding, no rewrite).
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
      note: "replacement identical to deprecated symbol (self-referential; no rewrite needed)",
      suppressed: true,
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
  const dropinMap = map.crossKitDropin ?? {};
  const containerDropin: ContainerDropinResolver = (k, n) =>
    dropinMap[`${k}\0${n}`] ?? dropinMap[`${k}\0default`];
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
            containerDropin,
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

export function instanceFinding(
  file: string,
  offset: number,
  matchEnd: number,
  content: string,
  varName: string,
  accessChain: string[],
  e: DeprecationEntry,
  kitMove: KitMoveResolver,
  containerDropin?: ContainerDropinResolver,
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
  // Container cross-kit drop-in coverage: when this member's enclosing export
  // moved wholesale to another kit under the same name (a `crossKitDropin`),
  // `rewrite-import` already re-points the import specifier to that kit. If the
  // member's documented replacement kit matches the drop-in target AND the chain
  // is unchanged (the member came along with the container), the instance
  // access already resolves on the re-pointed binding — the finding is
  // redundant. Mirrors the binding scanner's suppression in
  // `scanProjectMembers`. NB: requires `repl.kit === dropin` (the member's
  // @useinstead target lines up with where the container moved), which is a
  // stronger guarantee than "any drop-in exists" — a member whose @useinstead
  // points elsewhere did NOT travel with the container and is not covered.
  if (e.dep.exportName && e.dep.members && containerDropin) {
    const dropin = containerDropin(e.dep.kit, e.dep.exportName);
    if (
      memberCoveredByContainerDropin(
        e.dep.exportName,
        e.dep.members,
        repl,
        dropin,
      )
    ) {
      return null; // suppress — covered by the import-specifier rewrite
    }
  }
  const sameKit = !repl.kit || repl.kit === e.dep.kit;
  const aligned = !!(repl.kit && kitMove(e.dep.kit) === repl.kit);
  // Resolve the replacement leaf for a same-type instance rename. Two shapes
  // (mirroring `verifyInstanceSafe`): a single-segment repl, or a two-segment
  // repl whose first segment restates the unchanged type (e.g.
  // `Window.show` -> repl `[Window, showWindow]`).
  const typeHead = e.dep.members && e.dep.members.length >= 2 ? e.dep.members[0] : e.dep.exportName;
  const isTypePreservingLeaf =
    repl.members.length === 2 && !!typeHead && repl.members[0] === typeHead;
  let newLeaf: string | undefined;
  if (repl.members.length === 1) newLeaf = repl.members[0];
  else if (isTypePreservingLeaf) newLeaf = repl.members[1];
  const oldLeaf = accessChain[accessChain.length - 1];
  // No-op: a VERIFIED instance method whose replacement leaf equals the
  // deprecated leaf (self-referential). NB: when instanceSafe is false and
  // the leaf is equal, the replacement is a namespace function (e.g.
  // `i18n.I18NUtil.getUnicodeWrappedFilePath` -> the namespace fn
  // `getUnicodeWrappedFilePath`) — the receiver changes, so it is NOT a no-op;
  // fall through to manual.
  if (e.instanceSafe && newLeaf !== undefined && newLeaf === oldLeaf) {
    return null; // suppress — identical splice would be a confusing no-op
  }
  // Auto-fix: verified instance-safe same-kit/aligned leaf rename on the same
  // receiver type.
  if (e.instanceSafe && (sameKit || aligned) && newLeaf !== undefined) {
    const replacement = `${varName}.${newLeaf}`;
    return {
      file, line: lineAt(content, offset), oldSymbol, newSymbol: replacement,
      since: e.since, rule: "rename-member", needsManual: false,
      note: `rename instance member -> ${newLeaf}`,
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
