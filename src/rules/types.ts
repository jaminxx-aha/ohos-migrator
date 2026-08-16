/**
 * Core types shared across indexer / scanner / rewriter.
 */

/** Identity of a deprecated symbol inside an SDK declaration file. */
export interface DepSymbol {
  /** Full import specifier, e.g. `@ohos.ability.dataUriUtils`. */
  kit: string;
  /** Top-level exported name (namespace/function/interface/class/const/type/enum). */
  exportName?: string;
  /** Member chain inside that export (method/property/enum-member), leaf last. */
  members?: string[];
}

/** A resolved @useinstead target (or null when no replacement is stated). */
export interface ReplSymbol {
  kit?: string;
  exportName?: string;
  members?: string[];
}

export type DepKind = "module-move" | "member";

/** One entry in the deprecation map. */
export interface DeprecationEntry {
  dep: DepSymbol;
  since: number;
  repl: ReplSymbol | null;
  kind: DepKind;
  source: { file: string; line: number };
  /**
   * True when this is an instance-method single-leaf rename whose replacement
   * leaf is declared as a sibling member of the same enclosing interface/class
   * in the SDK (verified at index time). Lets the instance-method scanner
   * splice `var.<leaf>` -> `var.<repl leaf>` safely; absent otherwise.
   */
  instanceSafe?: boolean;
  /**
   * True when this is a cross-kit single-leaf member move whose replacement
   * leaf is verified at index time to be a top-level export of `repl.kit`
   * (e.g. `@ohos.ability.particleAbility.startBackgroundRunning` ->
   * `@ohos.resourceschedule.backgroundTaskManager.startBackgroundRunning`).
   * The scanner then injects a new `import * as <binding> from '<repl.kit>'`
   * and rebinds the receiver at each call site, instead of reporting manual.
   * Only set for 1-seg dep -> 1-seg repl, cross-kit, non-aligned, verified.
   */
  crossKitMemberDropin?: boolean;
  /**
   * True when this is a NO-`@useinstead` member (the SDK marks it deprecated
   * but gives no replacement) whose enclosing kit was relocated wholesale
   * (`kitIndex[dep.kit].newKit`) OR whose enclosing export moved as a
   * cross-kit same-name drop-in (`crossKitDropin`), AND whose full member chain
   * is verified at index time to still exist in the new kit/container. The
   * import-specifier rewrite (kit move) or named-import drop-in already
   * re-points the binding to where the member lives, so the member finding is
   * redundant — the scanners suppress it. Members NOT preserved in the new
   * location (genuinely removed) stay manual: the binding would point at a kit
   * that no longer declares them, so the call site still needs a human fix.
   */
  memberPreservedByMove?: boolean;
  /**
   * True when this is a SAME-KIT 1-seg -> 2-seg member move that INSERTS a
   * container segment in front of a preserved leaf, where the inserted
   * container is a verified top-level export of `dep.kit` and the leaf is a
   * verified STATIC method of that container (a nested class). The scanner
   * splices `binding.<leaf>` -> `binding.<container>.<leaf>` and reuses the
   * existing kit binding (no import injection). The classic case is
   * `@ohos.i18n.is24HourClock` -> `i18n.System.is24HourClock` (the `System`
   * nested class gained the old top-level static methods). Instance methods
   * (`process.ProcessManager.isAppUid` — would call an instance method on the
   * class), type-only interfaces (`worker.WorkerEventTarget.*`), non-container
   * restate-leaf shapes (`contact.addContact.addContact`), stale `@useinstead`
   * pointing at a method the class doesn't declare, and AMBIGUOUS symbols
   * (`UiTest.click` -> both `Component.click` and `Driver.click`) are rejected
   * by the verification gates and stay manual.
   */
  nestedContainerInsert?: boolean;
}

/** Per-kit summary used by the scanner for import-level matching. */
export interface KitDepInfo {
  since: number;
  /** New kit if this is a safe module-move (rewrite-import). */
  newKit?: string;
  /** True when the kit is deprecated but has no auto replacement. */
  manual?: boolean;
}

/** Same-kit export rename: `${kit}\0${oldExport}` -> newExport. */
export type ExportIndex = Record<string, string>;

/**
 * Cross-kit export drop-in: `${oldKit}\0${exportName}` -> newKit, for exports
 * whose `@useinstead` moves them to another kit *under the same name* (e.g.
 * `@system.router.RouterOptions` -> `@ohos.router.RouterOptions`). A named
 * import clause `import { RouterOptions, RouterState } from '@system.router'`
 * rewrites its specifier to `@ohos.router` when every binding in the clause
 * drops to the same target kit. Per-clause (not wholesale) so a mixed clause
 * or one with a removed export is left untouched.
 */
export type CrossKitDropin = Record<string, string>;

