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

test("describeMemberReplacement: bare same-kit rename is auto-fixable", () => {
  const r = describeMemberReplacement("router", "@ohos.router", ["pushUrl"], {
    members: ["pushPath"],
  });
  assert.equal(r.rule, "rename-member");
  assert.equal(r.newSymbol, "router.pushPath");
  assert.equal(r.replacement, "router.pushPath");
});

test("describeMemberReplacement: same-kit rename with kit set is auto-fixable", () => {
  // repl.kit === dep.kit: legitimate same-kit rename, not cross-kit manual.
  const r = describeMemberReplacement("display", "@ohos.display", ["getDefaultDisplay"], {
    kit: "@ohos.display",
    members: ["getDefaultDisplaySync"],
  });
  assert.equal(r.rule, "rename-member");
  assert.equal(r.newSymbol, "display.getDefaultDisplaySync");
  assert.equal(r.replacement, "display.getDefaultDisplaySync");
});

test("describeMemberReplacement: multi-segment replacement without a kit is manual", () => {
  // Parse artifact: kit prefix not resolved -> must not be auto-applied.
  const r = describeMemberReplacement("dataStorage", "@ohos.data.storage", ["getStorage"], {
    members: ["preferences", "preferences", "getPreferences"],
  });
  assert.equal(r.rule, "manual");
  assert.equal(r.replacement, undefined);
});

test("describeMemberReplacement: cross-kit replacement is manual", () => {
  const r = describeMemberReplacement("router", "@ohos.router", ["pushUrl"], {
    kit: "@ohos.uiContext",
    members: ["Router.pushUrl"],
  });
  assert.equal(r.rule, "manual");
  assert.equal(r.newSymbol, "@ohos.uiContext/Router.pushUrl");
  assert.ok(r.note.includes("@ohos.uiContext"));
});

test("describeMemberReplacement: no replacement is manual", () => {
  const r = describeMemberReplacement("router", "@ohos.router", ["pushUrl"], null);
  assert.equal(r.rule, "manual");
  assert.equal(r.newSymbol, null);
});

test("describeMemberReplacement: no-op rename (same leaf) is manual", () => {
  // Deprecation whose @useinstead points to an identical symbol name: splicing
  // an identical string would be a confusing no-op, so it is left for review.
  const r = describeMemberReplacement("i18n", "@ohos.i18n", ["getSimpleDateTimeFormatByPattern"], {
    kit: "@ohos.i18n",
    members: ["getSimpleDateTimeFormatByPattern"],
  });
  assert.equal(r.rule, "manual");
  assert.equal(r.replacement, undefined);
  assert.ok(r.note.includes("identical"));
});
