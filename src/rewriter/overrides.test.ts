import { test } from "node:test";
import assert from "node:assert/strict";
import { findMemberOverride } from "./overrides.js";

const UI = "@ohos.arkui.UIContext";

test("UIContext Router override -> getRouter().<leaf>", () => {
  const r = findMemberOverride(
    "@ohos.router",
    ["pushUrl"],
    { kit: UI, members: ["Router", "pushUrl"] },
    "this.getUIContext()",
  );
  assert.equal(r?.replacement, "this.getUIContext().getRouter().pushUrl");
});

test("UIContext PromptAction override -> getPromptAction().<leaf>", () => {
  const r = findMemberOverride(
    "@ohos.prompt",
    ["showToast"],
    { kit: UI, members: ["PromptAction", "showToast"] },
    "this.getUIContext()",
  );
  assert.equal(r?.replacement, "this.getUIContext().getPromptAction().showToast");
});

test("UIContext Font override uses get<Head>() pattern", () => {
  const r = findMemberOverride(
    "@ohos.i18n",
    ["registerFont"],
    { kit: UI, members: ["Font", "registerFont"] },
    "ctx",
  );
  assert.equal(r?.replacement, "ctx.getFont().registerFont");
});

test("UIContext self head (UIContext) calls directly on the context", () => {
  const r = findMemberOverride(
    "@ohos.animator",
    ["createAnimator"],
    { kit: UI, members: ["UIContext", "createAnimator"] },
    "ctx",
  );
  assert.equal(r?.replacement, "ctx.createAnimator");
});

test("non-UIContext replacement kit has no override -> manual", () => {
  const r = findMemberOverride(
    "@ohos.data.rdb",
    ["getRdbStore"],
    { kit: "@ohos.data.relationalStore", members: ["getRdbStore"] },
    "ctx",
  );
  assert.equal(r, null);
});

test("null replacement yields no override", () => {
  const r = findMemberOverride("@ohos.router", ["pushUrl"], null, "ctx");
  assert.equal(r, null);
});

test("custom uiContextExpr is respected", () => {
  const r = findMemberOverride(
    "@ohos.prompt",
    ["showToast"],
    { kit: UI, members: ["PromptAction", "showToast"] },
    "this.ctx_",
  );
  assert.equal(r?.replacement, "this.ctx_.getPromptAction().showToast");
});
