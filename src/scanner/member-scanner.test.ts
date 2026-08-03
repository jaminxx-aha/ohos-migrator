import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMemberIndex, extractBindingMap, describeMemberReplacement } from "./member-scanner.js";
import type { DeprecationMap, DeprecationEntry, ReplSymbol } from "../rules/types.js";

function entry(kit: string, members: string[], repl: ReplSymbol | null): DeprecationEntry {
  return {
    dep: { kit, exportName: "x", members },
    since: 10,
    repl,
    kind: "member",
    source: { file: "", line: 0 },
  };
}

function mapOf(entries: DeprecationEntry[]): DeprecationMap {
  return { apiVersion: 12, sdkPath: "", generatedAt: "", entries, kitIndex: {} };
}

test("buildMemberIndex groups entries by kit and skips memberless entries", () => {
  const map = mapOf([
    entry("@ohos.router", ["pushUrl"], null),
    entry("@ohos.router", ["pushUrl"], null), // overload dupe
    entry("@ohos.x", [], null), // skipped (no members)
  ]);
  const idx = buildMemberIndex(map);
  assert.deepEqual(Object.keys(idx), ["@ohos.router"]);
  assert.equal(idx["@ohos.router"].length, 2);
});

test("extractBindingMap resolves default / namespace / named / aliased imports", () => {
  const content = `
import def from '@ohos.a';
import * as ns from '@ohos.b';
import { x, y as z } from '@ohos.c';
`;
  const m = extractBindingMap(content);
  assert.equal(m.get("def"), "@ohos.a");
  assert.equal(m.get("ns"), "@ohos.b");
  assert.equal(m.get("x"), "@ohos.c");
  assert.equal(m.get("z"), "@ohos.c");
});

test("describeMemberReplacement: same-kit rename is auto-fixable", () => {
  const r = describeMemberReplacement("router", { members: ["pushPath"] });
  assert.equal(r.rule, "rename-member");
  assert.equal(r.newSymbol, "router.pushPath");
});

test("describeMemberReplacement: cross-kit replacement is manual", () => {
  const r = describeMemberReplacement("router", {
    kit: "@ohos.uiContext",
    members: ["Router.pushUrl"],
  });
  assert.equal(r.rule, "manual");
  assert.equal(r.newSymbol, "@ohos.uiContext/Router.pushUrl");
  assert.ok(r.note.includes("@ohos.uiContext"));
});

test("describeMemberReplacement: no replacement is manual", () => {
  const r = describeMemberReplacement("router", null);
  assert.equal(r.rule, "manual");
  assert.equal(r.newSymbol, null);
});
