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
  /**
   * Declaration-file -> kit attribution (path relative to sdkPath, forward
   * slashes, keyed by the SDK `api/` tree path). Built by the indexer's
   * re-export tracing so the type-aware (tsc) scanner can map a resolved
   * type's declaration file back to its owning kit — the same attribution
   * the dep entries use, keeping lookup keys consistent.
   */
  fileKit?: Record<string, string>;
}

/** Rule kind the rewriter may apply. */
export type RuleKind =
  | "rewrite-import"
  | "rename-member"
  | "rename-export"
  | "override"
  | "signature-change"
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
}
