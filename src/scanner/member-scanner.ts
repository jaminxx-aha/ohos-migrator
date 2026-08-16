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
import { findSymbolOverride, loadSymbolOverrides } from "../rewriter/symbol-overrides.js";
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
  /**
   * Path to a user JSON file of per-symbol overrides, merged over the builtin
   * table (wantConstant Action/Entity literals, etc.). Loaded once at scan
   * start; entries produce `override` findings spliced at the match span.
   */
  symbolOverrides?: string;
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
  // Load any user symbol-override file over the builtin table. Only when a
  // path is given — otherwise leave `active` as initialized (builtin by
  // default), so repeated scans don't clobber a previously loaded table.
  if (opts.symbolOverrides) loadSymbolOverrides(opts.symbolOverrides);
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
  // Kits whose module shape is `declare namespace <ns> { ... } export default
  // <ns>` — members are reachable only via the DEFAULT import, so the
  // per-file binding allocator must emit `import X from '<kit>'` (not the
  // namespace form) when injecting a fresh binding for one of these.
  const defaultExportKits = new Set(Object.keys(map.kitDefaultExport ?? {}));

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const bindings = extractBindingMap(content);
    // Per-file binding allocator: reuses an existing local binding for a
    // cross-kit target when the file already imports it, else allocates a
    // collision-free name and records a pending `inject-import`. Shared with
    // the TS-LS scanner so both detection paths allocate bindings identically.
    const alloc = createBindingAllocator(content, defaultExportKits);
    const pickBinding = alloc.pickBinding;

    for (const [binding, kit] of bindings) {
      const entries = memberIndex[kit];
      if (!entries) continue;
      for (const e of entries) {
        if (!entryEligible(e, kit, map, since)) continue;
        const members = e.dep.members!;
        const pattern = binding + "\\." + members.map(escapeRe).join("\\.");
        const re = new RegExp(`\\b${pattern}\\b`, "g");
        for (const m of content.matchAll(re)) {
          if (m.index === undefined) continue;
          const matchEnd = m.index + m[0].length;
          const f = classifyMemberCallSite(
            file, projectRoot, m.index, matchEnd, content, binding, members, e,
            ctx, kitMove, pickBinding, map.kitExports,
          );
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
    injectFindings.push(...alloc.injectImports(file, projectRoot, content));
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

/**
 * Per-entry eligibility for the static member scanner: should this deprecated
 * entry yield findings at all? Encodes the suppression pre-checks so that both
 * the regex scanner (`scanProjectMembers`) and the TS-LS scanner
 * (`scanProjectDeprecatedMembers`) suppress the same entries and stay in sync.
 *
 * Suppresses when:
 *  - `since` filters it out;
 *  - the enclosing export is itself same-kit renamed (rename-export aliases the
 *    import, so `binding.<chain>` already resolves — no member splice needed);
 *  - the export has a cross-kit same-name drop-in AND the member chain is
 *    unchanged (the import-specifier rewrite re-points the binding);
 *  - `memberPreservedByMove` (the member still exists in the relocated kit, so
 *    the import rewrite already covers every call site).
 */
export function entryEligible(
  e: DeprecationEntry,
  kit: string,
  map: DeprecationMap,
  since: number,
): boolean {
  if (since && e.since > since) return false;
  const exportIndex = map.exportIndex ?? {};
  if (e.dep.exportName && exportIndex[`${kit}\0${e.dep.exportName}`]) {
    // The whole export is deprecated/moved and covered by an import-level
    // rewrite (rewrite-import re-points the binding), so a member finding is
    // normally redundant. EXCEPT when this member is RENAMED in the target
    // kit (the repl chain differs from the dep chain): the import swap alone
    // re-points the binding but leaves the OLD member name unresolved on the
    // new kit (e.g. `bluetooth.CharacteristicReadReq` -> binding re-pointed to
    // `@ohos.bluetoothManager`, whose member is `CharacteristicReadRequest`),
    // so the member finding MUST be emitted to let the rewriter splice the new
    // name. Preserved-by-move members (same name) stay suppressed here and via
    // `memberPreservedByMove` below.
    const rMembers = e.repl?.members;
    const dMembers = e.dep.members;
    const renamed =
      !!rMembers &&
      !!dMembers &&
      !(rMembers.length === dMembers.length && rMembers.every((m, i) => m === dMembers[i]));
    if (!renamed) return false;
  }
  const crossKitDropin = map.crossKitDropin ?? {};
  if (e.dep.exportName && e.repl && e.repl.members && e.dep.members) {
    const dropin =
      crossKitDropin[`${kit}\0${e.dep.exportName}`] ??
      crossKitDropin[`${kit}\0default`];
    if (memberCoveredByContainerDropin(e.dep.exportName, e.dep.members, e.repl, dropin)) {
      return false;
    }
  }
  if (e.memberPreservedByMove) return false;
  return true;
}

/**
 * Classify a single static member call site (`binding.<chain>` at a span) into
 * a Finding. Encodes the three branches the regex scanner applied per match, so
 * the TS-LS scanner (which locates call sites via diagnostics instead of regex)
 * produces identical findings — only the *detection* layer differs.
 *
 *  - **A** `crossKitMemberDropin`: cross-kit equal-length member move verified
 *    at index time. Rebind the receiver to a (reused or injected) binding for
 *    `repl.kit` and keep/rename the chain → `rename-member` splice; the import
 *    line is added by a single per-file `inject-import` finding the caller emits.
 *    `pickBinding` carries the per-file allocation side effect.
 *  - **B** `nestedContainerInsert`: same-kit 1-seg → 2-seg insert of a
 *    verified nested-class container → `rename-member` reusing the kit binding.
 *  - **C** otherwise: `memberFinding` (override table / `describeMemberReplacement`
 *    → override | rename-member | manual).
 *
 * Returns null when the call site is suppressed (e.g. an aligned kit move).
 */
export function classifyMemberCallSite(
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
  pickBinding: (kit: string, forceNew?: boolean) => { binding: string; injected: boolean },
  /** Serialized `kitTopLevelExports` from the deprecation map
   *  (`Record<kit, string[]>`). Used by the reverse drop-in branch to tell
   *  whether a kit-move member's replacement actually resolves in the moved-to
   *  kit, and whether the deprecated (old) kit still exports the member. */
  kitExports?: Record<string, string[]>,
): Finding | null {
  const fileRel = relative(projectRoot, file).split(sep).join("/");
  const oldSymbol = `${binding}.${members.join(".")}`;
  // Branch A: cross-kit equal-length member move (rebind + injected import).
  if (e.crossKitMemberDropin && e.repl?.kit && e.repl?.members?.length) {
    const { binding: newBinding } = pickBinding(e.repl.kit);
    const replChain = e.repl.members.join(".");
    const replacement = `${newBinding}.${replChain}`;
    return {
      file: fileRel,
      line: lineAt(content, offset),
      oldSymbol,
      newSymbol: replacement,
      since: e.since,
      rule: "rename-member",
      needsManual: false,
      note: `cross-kit rebind -> ${e.repl.kit}.${replChain} (injected import)`,
      matchStart: offset,
      matchEnd,
      replacement,
    };
  }
  // Branch B: same-kit nested-container insert (reuse the kit binding).
  if (e.nestedContainerInsert && e.repl?.members && e.repl.members.length > 1) {
    const replChain = e.repl.members.join(".");
    const replacement = `${binding}.${replChain}`;
    return {
      file: fileRel,
      line: lineAt(content, offset),
      oldSymbol,
      newSymbol: replacement,
      since: e.since,
      rule: "rename-member",
      needsManual: false,
      note: `nested container insert -> ${binding}.${replChain}`,
      matchStart: offset,
      matchEnd,
      replacement,
    };
  }
  // Branch A': reverse drop-in — the kit moved (so `rewrite-import` will
  // re-point this binding to the new kit), but this member has NO reachable
  // target in the moved-to kit: it was removed (repl null) OR its @useinstead
  // names a member the new kit doesn't export (stale). The blanket import
  // swap would break the reference. Since the deprecated (old) kit still
  // resolves and still exports the member, keep the reference on the old kit
  // via a freshly-injected import under a new binding (forced new — the
  // existing binding is about to be swapped away). The call site still uses a
  // deprecated symbol (scanner keeps flagging it) but now compiles, with a
  // note marking it for human review. Members that DID travel to the new kit
  // are unaffected — `memberTargetMissingInMovedKit` is false for them, so
  // they fall through to the aligned-suppress path and migrate via the swap.
  const movedTo = kitMove(e.dep.kit);
  if (movedTo && memberTargetMissingInMovedKit(e, movedTo, kitExports) && oldKitStillExports(e, kitExports)) {
    const { binding: oldBinding } = pickBinding(e.dep.kit, true);
    const chain = members.join(".");
    const replacement = `${oldBinding}.${chain}`;
    return {
      file: fileRel,
      line: lineAt(content, offset),
      oldSymbol,
      newSymbol: replacement,
      since: e.since,
      rule: "rename-member",
      needsManual: true,
      note: `kept on deprecated ${e.dep.kit} (no target in moved kit ${movedTo})`,
      matchStart: offset,
      matchEnd,
      replacement,
    };
  }
  // Branch C: override / describeMemberReplacement / manual.
  return memberFinding(file, projectRoot, offset, matchEnd, content, binding, members, e, ctx, kitMove);
}

/**
 * Whether a kit-moved member has no reachable target in the moved-to kit.
 * True when the member was removed (no `@useinstead`, `repl` null) OR the
 * `@useinstead` points at the moved-to kit but names a member that kit does
 * not export (stale metadata). A `@useinstead` pointing at a *different* kit
 * is a genuine cross-kit target handled elsewhere — false here.
 */
function memberTargetMissingInMovedKit(
  e: DeprecationEntry,
  movedTo: string,
  kitExports?: Record<string, string[]>,
): boolean {
  const repl = e.repl;
  if (!repl || !repl.members?.length) return true; // removed: no @useinstead
  if (repl.kit === movedTo) {
    // aligned target — is the named member actually exported by the new kit?
    return !(kitExports?.[movedTo] ?? []).includes(repl.members[0]);
  }
  return false; // points elsewhere: not a reverse drop-in
}

/** Whether the deprecated (old) kit still resolves and still exports the
 *  member's first segment — so a reverse drop-in rebind will actually resolve. */
function oldKitStillExports(e: DeprecationEntry, kitExports?: Record<string, string[]>): boolean {
  const seg = e.dep.members?.[0];
  if (!seg) return false;
  return (kitExports?.[e.dep.kit] ?? []).includes(seg);
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
  // Curated per-symbol override (wantConstant Action/Entity literals, or a
  // user-loaded JSON table) wins over both the kit recipe and the structural
  // derivation — it's human-verified identity data, the highest trust tier.
  const cur = findSymbolOverride(e.dep.kit, e.dep.exportName, members);
  const ov = findMemberOverride(e.dep.kit, members, e.repl, ctx);
  const desc: MemberReplacement = cur?.manual
    ? { newSymbol: cur.replacement, rule: "manual", note: cur.note }
    : cur
      ? { newSymbol: cur.replacement, rule: "override", note: cur.note, replacement: cur.replacement }
      : ov
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
    ...(cur?.manual && cur.humanOnly ? { humanOnly: true } : {}),
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

/**
 * Per-file binding allocator for cross-kit member drop-ins (branch A of the
 * static scanner). Reuses an existing local binding when the file already
 * imports the target kit, else allocates a collision-free name and records a
 * pending `inject-import`. Shared by the regex scanner (`scanProjectMembers`)
 * and the TS-LS scanner (`scanProjectDeprecatedMembers`) so both detection
 * paths produce identical injected imports.
 */
export interface BindingAllocator {
  /** Resolve a binding for a (possibly new) kit, allocating one if needed.
   *
   *  `forceNew` skips the reuse of an existing local binding for `kit` and
   *  always allocates a fresh name (queueing an `inject-import`). This is
   *  needed for a *reverse drop-in*: when the kit moved (`kitIndex.newKit`),
   *  the existing local binding for the old kit is about to be re-pointed to
   *  the new kit by `rewrite-import`, so reusing it for a member that must
   *  stay on the deprecated old kit would silently break it. Forcing a new
   *  binding yields a distinct name that survives the import swap. */
  pickBinding: (kit: string, forceNew?: boolean) => { binding: string; injected: boolean };
  /**
   * Build the single per-file `inject-import` finding for every kit allocated
   * via `pickBinding`, anchored at the start of the line after the last import
   * (end-of-file fallback). Empty array when nothing was allocated.
   */
  injectImports: (file: string, projectRoot: string, content: string) => Finding[];
}

/**
 * Construct a per-file `BindingAllocator`. Reads the file's imports once to
 * seed the reverse map (kit -> existing binding) and the in-use name set; later
 * `pickBinding` calls mutate the shared `allocated` map so a single
 * `injectImports` call emits all pending injections.
 */
export function createBindingAllocator(
  content: string,
  defaultExportKits?: Set<string>,
): BindingAllocator {
  const bindings = extractBindingMap(content);
  const kitToBinding = new Map<string, string>();
  const usedBindings = new Set<string>();
  for (const [b, k] of bindings) {
    usedBindings.add(b);
    if (!kitToBinding.has(k)) kitToBinding.set(k, b);
  }
  const allocated = new Map<string, { binding: string; planned: true }>();
  const pickBinding = (kit: string, forceNew = false): { binding: string; injected: boolean } => {
    if (!forceNew) {
      const existing = kitToBinding.get(kit);
      if (existing) return { binding: existing, injected: false };
    }
    const hit = allocated.get(kit);
    if (hit) return { binding: hit.binding, injected: true };
    // Derive a stable name from the kit's last segment, suffixing on collision
    // with an existing or already-allocated local name.
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
  const injectImports = (file: string, projectRoot: string, content: string): Finding[] => {
    if (allocated.size === 0) return [];
    const imps = extractImports(content);
    const maxSpecEnd = imps.length ? Math.max(...imps.map((i) => i.specEnd)) : -1;
    const anchor = maxSpecEnd >= 0
      ? (() => { const nl = content.indexOf("\n", maxSpecEnd); return nl === -1 ? content.length : nl + 1; })()
      : 0;
    const text =
      [...allocated.entries()].map(([k, a]) =>
        // A kit with `export default <ns>` exposes its namespace members only
        // via the DEFAULT import (`import X from '<kit>'`); the namespace form
        // `import * as X` yields `{ default: <ns> }` and `X.<member>` is
        // unreachable. Emit the form that matches the kit's actual export shape
        // so the rebind `X.<member>` resolves.
        defaultExportKits?.has(k)
          ? `import ${a.binding} from '${k}';`
          : `import * as ${a.binding} from '${k}';`,
      ).join("\n") + "\n";
    return [{
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
    }];
  };
  return { pickBinding, injectImports };
}
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

/* ------------------------------------------------------------------ */
/* Instance-method scanner — resolves typed local variables as the    */
/* receiver (e.g. `let r: resourceManager.ResourceManager; r.getString()`),*/

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
    // Suppressed when the member is verified preserved in the new kit after an
    // enclosing kit relocation / container drop-in: the import rewrite already
    // re-points the binding, so the instance access resolves unchanged.
    if (e.memberPreservedByMove) return null;
    return {
      file, line: lineAt(content, offset), oldSymbol, newSymbol: null,
      since: e.since, rule: "manual", needsManual: true,
      note: "no @useinstead replacement",
      kit: e.dep.kit,
      container: e.dep.members && e.dep.members.length > 1 ? e.dep.members[0] : undefined,
    };
  }
  // Curated per-symbol override (highest trust): a human-verified exception to
  // the instance-safe rename — e.g. a same-class instance method rename whose
  // SIGNATURE changed (param/return type) so a blind `var.<newLeaf>` splice
  // leaves the call args intact and breaks the call site. `manual` emits no
  // replacement (the call site stays on the deprecated, still-compiling API);
  // `humanOnly` additionally excludes it from the AI residual set (the model
  // cannot choose a now-required argument). Checked BEFORE the instance-safe
  // auto-rename and the drop-in suppression so curation wins.
  const cur = findSymbolOverride(e.dep.kit, e.dep.exportName, e.dep.members);
  if (cur?.manual) {
    return {
      file, line: lineAt(content, offset), oldSymbol,
      newSymbol: cur.replacement, since: e.since,
      rule: "manual", needsManual: true, note: cur.note,
      ...(cur.humanOnly ? { humanOnly: true } : {}),
      // Identity for SDK slice resolution: instance calls bind to a `declare let`
      // variable (not an import), so the AI context builder can't recover the kit
      // from the import map — carry it on the finding so the deprecated +
      // replacement decl slices (and cross-file type summaries) still resolve.
      kit: e.dep.kit,
      container: e.dep.members && e.dep.members.length > 1 ? e.dep.members[0] : undefined,
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
