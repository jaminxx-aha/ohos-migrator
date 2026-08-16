/**
 * Parse an `@useinstead` token into its structural parts.
 *
 * Observed grammar (from the SDK survey of ~2756 distinct tokens):
 *   [ohos.<dotted.kit>] [/<exportName>] (.<member>)* (#<member>)?
 *
 * `.` navigates container -> member; `#` marks the leaf member. Both may be
 * present (e.g. `wantConstant.Flags#FLAG_AUTH_READ_URI_PERMISSION`).
 *
 * The kit boundary is ambiguous in pure-dot forms
 * (`ohos.resourceschedule.backgroundTaskManager.DelaySuspendInfo`): the kit
 * is `...backgroundTaskManager` and `DelaySuspendInfo` is a type. We resolve
 * this by matching the *longest prefix that is a known kit* — the indexer
 * supplies that set (derived from SDK `.d.ts` filenames).
 *
 * Short forms omit the `ohos.` prefix (e.g.
 * `appAccount.AppAccountManager#createAccount`, `ChipGroupItemOptions#x`,
 * or a bare member name). The caller supplies the *current file's kit* as a
 * fallback; the leading identifier (up to the first `.`/`#`) is then treated
 * as the export name.
 */

import type { ReplSymbol } from "../rules/types.js";

export interface ParsedUseinstead {
  /** Normalized import specifier (`@ohos.x.y`) when one could be resolved. */
  kit?: string;
  exportName?: string;
  members: string[];
  /** True when the token names a standard JS global (e.g. `Intl.*`) rather
   *  than an `@ohos` kit. Such a `@useinstead` migrates the deprecated symbol
   *  to a GLOBAL namespace — the rewriter would have to drop the kit binding
   *  and emit a bare global reference, which it can't splice mechanically, so
   *  `toReplSymbol` returns null (→ manual) rather than mis-attribute the
   *  global to the current file's kit (which produces a backwards rename:
   *  `intl.DateTimeOptions` -> `intl.DateTimeFormatOptions`, referencing a
   *  member that does not exist on `@ohos.intl`). */
  global?: boolean;
}

/** Standard JS global object/namespace names that can appear in a `@useinstead`
 *  token to mean "use the builtin, not an @ohos kit" (observed: `Intl.*`).
 *  Conservative set — extend only when the SDK actually emits more. */
const JS_GLOBALS = new Set([
  "Intl", "JSON", "Math", "console", "Date", "Promise", "Array", "Object",
  "Error", "Number", "String", "Boolean", "Map", "Set", "WeakMap", "WeakSet",
  "Symbol", "RegExp", "ArrayBuffer", "DataView", "Reflect", "Proxy",
]);

/**
 * @param token       the raw `@useinstead` value (single whitespace-free token)
 * @param knownKits   set of known kits in `ohos.x.y` form (no leading `@`),
 *                    used to bound the kit prefix in dot-path forms
 * @param fallbackKit the current file's kit in `@ohos.x.y` form, used to
 *                    resolve short forms that omit the `ohos.` prefix
 * @param kitLookup   optional map from lowercased `ohos.x.y` -> real-case kit,
 *                    enabling case-insensitive kit-prefix resolution. The SDK
 *                    occasionally uses wrong-cased kit qualifiers (e.g.
 *                    `@useinstead ohos.uitest.Component` for `@ohos.UiTest`);
 *                    without this, such targets resolve to no kit and the
 *                    replacement is misclassified as an unresolved manual.
 */
