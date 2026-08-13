import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  findSymbolOverride,
  symbolOverrideKey,
  loadSymbolOverrides,
  resetSymbolOverrides,
} from "./symbol-overrides.js";

// Fixtures live under test/fixtures/ (not under src/) so they survive the
// tsc emit-to-dist step intact; resolve from the compiled test's location back
// to the project root, matching scanner.integration.test.ts.
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE = resolve(
  __dirname,
  "..",
  "..",
  "test",
  "fixtures",
  "symbol-overrides.test.json",
);

const KC = "@ohos.ability.wantConstant";
const NS = "wantConstant";

test("wantConstant Action.ACTION_HOME -> home literal", () => {
  const r = findSymbolOverride(KC, NS, ["Action", "ACTION_HOME"]);
  assert.equal(r?.replacement, "'ohos.want.action.home'");
});

test("wantConstant Action enum value carries the literal in its note", () => {
  const r = findSymbolOverride(KC, NS, ["Action", "ACTION_DIAL"]);
  assert.equal(r?.replacement, "'ohos.want.action.dial'");
  assert.match(r?.note ?? "", /removed in successor kit/);
});

test("wantConstant Entity.ENTITY_HOME -> home literal", () => {
  const r = findSymbolOverride(KC, NS, ["Entity", "ENTITY_HOME"]);
  assert.equal(r?.replacement, "'entity.system.home'");
});

test("commonEventManager Support.COMMON_EVENT_USER_PRESENT -> event literal", () => {
  const r = findSymbolOverride("@ohos.commonEventManager", "commonEventManager", ["Support", "COMMON_EVENT_USER_PRESENT"]);
  assert.equal(r?.replacement, "'usual.event.USER_PRESENT'");
  assert.match(r?.note ?? "", /removed in successor kit/);
});

test("commonEventManager bluetooth host event -> stable bluetooth literal", () => {
  const r = findSymbolOverride(
    "@ohos.commonEventManager",
    "commonEventManager",
    ["Support", "COMMON_EVENT_BLUETOOTH_HOST_NAME_UPDATE"],
  );
  assert.equal(r?.replacement, "'usual.event.bluetooth.host.NAME_UPDATE'");
});

test("commonEventManager Support CONTAINER itself is NOT overridden", () => {
  assert.equal(findSymbolOverride("@ohos.commonEventManager", "commonEventManager", ["Support"]), null);
});

test("the Action CONTAINER itself is NOT overridden (type ref, not a value)", () => {
  // `wantConstant.Action` (members=[Action]) has no leaf — left manual so a
  // type reference is never spliced to a string literal.
  assert.equal(findSymbolOverride(KC, NS, ["Action"]), null);
  assert.equal(findSymbolOverride(KC, NS, undefined), null);
});

test("a non-seeded symbol yields no override", () => {
  assert.equal(findSymbolOverride("@ohos.account.appAccount", "appAccount", ["ResultCode", "SUCCESS"]), null);
});

test("symbolOverrideKey is NUL-separated so dotted FIELD values stay distinct", () => {
  // NUL separates the three fields (kit / exportName / members.join(".")), so
  // a kit containing a dot can't collide with a kit-less dotted export chain.
  // `["a.b"]` as members would join to "a.b"; with NUL fields, kit "a.b" + no
  // export + no members stays distinct from kit "a" + export "b" + no members.
  const k1 = symbolOverrideKey("a.b", undefined, undefined);
  const k2 = symbolOverrideKey("a", "b", undefined);
  assert.notEqual(k1, k2);
  // sanity: the same triple round-trips
  const k3 = symbolOverrideKey(KC, NS, ["Action", "ACTION_HOME"]);
  const k4 = symbolOverrideKey(KC, NS, ["Action", "ACTION_HOME"]);
  assert.equal(k3, k4);
});

test("a JSON override file merges over the builtin and wins on collision", () => {
  const merged = loadSymbolOverrides(FIXTURE);
  // builtin entry still present
  assert.equal(merged[symbolOverrideKey(KC, NS, ["Action", "ACTION_HOME"])].replacement, "'ohos.want.action.home'");
  // user file added a non-builtin symbol
  const added = findSymbolOverride("@ohos.fake", "fake", ["A", "B"]);
  assert.equal(added?.replacement, "'replaced'");
  // user file overrode a builtin entry
  const overridden = findSymbolOverride(KC, NS, ["Action", "ACTION_DIAL"]);
  assert.equal(overridden?.replacement, "'custom-dial'");
  resetSymbolOverrides();
  // after reset, the override is gone
  assert.equal(findSymbolOverride(KC, NS, ["Action", "ACTION_DIAL"])?.replacement, "'ohos.want.action.dial'");
});

test("missing override file path leaves the builtin table active", () => {
  const before = findSymbolOverride(KC, NS, ["Action", "ACTION_HOME"]);
  loadSymbolOverrides("/does/not/exist.json");
  const after = findSymbolOverride(KC, NS, ["Action", "ACTION_HOME"]);
  assert.deepEqual(after, before);
});
