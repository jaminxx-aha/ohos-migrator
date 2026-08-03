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
}

/** Per-kit summary used by the scanner for import-level matching. */
export interface KitDepInfo {
  since: number;
  /** New kit if this is a safe module-move (rewrite-import). */
  newKit?: string;
  /** True when the kit is deprecated but has no auto replacement. */
  manual?: boolean;
}

/** The deprecation map, persisted as JSON. */
export interface DeprecationMap {
  apiVersion: number;
  sdkPath: string;
  generatedAt: string;
  entries: DeprecationEntry[];
  /** Quick import-level lookup: oldKit -> summary. */
  kitIndex: Record<string, KitDepInfo>;
}

/** Rule kind the rewriter may apply. */
export type RuleKind = "rewrite-import" | "rename-member" | "signature-change" | "manual";

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
}
