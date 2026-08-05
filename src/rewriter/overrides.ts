/**
 * Member-level override recipes.
 *
 * Some deprecated members have cross-kit `@useinstead` targets that require an
 * architectural change at the call site: the replacement is an instance method
 * on a runtime object that the caller must first obtain. These cannot be fixed
 * by rewriting an import specifier; the call site itself must change.
 *
 * Example: `router.pushUrl` (since 18) -> `@ohos.arkui.UIContext`'s
 * `Router.pushUrl`, which needs a runtime `UIContext` instance, obtained via
 * `getRouter()` on it.
 *
 * Rather than hardcode function names, we derive the rewrite from the parsed
 * `@useinstead` structure plus a small, extensible recipe table keyed by the
 * replacement kit. Each recipe knows how to turn the replacement's first
 * member (the receiver type, e.g. `Router`, `PromptAction`) into a runtime
 * accessor expression on a context the caller already holds.
 *
 * `uiContextExpr` (CLI `--ui-context`) is the expression yielding a UIContext
 * inside the user's call site; it defaults to `this.getUIContext()` (valid in
 * ArkUI `@Component` methods/lifecycle). Pass another expression for
 * non-component contexts (e.g. a stored UIContext variable).
 */

import type { ReplSymbol } from "../rules/types.js";

export interface OverrideResult {
  /** Exact text to splice in place of the matched symbol. */
  replacement: string;
  note: string;
}

/**
 * A recipe produces the receiver expression for a replacement whose first
 * member names a sub-object type. Returns null when the recipe cannot resolve
 * this (head) — the caller then falls back to manual.
 */
export interface Recipe {
  /**
   * @param head   the first member of the replacement chain (receiver type)
   * @param leaf   the remaining member chain (leaf last), possibly empty
   * @param ctx    runtime expressions supplied by the caller
   * @returns receiver expression + note, or null
   */
  resolve(head: string, leaf: string[], ctx: RecipeCtx): OverrideResult | null;
}

export interface RecipeCtx {
  /** Expression yielding a UIContext (e.g. `this.getUIContext()`). */
  uiContextExpr: string;
}

const UICONTEXT_KIT = "@ohos.arkui.UIContext";

/**
 * UIContext recipe: every sub-object (Router, PromptAction, Font, Animator,
 * DragController, ComponentSnapshot, ComponentUtils, MeasureUtils, MediaQuery,
 * UIInspector, ...) is reached through a `get<Head>()` accessor on the
 * UIContext instance. The one exception is `UIContext` itself (the instance
 * the caller already holds) — its members are called directly on the context.
 */
const uiContextRecipe: Recipe = {
  resolve(head, leaf, ctx) {
    const receiver =
      head === "UIContext"
        ? ctx.uiContextExpr
        : `${ctx.uiContextExpr}.get${head}()`;
    const leafChain = leaf.length ? "." + leaf.join(".") : "";
    return {
      replacement: `${receiver}${leafChain}`,
      note: `use ${head === "UIContext" ? "UIContext" : `UIContext.get${head}()`}${leafChain}`,
    };
  },
};

/**
 * Recipe table keyed by replacement kit. Add entries here to teach the
 * rewriter how to obtain other runtime receivers (e.g. a WindowStage from a
 * Window instance). Kits absent from the table fall back to manual.
 */
const RECIPES: Record<string, Recipe> = {
  [UICONTEXT_KIT]: uiContextRecipe,
};

/**
 * Resolve an auto-fix override for a deprecated member, or null if none.
 *
 * @param kit           deprecated symbol's kit
 * @param members       deprecated symbol's member chain (leaf last) — unused
 *                      by the current recipes but kept for future ones
 * @param repl          parsed @useinstead target (may be null)
 * @param uiContextExpr runtime expression yielding a UIContext
 */
export function findMemberOverride(
  kit: string,
  members: string[],
  repl: ReplSymbol | null,
  uiContextExpr: string,
): OverrideResult | null {
  void kit;
  void members;
  if (!repl || !repl.kit) return null;
  const recipe = RECIPES[repl.kit];
  if (!recipe) return null;
  if (!repl.members || repl.members.length === 0) return null;

  const head = repl.members[0];
  const leaf = repl.members.slice(1);
  return recipe.resolve(head, leaf, { uiContextExpr });
}