export function parseUseinstead(
  token: string,
  knownKits: Set<string>,
  fallbackKit?: string,
  kitLookup?: Map<string, string>,
): ParsedUseinstead {
  let rest = token;
  let kit: string | undefined;

  // A token rooted at a standard JS global (`Intl.DateTimeFormatOptions`)
  // names a builtin, not an @ohos kit. Detect this BEFORE the fallback-kit
  // branch would mis-attribute `Intl` to the current file's kit.
  const headEnd = rest.search(/[.#]/);
  const headIdent = headEnd === -1 ? rest : rest.slice(0, headEnd);
  if (JS_GLOBALS.has(headIdent)) {
    return { members: [], global: true };
  }

  if (rest.startsWith("ohos.")) {
    kit = longestKitPrefix(rest, knownKits, kitLookup);
    if (kit) {
      rest = rest.slice(kit.length); // kit stored without `@`; rest is the remainder
    } else {
      // Fallback: the token may omit middle kit segments (e.g.
      // `ohos.distributedDataObject.create` for `@ohos.data.distributedDataObject`).
      // Try the segment right after `ohos.` as a kit-name *suffix*; when it
      // resolves unambiguously, the rest of the token is the member chain.
      const afterOhos = rest.slice(5); // strip "ohos."
      const stop = afterOhos.search(/[.#]/);
      const head = stop === -1 ? afterOhos : afterOhos.slice(0, stop);
      const suffix = head ? resolveBySuffix(head, knownKits, kitLookup) : undefined;
      if (suffix) {
        kit = suffix;
        rest = stop === -1 ? "" : afterOhos.slice(stop);
      }
    }
  } else if (fallbackKit) {
    kit = fallbackKit.startsWith("@") ? fallbackKit.slice(1) : fallbackKit;
  }

  let exportName: string | undefined;
  if (rest.startsWith("/")) {
    const after = rest.slice(1);
    const stop = after.search(/[.#]/);
    exportName = stop === -1 ? after : after.slice(0, stop);
    rest = stop === -1 ? "" : after.slice(stop);
  } else if (rest.startsWith(".")) {
    // No `/export`: a leading identifier before the first `.`/`#` is the export.
    const stop = rest.search(/[.#]/);
    const head = stop === -1 ? rest : rest.slice(0, stop);
    if (head) {
      // Only treat as export if there is a trailing separator; a lone bare
      // member (no separator) stays a member.
      if (stop !== -1) exportName = head;
      rest = stop === -1 ? "" : rest.slice(stop);
    }
  } else if (rest.startsWith("#") || rest === "") {
    // `Type#member` or bare member: handled below.
  } else {
    // Bare-identifier short form (no ohos. prefix, no leading / . #).
    // If the leading identifier (up to the first `.`/`#`) matches a known
    // kit (`ohos.<head>`, case-insensitively when kitLookup is supplied),
    // treat it as the kit — e.g. `reminderAgentManager.publishReminder` ->
    // @ohos.reminderAgentManager. Otherwise the leading identifier is the
    // export name; a lone bare member with no separator stays a member.
    const stop = rest.search(/[.#]/);
    const head = stop === -1 ? rest : rest.slice(0, stop);
    const real = resolveKit("ohos." + head, knownKits, kitLookup);
    if (head && real) {
      kit = real;
      rest = stop === -1 ? "" : rest.slice(stop);
    } else if (head) {
      // Shorthand kit prefix: the head is the LAST segment of a known kit's
      // dotted name (e.g. `distributedDataObject` -> `@ohos.data.
      // distributedDataObject`, `preferences` -> `@ohos.data.preferences`).
      // Only resolve when unambiguous (exactly one kit ends with `.<head>`).
      const suffix = resolveBySuffix(head, knownKits, kitLookup);
      if (suffix) {
        kit = suffix;
        rest = stop === -1 ? "" : rest.slice(stop);
      } else if (stop !== -1) {
        exportName = head;
        rest = rest.slice(stop); // now starts with `.` or `#`
      }
    }
  }

  const members: string[] = [];
  while (rest.startsWith(".")) {
    const after = rest.slice(1);
    const stop = after.search(/[.#]/);
    const part = stop === -1 ? after : after.slice(0, stop);
    if (part) members.push(part);
    rest = stop === -1 ? "" : after.slice(stop);
  }
  if (rest.startsWith("#")) {
    const leaf = rest.slice(1);
    const stop = leaf.indexOf(".");
    const part = stop === -1 ? leaf : leaf.slice(0, stop);
    if (part) members.push(part);
  } else if (rest !== "") {
    // Trailing bare identifier with no separator — treat as a member.
    if (!exportName) members.push(rest);
  }

  const result: ParsedUseinstead = { members };
  if (kit) result.kit = "@" + kit;
  if (exportName) result.exportName = exportName;
  return result;
}

/** Return the longest `ohos.x.y` prefix of `rest` that is a known kit. */
function longestKitPrefix(
  rest: string,
  knownKits: Set<string>,
  kitLookup?: Map<string, string>,
): string | undefined {
  // Greedy by segments: try the whole `ohos.x.y...` run, then peel segments.
  const runMatch = rest.match(/^ohos\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*/);
  if (!runMatch) return undefined;
  const segments = runMatch[0].split(".");
  // segments[0] === "ohos"; candidates are ohos / ohos.a / ohos.a.b ...
  let best: string | undefined;
  for (let i = 2; i <= segments.length; i++) {
    const candidate = segments.slice(0, i).join(".");
    const real = resolveKit(candidate, knownKits, kitLookup);
    if (real) best = real;
  }
  return best;
}

/**
 * Resolve a candidate `ohos.x.y` (no leading `@`) to a known kit, exact-case
 * first, then case-insensitively via `kitLookup` when supplied. Returns the
 * real-case kit name (no `@`) or undefined.
 */
function resolveKit(
  candidate: string,
  knownKits: Set<string>,
  kitLookup?: Map<string, string>,
): string | undefined {
  if (knownKits.has(candidate)) return candidate;
  return kitLookup?.get(candidate.toLowerCase());
}

/**
 * Resolve a bare head to a kit when it is the LAST segment of exactly one
 * known kit's dotted name (case-insensitive), e.g. `distributedDataObject` ->
 * `@ohos.data.distributedDataObject`. Returns undefined when zero or multiple
 * kits end with `.<head>` (ambiguous) — the caller then treats the head as an
 * export name rather than risk a wrong kit.
 */
function resolveBySuffix(
  head: string,
  knownKits: Set<string>,
  kitLookup?: Map<string, string>,
): string | undefined {
  const needle = "." + head.toLowerCase();
  let match: string | undefined;
  for (const k of knownKits) {
    if (!k.toLowerCase().endsWith(needle)) continue;
    if (match && match !== k) return undefined; // ambiguous
    match = k;
  }
  if (match) return match;
  // kitLookup keys are lowercased; a bare head has no `ohos.` prefix, so the
  // lookup form is covered by the knownKits scan above. (Kept for parity.)
  void kitLookup;
  return undefined;
}

/** Best-effort human-readable rendering of a replacement symbol. */
export function describeReplacement(parsed: ParsedUseinstead | null): string | null {
  if (!parsed) return null;
  let s = parsed.kit ?? "(same kit)";
  if (parsed.exportName) s += "/" + parsed.exportName;
  if (parsed.members?.length) s += "#" + parsed.members[parsed.members.length - 1];
  return s;
}

/** Build a ReplSymbol (without the `@` on kit) for storage. Returns null
 *  for a global reference (see `ParsedUseinstead.global`): the @useinstead
 *  points at a JS builtin, which the rewriter cannot splice mechanically, so
 *  the entry falls back to manual rather than corrupt the call site. */
export function toReplSymbol(parsed: ParsedUseinstead): ReplSymbol | null {
  if (parsed.global) return null;
  const r: ReplSymbol = {};
  if (parsed.kit) r.kit = parsed.kit; // already `@ohos.x.y`
  if (parsed.exportName) r.exportName = parsed.exportName;
  if (parsed.members?.length) {
    // Strip parse artifacts. A real JS member name is a bare identifier; any
    // segment that isn't one is a leaked @useinstead token, not a code member:
    //   - `:` trailing event-name hints on `on`/`off` subscriptions
    //     (e.g. `connection.on#event:bluetoothDeviceFind` parses to
    //     `[on, event:bluetoothDeviceFind]`; the event name is already passed
    //     as a string arg at the call site, so the real replacement is `on`).
    //   - `(` / `"` / `'` from a `@useinstead` that names a *call* with a
    //     literal arg, e.g. `global#canIUse("SystemCapability.NFC.Core")` —
    //     the arg can't be spliced mechanically, so the symbol must fall back
    //     to `manual` (rewriter leaves it with a hint) rather than corrupt it.
    // Dropping the artifact segments yields the true member chain, which for a
    // path-preserving cross-kit move is byte-identical to the deprecated chain
    // and safe to rebind. When the artifact IS the leaf (the canIUse case),
    // nothing remains and the symbol becomes `manual`.
    r.members = parsed.members.filter((m) => /^[A-Za-z_$][\w$]*$/.test(m));
  }
  return r;
}
