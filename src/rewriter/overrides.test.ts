import { test } from "node:test";
import assert from "node:assert/strict";
import { findMemberOverride } from "./overrides.js";

const UI = "@ohos.arkui.UIContext";
const WIN = "@ohos.window";

const ctx = {
  uiContextExpr: "this.getUIContext()",
  windowStageExpr: "this.windowStage",
  windowExpr: "this.window",
};

test("UIContext Router override -> getRouter().<leaf>", () => {
  const r = findMemberOverride(
    "@ohos.router",
    ["pushUrl"],
    { kit: UI, members: ["Router", "pushUrl"] },
    ctx,
  );
  assert.equal(r?.replacement, "this.getUIContext().getRouter().pushUrl");
});

test("UIContext PromptAction override -> getPromptAction().<leaf>", () => {
  const r = findMemberOverride(
    "@ohos.prompt",
    ["showToast"],
    { kit: UI, members: ["PromptAction", "showToast"] },
    ctx,
  );
  assert.equal(r?.replacement, "this.getUIContext().getPromptAction().showToast");
});

test("UIContext Font override uses get<Head>() pattern", () => {
  const r = findMemberOverride(
    "@ohos.i18n",
    ["registerFont"],
    { kit: UI, members: ["Font", "registerFont"] },
    ctx,
  );
  assert.equal(r?.replacement, "this.getUIContext().getFont().registerFont");
});

test("UIContext self head (UIContext) calls directly on the context", () => {
  const r = findMemberOverride(
    "@ohos.animator",
    ["createAnimator"],
    { kit: UI, members: ["UIContext", "createAnimator"] },
    ctx,
  );
  assert.equal(r?.replacement, "this.getUIContext().createAnimator");
});

test("window WindowStage override -> <windowStageExpr>.<leaf>", () => {
  // FAModel Context.setShowOnLockScreen -> WindowStage.setShowOnLockScreen
  const r = findMemberOverride(
    "@ohos.ability.featureAbility",
    ["setShowOnLockScreen"],
    { kit: WIN, members: ["WindowStage", "setShowOnLockScreen"] },
    ctx,
  );
  assert.equal(r?.replacement, "this.windowStage.setShowOnLockScreen");
});

test("window Window override -> <windowExpr>.<leaf>", () => {
  const r = findMemberOverride(
    "@ohos.ability.featureAbility",
    ["setWakeUpScreen"],
    { kit: WIN, members: ["Window", "setWakeUpScreen"] },
    ctx,
  );
  assert.equal(r?.replacement, "this.window.setWakeUpScreen");
});

test("same-kit replacement is NOT overridden (left to rename-member)", () => {
  // window.Window.show -> window.Window.showWindow is same-kit; the recipe must
  // not fire (would produce a wrong `this.window.showWindow` splice).
  const r = findMemberOverride(
    "@ohos.window",
    ["Window", "show"],
    { kit: WIN, members: ["Window", "showWindow"] },
    ctx,
  );
  assert.equal(r, null);
});

test("non-recipe replacement kit has no override -> manual", () => {
  const r = findMemberOverride(
    "@ohos.data.rdb",
    ["getRdbStore"],
    { kit: "@ohos.data.relationalStore", members: ["getRdbStore"] },
    ctx,
  );
  assert.equal(r, null);
});

test("null replacement yields no override", () => {
  const r = findMemberOverride("@ohos.router", ["pushUrl"], null, ctx);
  assert.equal(r, null);
});

test("custom receiver expressions are respected", () => {
  const r = findMemberOverride(
    "@ohos.prompt",
    ["showToast"],
    { kit: UI, members: ["PromptAction", "showToast"] },
    { ...ctx, uiContextExpr: "this.ctx_" },
  );
  assert.equal(r?.replacement, "this.ctx_.getPromptAction().showToast");
});

test("custom window-stage expression is respected", () => {
  const r = findMemberOverride(
    "@ohos.ability.featureAbility",
    ["setShowOnLockScreen"],
    { kit: WIN, members: ["WindowStage", "setShowOnLockScreen"] },
    { ...ctx, windowStageExpr: "this.stage" },
  );
  assert.equal(r?.replacement, "this.stage.setShowOnLockScreen");
});
