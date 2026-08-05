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

test("describeMemberReplacement: same-kit multi-segment replacement without a kit is manual", () => {
  // Parse artifact: kit prefix not resolved -> must not be auto-applied.
  const r = describeMemberReplacement("dataStorage", "@ohos.data.storage", ["getStorage"], {
    members: ["preferences", "preferences", "getPreferences"],
  });
  assert.equal(r.rule, "manual");
  assert.equal(r.replacement, undefined);
});

test("describeMemberReplacement: same-kit container-rename is rename-member", () => {
  // `rpc.MessageParcel.create` -> `rpc.MessageSequence.create`: same kit, same
  // length, a non-leaf (container) segment changes. The whole chain is spliced.
  const r = describeMemberReplacement("rpc", "@ohos.rpc", ["MessageParcel", "create"], {
    kit: "@ohos.rpc", members: ["MessageSequence", "create"],
  });
  assert.equal(r.rule, "rename-member");
  assert.equal(r.newSymbol, "rpc.MessageSequence.create");
  assert.equal(r.replacement, "rpc.MessageSequence.create");
});

test("describeMemberReplacement: same-kit full-chain rename (container+leaf) is rename-member", () => {
  // `media.MediaErrorCode.MSERR_OK` -> `media.AVErrorCode.AVERR_OK`: both the
  // container and the leaf change, same length -> spliced wholesale.
  const r = describeMemberReplacement("media", "@ohos.multimedia.media", ["MediaErrorCode", "MSERR_OK"], {
    kit: "@ohos.multimedia.media", members: ["AVErrorCode", "AVERR_OK"],
  });
  assert.equal(r.rule, "rename-member");
  assert.equal(r.replacement, "media.AVErrorCode.AVERR_OK");
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

// --- kit-move alignment -------------------------------------------------
// A cross-kit replacement whose kit equals the deprecated kit's indexed move
// target is "effectively same-kit": rewrite-import re-points the binding.

test("describeMemberReplacement: aligned no-op (chain identical) is suppressed", () => {
  // `@ohos.ability.dataUriUtils` -> `@ohos.app.ability.dataUriUtils` (kit move);
  // member `dataUriUtils.getId` lives unchanged on the re-pointed binding.
  const kitMove = (k: string) => (k === "@ohos.ability.dataUriUtils" ? "@ohos.app.ability.dataUriUtils" : undefined);
  const r = describeMemberReplacement(
    "dataUriUtils", "@ohos.ability.dataUriUtils", ["getId"],
    { kit: "@ohos.app.ability.dataUriUtils", members: ["getId"] },
    kitMove,
  );
  assert.equal(r.suppressed, true);
  assert.ok(r.note.includes("kit move"));
});

test("describeMemberReplacement: aligned leaf-rename is rename-member", () => {
  // `@ohos.bluetooth` -> `@ohos.bluetoothManager` (kit move); the member leaf
  // changes on the re-pointed binding: `getProfileConnState` -> `getProfileConnectionState`.
  const kitMove = (k: string) => (k === "@ohos.bluetooth" ? "@ohos.bluetoothManager" : undefined);
  const r = describeMemberReplacement(
    "bluetooth", "@ohos.bluetooth", ["getProfileConnState"],
    { kit: "@ohos.bluetoothManager", members: ["getProfileConnectionState"] },
    kitMove,
  );
  assert.equal(r.rule, "rename-member");
  assert.equal(r.newSymbol, "bluetooth.getProfileConnectionState");
  assert.equal(r.replacement, "bluetooth.getProfileConnectionState");
  assert.ok(r.note.includes("kit move"));
});

test("describeMemberReplacement: aligned container-rename is rename-member", () => {
  // Kit moves and a non-leaf (container) segment changes on the re-pointed
  // binding, same length, leaf preserved -> a same-length chain splice.
  const kitMove = (k: string) => (k === "@ohos.a" ? "@ohos.b" : undefined);
  const r = describeMemberReplacement(
    "a", "@ohos.a", ["Flags", "X"],
    { kit: "@ohos.b", members: ["Y", "X"] },
    kitMove,
  );
  assert.equal(r.rule, "rename-member");
  assert.equal(r.newSymbol, "a.Y.X");
  assert.equal(r.replacement, "a.Y.X");
  assert.ok(r.note.includes("kit move"));
});

test("describeMemberReplacement: aligned length-diff stays manual", () => {
  // Kit moves but the chain length changes — call shape changed, not a splice.
  const kitMove = (k: string) => (k === "@ohos.a" ? "@ohos.b" : undefined);
  const r = describeMemberReplacement(
    "a", "@ohos.a", ["Flags", "X"],
    { kit: "@ohos.b", members: ["Y"] },
    kitMove,
  );
  assert.equal(r.rule, "manual");
  assert.equal(r.suppressed, undefined);
});

test("describeMemberReplacement: cross-kit without alignment is manual", () => {
  // repl.kit set but does NOT match any kit move -> genuine cross-kit, manual.
  const kitMove = (k: string) => (k === "@ohos.a" ? "@ohos.b" : undefined);
  const r = describeMemberReplacement(
    "a", "@ohos.a", ["foo"],
    { kit: "@ohos.unrelated", members: ["foo"] },
    kitMove,
  );
  assert.equal(r.rule, "manual");
  assert.ok(r.note.includes("@ohos.unrelated"));
});