/**
 * Cross-kit export *rename*: `${oldKit}\0${exportName}` -> `${newKit}\0${newName}`,
 * for exports whose `@useinstead` moves them to another kit *under a different
 * name* (e.g. `@ohos.fileio.fstat` -> `@ohos.file.fs.stat`). A named import
 * `import { fstat } from '@ohos.fileio'` rewrites to
 * `import { stat as fstat } from '@ohos.file.fs'` — the specifier moves AND the
 * binding is aliased to the new name under the old local name, so call sites
 * (`fstat(...)`) need no body rewrite. Per-clause: every binding in the clause
 * must move to the same target kit (same- or different-name) or the clause is
 * left untouched so a mixed clause never breaks.
 */
export type CrossKitRenameExport = Record<string, string>;

/** One curated override entry. `manual` emits a `manual` finding with NO
 *  spliced replacement (the call site stays on the deprecated, still-compiling
 *  API); `humanOnly` additionally excludes it from the AI residual set — the
 *  model cannot choose a now-required argument (e.g. a tightened param type
 *  that needs a human-picked literal), so guessing would be a silent bug or a
 *  file-level revert that takes down unrelated AI edits. */
export interface SymbolOverride {
  replacement: string;
  note: string;
  manual?: boolean;
  humanOnly?: boolean;
}
/** Curated per-symbol override: `${kit}\0${exportName}\0${members.join(".")}` -> SymbolOverride. */
export type SymbolOverrideTable = Record<string, SymbolOverride>;

/** The deprecation map, persisted as JSON. */
export interface DeprecationMap {
  apiVersion: number;
  sdkPath: string;
  generatedAt: string;
  entries: DeprecationEntry[];
  /** Quick import-level lookup: oldKit -> summary. */
  kitIndex: Record<string, KitDepInfo>;
  /** Same-kit export-name renames (e.g. `@ohos.UiTest` `By` -> `On`). */
  exportIndex?: ExportIndex;
  /** Cross-kit same-name export moves (per-clause named-import drop-in). */
  crossKitDropin?: CrossKitDropin;
  /** Cross-kit different-name export moves (per-clause named-import rename+alias). */
  crossKitRenameExport?: CrossKitRenameExport;
  /**
   * Declaration-file -> kit attribution (path relative to sdkPath, forward
   * slashes, keyed by the SDK `api/` tree path). Built by the indexer's
   * re-export tracing so the type-aware (tsc) scanner can map a resolved
   * type's declaration file back to its owning kit — the same attribution
   * the dep entries use, keeping lookup keys consistent.
   */
  fileKit?: Record<string, string>;
  /**
   * Per-kit set of genuinely re-exported top-level export names — the names a
   * consumer can actually `import { X } from '<kit>'`. Built from the indexer's
   * phase-1 genuine re-export edges (`export { X } from`/`export *`,
   * `export type X = _local[.Y]`, bare `export { X }` of imported names). Used
   * by the fixture generator to decide which deprecated entries resolve under
   * TS-LS (an entry whose exportName is NOT in this set cannot be imported
   * directly and is skipped in the "must compile" fixture, though it stays in
   * the map for the scanner's indirect-access coverage).
   */
  kitExports?: Record<string, string[]>;
  /**
   * Per-kit default export name (from `export default <name>`), for kits whose
   * top export is a default namespace (`declare namespace X; export default X`,
   * e.g. `@ohos.router` -> `router`). The fixture generator uses this to pick
   * the value/default import form that TS resolves (`import X from '<kit>'`);
   * the named form 2614s for a default-only export. Absent for kits with no
   * default export.
   */
  kitDefaultExport?: Record<string, string>;
}

/** Rule kind the rewriter may apply. */
export type RuleKind =
  | "rewrite-import"
  | "rename-member"
  | "rename-export"
  | "override"
  | "signature-change"
  | "inject-import"
  | "manual";

/** A single scan finding. */
export interface Finding {
  file: string;
  line: number;
  /** Original import specifier or symbol reference. */
  oldSymbol: string;
  /** Replacement specifier/symbol, if known. */
  newSymbol: string | null;
  since: number;
  rule: RuleKind;
  /** True when no @useinstead was given and no override exists. */
  needsManual: boolean;
  /** Human-readable note shown in reports. */
  note: string;
  /** Absolute char offset of the matched text (member-level overrides). */
  matchStart?: number;
  /** Char offset just past the matched text. */
  matchEnd?: number;
  /** Exact replacement text to splice at matchStart..matchEnd (when auto-fixable). */
  replacement?: string;
  /** True when this manual finding must NOT be sent to the AI (it needs human
   *  judgment the model can't supply — e.g. a signature change requiring a
   *  human-chosen argument). The call site stays deprecated-but-compiling and
   *  is reported for review. */
  humanOnly?: boolean;
  /** SDK kit identity (e.g. '@ohos.X'), set by the scanner for findings whose
   *  call-site binding is NOT an import (e.g. instance calls on a `declare let`
   *  variable) so the AI context builder can still resolve the deprecated +
   *  replacement SDK declaration slices. Undefined when the binding IS an
   *  import (the import map already carries the kit). */
  kit?: string;
  /** Enclosing container (the class/namespace the member is on), set alongside
   *  `kit` so the SDK slice is scoped to the right declaration body. */
  container?: string;
}
