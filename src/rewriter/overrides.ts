/**
 * Member-level override strategies.
 *
 * Some deprecated members have cross-kit `@useinstead` targets that require an
 * architectural change at the call site — e.g. `router.pushUrl` (since 18) →
 * `@ohos.arkui.UIContext`'s `Router.pushUrl`, which needs a runtime `UIContext`
 * instance. These cannot be fixed by rewriting an import specifier; the call
 * site itself must change.
 *
 * Rather than hardcode function names, we derive the rewrite from the parsed
 * `@useinstead` structure: when the replacement kit is `@ohos.arkui.UIContext`
 * and the member chain begins with `Router`, we rewrite
 *   `<binding>.<member>`  ->  `<uiContextExpr>.getRouter().<member>`
 *
 * `uiContextExpr` defaults to `this.getUIContext()` (valid inside ArkUI
 * `@Component` methods/lifecycle). Pass another expression for non-component
 * contexts (e.g. a stored UIContext variable).
 */

import type { ReplSymbol } from "../rules/types.js";

export interface OverrideResult {
  /** Exact text to splice in place of the matched symbol. */
  replacement: string;
  note: string;
}

const UICONTEXT_KIT = "@ohos.arkui.UIContext";

/**
 * Resolve an auto-fix override for a deprecated member, or null if none.
 *
 * @param kit           deprecated symbol's kit
 * @param members       deprecated symbol's member chain (leaf last)
 * @param repl          parsed @useinstead target (may be null)
 * @param uiContextExpr runtime expression yielding a UIContext
 */
export function findMemberOverride(
  kit: string,
  members: string[],
  repl: ReplSymbol | null,
  uiContextExpr: string,
): OverrideResult | null {
  if (!repl || repl.kit !== UICONTEXT_KIT) return null;
  if (!repl.members || repl.members.length < 2) return null;
  if (repl.members[0] !== "Router") return null;

  // e.g. repl.members = ["Router","pushUrl"] -> leaf chain ["pushUrl"]
  const leaf = repl.members.slice(1).join(".");
  void kit;
  void members;
  return {
    replacement: `${uiContextExpr}.getRouter().${leaf}`,
    note: `use UIContext.getRouter().${leaf}`,
  };
}
