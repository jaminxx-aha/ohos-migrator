import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUseinstead, toReplSymbol, describeReplacement } from "./useinstead-parser.js";

const KITS = new Set([
  "ohos.router",
  "ohos.app.ability.dataUriUtils",
  "ohos.resourceschedule.backgroundTaskManager",
  "ohos.promptAction",
]);

test("ohos-prefixed with /export and .member", () => {
  const r = parseUseinstead("ohos.router/Router.pushUrl", KITS);
  assert.equal(r.kit, "@ohos.router");
  assert.equal(r.exportName, "Router");
  assert.deepEqual(r.members, ["pushUrl"]);
});

test("pure-dot form resolves longest known kit prefix", () => {
  const r = parseUseinstead(
    "ohos.resourceschedule.backgroundTaskManager.DelaySuspendInfo",
    KITS,
  );
  assert.equal(r.kit, "@ohos.resourceschedule.backgroundTaskManager");
  assert.deepEqual(r.members, ["DelaySuspendInfo"]);
});

test("short form with #leaf uses fallback kit", () => {
  const r = parseUseinstead("appAccount.AppAccountManager#createAccount", KITS, "@ohos.appAccount");
  assert.equal(r.kit, "@ohos.appAccount");
  assert.equal(r.exportName, "appAccount");
  assert.deepEqual(r.members, ["AppAccountManager", "createAccount"]);
});

test("bare member with fallback kit", () => {
  const r = parseUseinstead("pushUrl", KITS, "@ohos.router");
  assert.equal(r.kit, "@ohos.router");
  assert.deepEqual(r.members, ["pushUrl"]);
});

test("no ohos prefix and no fallback leaves kit undefined", () => {
  const r = parseUseinstead("pushUrl", KITS);
  assert.equal(r.kit, undefined);
  assert.deepEqual(r.members, ["pushUrl"]);
});

test("bare identifier matching a known kit resolves as kit", () => {
  // `reminderAgentManager` is a known kit (ohos.reminderAgentManager); a bare
  // token like `reminderAgentManager.publishReminder` must resolve its kit
  // rather than falling back to the importing file's kit.
  const kits = new Set([...KITS, "ohos.reminderAgentManager"]);
  const r = parseUseinstead("reminderAgentManager.publishReminder", kits, "@ohos.reminderAgent");
  assert.equal(r.kit, "@ohos.reminderAgentManager");
  assert.deepEqual(r.members, ["publishReminder"]);
});

test("toReplSymbol normalizes kit with leading @", () => {
  const r = toReplSymbol(parseUseinstead("ohos.router/Router.pushUrl", KITS));
  assert.equal(r.kit, "@ohos.router");
  assert.equal(r.exportName, "Router");
  assert.deepEqual(r.members, ["pushUrl"]);
});

test("describeReplacement renders kit/export/leaf", () => {
  const s = describeReplacement(parseUseinstead("ohos.router/Router.pushUrl", KITS));
  assert.equal(s, "@ohos.router/Router#pushUrl");
});

test("describeReplacement returns null for no input", () => {
  assert.equal(describeReplacement(null), null);
});
