import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMemberIndex, extractBindingMap, extractTypedVars, describeMemberReplacement, instanceFinding } from "./member-scanner.js";
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

test("describeMemberReplacement: no-op rename (same leaf) is suppressed", () => {
  // Deprecation whose @useinstead points to an identical symbol name: the call
  // site already targets the right symbol, so splicing would be a confusing
  // no-op. Suppress it (no finding, no rewrite).
  const r = describeMemberReplacement("i18n", "@ohos.i18n", ["getSimpleDateTimeFormatByPattern"], {
    kit: "@ohos.i18n",
    members: ["getSimpleDateTimeFormatByPattern"],
  });
  assert.equal(r.suppressed, true);
  assert.equal(r.replacement, undefined);
  assert.ok(r.note.includes("self-referential"));
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

test("extractTypedVars: resolves qualified and simple types from imports", () => {
  const content = `
import rm from '@ohos.resourceManager';
import { Context } from '@ohos.ability.featureAbility';
let r: rm.ResourceManager = null;
const c: Context = null;
function f(ctx: Context, u: rm.ResourceManager) {}
let untyped = null;
let generic: Array<string> = [];
`;
  const bindings = extractBindingMap(content);
  const vars = extractTypedVars(content, bindings);
  assert.equal(vars.get("r")?.kit, "@ohos.resourceManager");
  assert.equal(vars.get("r")?.typeHead, "ResourceManager");
  assert.equal(vars.get("c")?.kit, "@ohos.ability.featureAbility");
  assert.equal(vars.get("c")?.typeHead, "Context");
  assert.equal(vars.get("ctx")?.typeHead, "Context");
  assert.equal(vars.get("u")?.typeHead, "ResourceManager");
  // Untyped and generic declarations are NOT inferred (no false positive).
  assert.equal(vars.get("untyped"), undefined);
  assert.equal(vars.get("generic"), undefined);
});

// --- instanceFinding: type-preserving leaf rename ----------------------
// A two-segment repl whose first segment restates the (unchanged) type, e.g.
// `Window.show` -> repl `[Window, showWindow]`. With instanceSafe verified, the
// scanner splices `var.show` -> `var.showWindow` on the same receiver.

function instEntry(
  kit: string,
  exportName: string,
  members: string[],
  repl: ReplSymbol | null,
  opts: { instanceSafe?: boolean } = {},
): DeprecationEntry {
  return {
    dep: { kit, exportName, members },
    since: 9,
    repl,
    kind: "member",
    source: { file: "", line: 0 },
    ...(opts.instanceSafe ? { instanceSafe: true } : {}),
  };
}

const noMove = () => undefined;

test("instanceFinding: type-preserving 2-seg repl + instanceSafe -> rename-member", () => {
  // Window.show -> Window.showWindow, verified sibling.
  const e = instEntry("@ohos.window", "window", ["Window", "show"],
    { kit: "@ohos.window", members: ["Window", "showWindow"] }, { instanceSafe: true });
  const f = instanceFinding("p.ts", 0, 10, "win.show();", "win", ["show"], e, noMove);
  assert.ok(f);
  assert.equal(f!.rule, "rename-member");
  assert.equal(f!.replacement, "win.showWindow");
});

test("instanceFinding: type-preserving 2-seg repl without instanceSafe -> manual", () => {
  // Same shape but NOT sibling-verified -> must not auto-splice.
  const e = instEntry("@ohos.window", "window", ["Window", "show"],
    { kit: "@ohos.window", members: ["Window", "showWindow"] });
  const f = instanceFinding("p.ts", 0, 10, "win.show();", "win", ["show"], e, noMove);
  assert.ok(f);
  assert.equal(f!.rule, "manual");
  assert.ok(f!.newSymbol!.includes("showWindow"));
});

test("instanceFinding: 2-seg repl that changes the type -> manual", () => {
  // repl[0] !== typeHead (the type moves) -> not a same-receiver splice.
  const e = instEntry("@ohos.window", "window", ["Window", "show"],
    { kit: "@ohos.window", members: ["OtherType", "showWindow"] }, { instanceSafe: true });
  const f = instanceFinding("p.ts", 0, 10, "win.show();", "win", ["show"], e, noMove);
  assert.ok(f);
  assert.equal(f!.rule, "manual");
});

test("instanceFinding: single-leaf instanceSafe still auto-fixes", () => {
  // resourceManager.ResourceManager.getString -> getStringValue (single-seg repl).
  const e = instEntry("@ohos.resourceManager", "resourceManager", ["ResourceManager", "getString"],
    { kit: "@ohos.resourceManager", members: ["getStringValue"] }, { instanceSafe: true });
  const f = instanceFinding("p.ts", 0, 12, "rm.getString();", "rm", ["getString"], e, noMove);
  assert.ok(f);
  assert.equal(f!.rule, "rename-member");
  assert.equal(f!.replacement, "rm.getStringValue");
});

// --- instanceFinding: container cross-kit drop-in coverage -----------------
// An instance member whose *container* (exportName) moved cross-kit via a
// same-name drop-in is covered by the import-specifier rewrite: after the
// specifier is re-pointed, `cfg.language` resolves on the new Configuration.
// The instance finding is redundant and must be suppressed.

/** Resolver backed by a fixed { `${kit}\0${exportName}` -> targetKit } map. */
const dropinFrom = (table: Record<string, string>) =>
  (kit: string, exportName: string) => table[`${kit}\0${exportName}`];

test("instanceFinding: member of a container that cross-kit drop-in moved -> suppressed", () => {
  // Configuration.language: dep.kit=@ohos.application.Configuration, the
  // container Configuration moved to @ohos.app.ability.Configuration (drop-in),
  // and the member's @useinstead points to that same target with chain [language]
  // unchanged -> the import rewrite already covers `cfg.language`.
  const dropin = dropinFrom({
    "@ohos.application.Configuration\0Configuration": "@ohos.app.ability.Configuration",
  });
  const e = instEntry("@ohos.application.Configuration", "Configuration", ["language"],
    { kit: "@ohos.app.ability.Configuration", members: ["language"] });
  const f = instanceFinding("p.ts", 0, 11, "cfg.language", "cfg", ["language"], e, noMove, dropin);
  assert.equal(f, null); // suppressed — covered by rewrite-import
});

test("instanceFinding: member whose repl.kit differs from drop-in target -> NOT suppressed", () => {
  // Container Configuration moved to kit A, but the member's @useinstead points
  // to a *different* kit B -> the member did not travel with the container, so
  // the import rewrite does NOT cover it. Must still report manual.
  const dropin = dropinFrom({
    "@ohos.application.Configuration\0Configuration": "@ohos.app.ability.Configuration",
  });
  const e = instEntry("@ohos.application.Configuration", "Configuration", ["language"],
    { kit: "@ohos.some.other.kit", members: ["language"] });
  const f = instanceFinding("p.ts", 0, 11, "cfg.language", "cfg", ["language"], e, noMove, dropin);
  assert.ok(f);
  assert.equal(f!.rule, "manual");
  assert.equal(f!.needsManual, true);
});

test("instanceFinding: member whose repl chain differs -> NOT suppressed (shape changed)", () => {
  // Container moved via drop-in, but the member's replacement chain renamed the
  // leaf (language -> locale) -> the call shape changed; the import rewrite
  // alone does not cover it. Must report manual.
  const dropin = dropinFrom({
    "@ohos.application.Configuration\0Configuration": "@ohos.app.ability.Configuration",
  });
  const e = instEntry("@ohos.application.Configuration", "Configuration", ["language"],
    { kit: "@ohos.app.ability.Configuration", members: ["locale"] });
  const f = instanceFinding("p.ts", 0, 11, "cfg.language", "cfg", ["language"], e, noMove, dropin);
  assert.ok(f);
  assert.equal(f!.rule, "manual");
});

test("instanceFinding: no resolver -> never suppressed (backward compatible)", () => {
  // Without a containerDropin resolver, suppression is inert — a same-shape
  // cross-kit member falls through to manual (pre-existing behavior).
  const e = instEntry("@ohos.application.Configuration", "Configuration", ["language"],
    { kit: "@ohos.app.ability.Configuration", members: ["language"] });
  const f = instanceFinding("p.ts", 0, 11, "cfg.language", "cfg", ["language"], e, noMove);
  assert.ok(f);
  assert.equal(f!.rule, "manual");
});
