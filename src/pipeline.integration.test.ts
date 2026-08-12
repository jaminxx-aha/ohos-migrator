/**
 * End-to-end pipeline tests covering every migration branch.
 *
 * Three layers, each exercised through its public API with hermetic fixtures:
 *
 * 1. Indexer (`buildDeprecationMap`) — built against a synthetic SDK tree that
 *    exercises: top-level kits, nested files resolved via `import * as` and
 *    `import {Name}` re-exports, unresolved nested files (`@?`), `.d.ets`,
 *    `@internal/**` skipping, and the bare-kit `@useinstead` resolution.
 * 2. Scanner (`scanProject` + `scanProjectMembers`) — every rule kind:
 *    rewrite-import, rename-member, override (all UIContext heads), and the
 *    manual family (no @useinstead, cross-kit non-override,
 *    unresolved chain), plus `--since` filtering.
 * 3. Rewriter (`rewriteProject`) — dry-run vs --write, multiple edits applied
 *    bottom-up, custom UIContext expression, overload dedup.
 *
 * Fixtures are written to a per-test temp directory so nothing leaks.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

import { buildDeprecationMap } from "./indexer/sdk-indexer.js";
import { scanProject, scanProjectExportRenames, scanProjectCrossKitDropin } from "./scanner/scanner.js";
import { scanProjectMembers, scanProjectInstanceMembers } from "./scanner/member-scanner.js";
import { rewriteProject } from "./rewriter/rewriter.js";
import type { DeprecationMap, DeprecationEntry, ReplSymbol } from "./rules/types.js";

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

/** Write a map of relpath -> content under a fresh temp dir. */
function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ohos-e2e-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Build a synthetic map entry. */
function entry(
  kit: string,
  members: string[],
  repl: ReplSymbol | null,
  since = 10,
): DeprecationEntry {
  return {
    dep: { kit, exportName: "x", members },
    since,
    repl,
    kind: "member",
    source: { file: "", line: 0 },
  };
}

/** A flat synthetic map (no real SDK needed) for scan/rewrite tests. */
function mapOf(
  entries: DeprecationEntry[],
  kitIndex: DeprecationMap["kitIndex"] = {},
  exportIndex: DeprecationMap["exportIndex"] = {},
  crossKitDropin: DeprecationMap["crossKitDropin"] = {},
  crossKitRenameExport: DeprecationMap["crossKitRenameExport"] = {},
): DeprecationMap {
  return { apiVersion: 12, sdkPath: "", generatedAt: "", entries, kitIndex, exportIndex, crossKitDropin, crossKitRenameExport };
}

const UI = "@ohos.arkui.UIContext";

/** Find a finding by its oldSymbol. */
function bySymbol(findings: ReturnType<typeof scanProject>["findings"], sym: string) {
  return findings.find((f) => f.oldSymbol === sym);
}

/* ------------------------------------------------------------------ */
/* 1. Indexer — synthetic SDK tree                                    */
/* ------------------------------------------------------------------ */

const SDK_FILES: Record<string, string> = {
  // Top-level kit with a module-move (namespace deprecated, cross-kit
  // useinstead). `reminderAgentManager` is a bare identifier that must be
  // resolved as a known kit (not a member of the current kit).
  "@ohos.reminderAgent.d.ts": `
declare namespace reminderAgent {}
/** @since 9 @deprecated since 9 @useinstead reminderAgentManager */
declare namespace reminderAgent {}
`,
  "@ohos.reminderAgentManager.d.ts": `
/** @since 9 */
declare namespace reminderAgentManager {
  /** @since 9 @deprecated since 9 @useinstead reminderAgentManager.publishReminder */
  function publishReminder(): void;
}
`,
  // Top-level kit with deprecated members (same-kit rename + cross-kit override).
  // Note: UIContext targets use the real `.<Head>#<leaf>` grammar (not `/`).
  "@ohos.router.d.ts": `
declare namespace router {
  /** @since 8 @deprecated since 9 @useinstead ohos.router.router#pushUrl */
  function push(o: any): void;
  /** @since 11 @deprecated since 18 @useinstead ohos.arkui.UIContext.Router#pushUrl */
  function pushUrl(o: any): void;
}
`,
  "@ohos.prompt.d.ts": `
declare namespace prompt {
  /** @since 9 @deprecated since 9 @useinstead ohos.arkui.UIContext.PromptAction#showToast */
  function showToast(o: any): void;
}
`,
  // Must exist so `ohos.arkui.UIContext` is a known kit for useinstead parsing.
  "@ohos.arkui.UIContext.d.ts": `
declare namespace UIContext {}
`,
  // Nested file re-exported via `import * as` -> attributed to this kit.
  "@ohos.bundle.bundleManager.d.ts": `
import * as _AppInfo from './bundleManager/ApplicationInfo';
declare namespace bundleManager {
  export type ApplicationInfo = _AppInfo.ApplicationInfo;
}
`,
  "bundleManager/ApplicationInfo.d.ts": `
export interface ApplicationInfo {
  /** @since 9 @deprecated since 10 @useinstead ApplicationInfo#metadataArray */
  metadata: string;
}
`,
  // Nested file re-exported via named import.
  "@ohos.app.ability.d.ts": `
import { Context as _Context } from './app/context';
declare namespace ability { export type Context = _Context.Context; }
`,
  "app/context.d.ts": `
export interface Context {
  /** @since 7 @deprecated since 9 @useinstead ohos.window/window.WindowStage#setShowOnLockScreen */
  setShowOnLockScreen(v: boolean): void;
}
`,
  // Nested file NOT re-exported anywhere -> @? synthetic kit.
  "orphan/inside.d.ts": `
export interface Orphan {
  /** @since 9 @deprecated since 12 @useinstead ohos.x#y */
  m(): void;
}
`,
  // .d.ets is indexed (parsed as TS).
  "@ohos.arkui.advanced.ChipGroup.d.ets": `
export interface ChipOptions {
  /** @since 12 @deprecated since 14 @useinstead ChipOptions#size */
  oldSize: string;
}
`,
  // @internal is skipped entirely.
  "@internal/full/featureability.d.ts": `
declare namespace featureAbility {
  /** @since 6 @deprecated since 9 @useinstead ohos.app.ability.dataUriUtils */
  function getData(): void;
}
`,
  // Transitive re-export (two levels): @ohos.fake imports Outer (named),
  // Outer imports Inner. Inner must attribute to @ohos.fake, not @?.
  "@ohos.fake.d.ts": `
import { Outer } from './fake/outer';
declare namespace fake { export type Outer = Outer; }
`,
  "fake/outer.d.ts": `
import { Inner } from './inner';
export interface Outer { inner: Inner; }
`,
  "fake/inner.d.ts": `
export interface Inner {
  /** @since 9 @deprecated since 10 @useinstead Inner#newName */
  old: string;
}
`,
  // Re-export statement: `export { Thing } from './mod/thing'` binds the
  // nested file to this kit (the import-only tracer would miss it -> @?).
  "@ohos.mod.d.ts": `
export { Thing } from './mod/thing';
`,
  "mod/thing.d.ts": `
export interface Thing {
  /** @since 9 @deprecated since 10 @useinstead Thing#newName */
  old: string;
}
`,
  // Legacy `@system.*` kits are top-level importable modules (pre-API-9),
  // not nested files. They must be attributed to their own kit, not `@?`.
  "@system.router.d.ts": `
/** @syscap x @since 3 @deprecated since 8 @useinstead ohos.router#RouterOptions */
export interface RouterOptions { uri: string }
`,
  // Regression: a nested namespace inside a kit, deprecated with a cross-kit
  // @useinstead, must NOT register a kit-level module move for the whole kit.
  // (Once falsely moved `@ohos.bluetoothManager` -> `@ohos.bluetooth.ble`
  // because a nested `namespace BLE` carried a member @useinstead.)
  "@ohos.fakeKit.d.ts": `
declare namespace fakeKit {
  /**
   * @since 9 @deprecated since 10 @useinstead ohos.otherKit/otherSub
   */
  namespace Sub {
    /** @since 9 @deprecated since 10 @useinstead ohos.otherKit/foo */
    function bar(): void;
  }
}
`,
  // Module-style file (no `declare namespace`) whose named export is deprecated
  // with a whole-export @useinstead (`ohos.X/Y` -> repl.exportName, no members).
  // Must surface as a cross-kit same-name drop-in for the named-import scanner.
  "@ohos.application.Configuration.d.ts": `
/** @since 8 @deprecated since 9 @useinstead ohos.app.ability.Configuration/Configuration */
export interface Configuration { lang: string }
`,
  "@ohos.app.ability.Configuration.d.ts": `
declare namespace Configuration {}
`,
  // Default-export move: `export default class Want` deprecated ->
  // @ohos.app.ability.Want. A default import rewrites only the specifier.
  "@ohos.application.Want.d.ts": `
/** @since 8 @deprecated since 9 @useinstead ohos.app.ability.Want/Want */
export default class Want { bundle: string }
`,
  "@ohos.app.ability.Want.d.ts": `
declare namespace Want {}
`,
  // Cross-kit single-leaf member move: `particleAbility.startBackgroundRunning`
  // -> `@ohos.resourceschedule.backgroundTaskManager.startBackgroundRunning`.
  // The kit did NOT move as a whole; the indexer must verify the replacement
  // leaf is a top-level export of the target kit and flag the entry
  // `crossKitMemberDropin` so the scanner injects an import + rebinds.
  "@ohos.ability.particleAbility.d.ts": `
declare namespace particleAbility {
  /** @since 7 @deprecated since 9 @useinstead ohos.resourceschedule.backgroundTaskManager.startBackgroundRunning */
  function startBackgroundRunning(ctx: string): void;
}
`,
  "@ohos.resourceschedule.backgroundTaskManager.d.ts": `
declare namespace backgroundTaskManager {
  /** @since 9 */
  function startBackgroundRunning(ctx: string): void;
}
`,
  // Cross-kit 2-segment path-preserving member move: the nested namespace
  // A2dpSourceProfile (and its member connect) moved wholesale from
  // bluetoothManager to bluetooth.a2dp. Only the receiver binding changes.
  "@ohos.bluetoothManager.d.ts": `
declare namespace bluetoothManager {
  namespace A2dpSourceProfile {
    /** @since 8 @deprecated since 10 @useinstead ohos.bluetooth.a2dp.A2dpSourceProfile.connect */
    function connect(): void;
  }
  namespace BLE {
    /** @since 8 @deprecated since 10 @useinstead ohos.bluetooth.ble.on.event:BLEDeviceFind */
    function on(event: string): void;
  }
}
`,
  "@ohos.bluetooth.a2dp.d.ts": `
declare namespace a2dp {
  interface A2dpSourceProfile { connect(): void; }
}
`,
  "@ohos.bluetooth.ble.d.ts": `
declare namespace ble {
  function on(event: string, cb: () => void): void;
}
`,
  // Container-export rename guard: `Dir` is a top-level INTERFACE (a
  // container — it has a member-level entry `Dir.read`), deprecated with
  // @useinstead `ohos.file.fs.listFile` (a leaf function). Aliasing
  // `import {Dir}` -> `import {listFile as Dir}` would bind a type name to a
  // function value (breaks `let d: Dir` and `Dir.read()`), so
  // crossKitRenameExport must NOT carry `Dir`. The leaf `fstat` (no member
  // entries) -> `stat` is the canonical sound case and MUST be carried.
  // Mirrors the real @ohos.fileio layout: top-level `declare function fstat`
  // and `declare interface Dir`, re-exported by the kit namespace.
  "@ohos.fileio.d.ts": `
declare namespace fileio {
  export { fstat };
  export { Dir };
}
/**
 * @deprecated since 10
 * @useinstead ohos.file.fs.stat
 */
declare function fstat(): void;
/**
 * @deprecated since 10
 * @useinstead ohos.file.fs.listFile
 */
declare interface Dir {
  /**
   * @deprecated since 10
   * @useinstead ohos.file.fs.listFile
   */
  read(): void;
}
`,
  "@ohos.file.fs.d.ts": `
declare namespace fs {
  export function listFile(): void;
  export function stat(): void;
}
`,
};

test("indexer: top-level entries + module-move + bare-kit useinstead", () => {
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    // reminderAgent namespace move resolves via bare-kit recognition.
    const rem = map.kitIndex["@ohos.reminderAgent"];
    assert.ok(rem, "reminderAgent kit indexed");
    assert.equal(rem.newKit, "@ohos.reminderAgentManager", "bare kit resolved as module-move");
    // router.push -> router#pushUrl is a same-kit member (rename-member source).
    const push = map.entries.find((e) => e.dep.kit === "@ohos.router" && e.dep.members?.[0] === "push");
    assert.ok(push?.repl?.members?.includes("pushUrl"));
    // prompt.showToast -> UIContext PromptAction override source.
    const toast = map.entries.find((e) => e.dep.kit === "@ohos.prompt" && e.dep.members?.[0] === "showToast");
    assert.equal(toast?.repl?.kit, UI);
    assert.deepEqual(toast?.repl?.members, ["PromptAction", "showToast"]);
  } finally {
    cleanup(sdk);
  }
});

test("indexer: nested namespace @useinstead does not register a false kit move", () => {
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    // `fakeKit` itself is NOT deprecated (no @deprecated on its top-level
    // namespace), so it must have NO kitIndex entry at all — in particular
    // no false `newKit: @ohos.otherKit` borrowed from the nested `Sub`.
    assert.equal(map.kitIndex["@ohos.fakeKit"], undefined,
      "nested namespace @useinstead must not move the whole kit");
    // The nested Sub namespace and its member are still indexed as members.
    const sub = map.entries.find((e) => e.dep.kit === "@ohos.fakeKit" && e.dep.exportName === "Sub");
    assert.ok(sub, "nested Sub namespace indexed as a member");
    const bar = map.entries.find((e) => e.dep.kit === "@ohos.fakeKit" && e.dep.members?.includes("bar"));
    assert.ok(bar, "nested Sub.bar indexed as a member");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: whole-export @useinstead (repl.exportName) surfaces as cross-kit drop-in", () => {
  // A module-style file `@ohos.application.Configuration` with
  // `export interface Configuration` deprecated via
  // `@useinstead ohos.app.ability.Configuration/Configuration` (repl has
  // exportName, NO members) must be captured as a same-name cross-kit
  // drop-in, not lost as an unresolved manual.
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    assert.equal(
      map.crossKitDropin?.["@ohos.application.Configuration\0Configuration"],
      "@ohos.app.ability.Configuration",
      "whole-export move indexed as cross-kit same-name drop-in",
    );
  } finally {
    cleanup(sdk);
  }
});

test("indexer: container export is NOT aliased cross-kit (shape-change guard)", () => {
  // `Dir` is an interface (a CONTAINER — it has a member-level entry
  // `Dir.read`), deprecated with @useinstead `ohos.file.fs.listFile` (a leaf
  // function). The rename-export rule would alias `import {Dir}` ->
  // `import {listFile as Dir}`, binding a type name to a function value and
  // breaking `let d: Dir` / `Dir.read()` — so crossKitRenameExport must NOT
  // carry `Dir`. The leaf `fstat` (no member entries) -> `stat` is the
  // canonical sound rename and MUST be carried.
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    assert.equal(
      map.crossKitRenameExport?.["@ohos.fileio\0Dir"],
      undefined,
      "container export `Dir` must NOT be aliased to the leaf `listFile` (shape change)",
    );
    assert.equal(
      map.crossKitRenameExport?.["@ohos.fileio\0fstat"],
      "@ohos.file.fs\0stat",
      "leaf export `fstat` -> `stat` is a sound rename and must be carried",
    );
  } finally {
    cleanup(sdk);
  }
});

test("indexer: cross-kit single-leaf member move flagged crossKitMemberDropin", () => {
  // `particleAbility.startBackgroundRunning` -> backgroundTaskManager's same-
  // named top-level function. The replacement leaf is verified present in the
  // target kit, so the entry is flagged for the scanner's import-injection
  // path (rather than left as a plain cross-kit manual).
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const e = map.entries.find(
      (x) => x.dep.kit === "@ohos.ability.particleAbility" && x.dep.members?.[0] === "startBackgroundRunning",
    );
    assert.ok(e, "particleAbility.startBackgroundRunning entry exists");
    assert.equal(e!.crossKitMemberDropin, true, "flagged crossKitMemberDropin");
    assert.equal(e!.repl?.kit, "@ohos.resourceschedule.backgroundTaskManager");
    assert.equal(e!.repl?.members?.[0], "startBackgroundRunning");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: cross-kit 2-seg path-preserving move flagged crossKitMemberDropin", () => {
  // `bluetoothManager.A2dpSourceProfile.connect` -> `bluetooth.a2dp.A2dpSourceProfile.connect`:
  // the nested namespace moved wholesale; the chain is byte-identical, only
  // the kit changes. The container A2dpSourceProfile is verified as a
  // top-level export of the target kit, so the entry is flagged.
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const e = map.entries.find(
      (x) => x.dep.kit === "@ohos.bluetoothManager" && x.dep.members?.[0] === "A2dpSourceProfile",
    );
    assert.ok(e, "bluetoothManager.A2dpSourceProfile.connect entry exists");
    assert.equal(e!.crossKitMemberDropin, true, "2-seg path-preserving flagged");
    assert.deepEqual(e!.repl?.members, ["A2dpSourceProfile", "connect"]);
    assert.equal(e!.repl?.kit, "@ohos.bluetooth.a2dp");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: cross-kit move with @useinstead parse artifact stays manual", () => {
  // `bluetoothManager.BLE.on` has @useinstead `ohos.bluetooth.ble.on.event:BLEDeviceFind`
  // — the parser leaks a `name:value` event hint into the member chain
  // (repl.members = ["on","event:BLEDeviceFind"]). `toReplSymbol` strips the
  // colon-bearing segment, leaving repl.members = ["on"] (1-seg). The DEPRECATED
  // chain is 2-seg (["BLE","on"]), so the equal-length gate rejects the move —
  // a 2->1 flatten is a call-shape change (namespace -> instance), left manual.
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const e = map.entries.find(
      (x) => x.dep.kit === "@ohos.bluetoothManager" && x.dep.members?.[0] === "BLE",
    );
    assert.ok(e, "bluetoothManager.BLE.on entry exists");
    assert.notEqual(e!.crossKitMemberDropin, true, "2->1 length mismatch must NOT be flagged");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: ambiguous cross-kit member (one symbol -> many kits) stays manual", () => {
  // `bluetoothManager.on` is deprecated with @useinstead tokens that split it
  // across MULTIPLE replacement kits (connection / access / socket) — one entry
  // per event. Each entry, in isolation, verifies (1-seg leaf, target kit has a
  // top-level `on`). But the scanner matches the SYMBOL only and cannot read the
  // event-name string arg that picks the target, so auto-rebinding would choose
  // an arbitrary kit and corrupt the call. The ambiguity gate unflags every
  // entry whose (dep.kit, dep.members) maps to >1 replacement kit — they fall
  // back to manual. A UNIQUE-target entry at the same call shape stays flagged.
  const sdk = makeTree({
    "@ohos.bluetoothManager.d.ts": `
declare namespace bluetoothManager {
  /** @since 9 @deprecated since 10 @useinstead ohos.bluetooth.connection.on */
  function on(e: string): void;
  /** @since 9 @deprecated since 10 @useinstead ohos.bluetooth.access.on */
  function on(e: string, cb: () => void): void;
  /** @since 9 @deprecated since 10 @useinstead ohos.bluetooth.socket.on */
  function on(e: string, cb: () => void, extra: number): void;
}
`,
    "@ohos.bluetooth.connection.d.ts": `declare namespace connection { function on(e: string, cb: () => void): void; }`,
    "@ohos.bluetooth.access.d.ts": `declare namespace access { function on(e: string, cb: () => void): void; }`,
    "@ohos.bluetooth.socket.d.ts": `declare namespace socket { function on(e: string, cb: () => void): void; }`,
    "@ohos.bluetooth.a2dp.d.ts": `declare namespace a2dp { interface A2dpSourceProfile { connect(): void; } }`,
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const onEntries = map.entries.filter(
      (x) => x.dep.kit === "@ohos.bluetoothManager" && x.dep.members?.length === 1 && x.dep.members[0] === "on",
    );
    assert.ok(onEntries.length >= 3, "three on() overloads indexed");
    // Every ambiguous entry is unflagged (would otherwise rebind to an arbitrary kit).
    for (const e of onEntries) {
      assert.notEqual(e.crossKitMemberDropin, true, "ambiguous on() must NOT be flagged");
    }
  } finally {
    cleanup(sdk);
  }
});

test("indexer: unique-target cross-kit member stays flagged alongside an ambiguous sibling", () => {
  // Same fixture shape, but add a unique-target 2-seg move (A2dpSourceProfile.connect)
  // alongside the ambiguous on(). The ambiguity gate must unflag ONLY the ambiguous
  // symbol; the unique-target entry keeps its flag.
  const sdk = makeTree({
    "@ohos.bluetoothManager.d.ts": `
declare namespace bluetoothManager {
  /** @since 9 @deprecated since 10 @useinstead ohos.bluetooth.connection.on */
  function on(e: string): void;
  /** @since 9 @deprecated since 10 @useinstead ohos.bluetooth.access.on */
  function on(e: string, cb: () => void): void;
  namespace A2dpSourceProfile {
    /** @since 8 @deprecated since 10 @useinstead ohos.bluetooth.a2dp.A2dpSourceProfile.connect */
    function connect(): void;
  }
}
`,
    "@ohos.bluetooth.connection.d.ts": `declare namespace connection { function on(e: string, cb: () => void): void; }`,
    "@ohos.bluetooth.access.d.ts": `declare namespace access { function on(e: string, cb: () => void): void; }`,
    "@ohos.bluetooth.a2dp.d.ts": `declare namespace a2dp { interface A2dpSourceProfile { connect(): void; } }`,
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const onEntries = map.entries.filter(
      (x) => x.dep.kit === "@ohos.bluetoothManager" && x.dep.members?.length === 1 && x.dep.members[0] === "on",
    );
    for (const e of onEntries) {
      assert.notEqual(e.crossKitMemberDropin, true, "ambiguous on() unflagged");
    }
    const a2dp = map.entries.find(
      (x) => x.dep.kit === "@ohos.bluetoothManager" && x.dep.members?.[0] === "A2dpSourceProfile",
    );
    assert.ok(a2dp, "A2dpSourceProfile.connect entry exists");
    assert.equal(a2dp!.crossKitMemberDropin, true, "unique-target 2-seg stays flagged");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: cross-kit leaf-rename to a module-level sibling function flagged crossKitMemberDropin", () => {
  // `@system.file.move` -> `@ohos.file.fs.moveFile`. The target kit's file
  // declares `declare namespace fileIo { ... }` for its OO API AND module-level
  // `declare function moveFile` as a sibling of the namespace (its procedural
  // API). `moveFile` is a top-level export reachable as `binding.moveFile`
  // after `import * as binding from '@ohos.file.fs'`, but the previous
  // collector only descended into the first namespace body and missed module-
  // level siblings — so the safe rename stayed manual.
  const sdk = makeTree({
    "@system.file.d.ts": `
declare namespace file {
  /** @since 6 @deprecated since 9 @useinstead ohos.file.fs.moveFile */
  function move(src: string, dest: string): void;
}
`,
    "@ohos.file.fs.d.ts": `
declare namespace fileIo { interface OpenMode { READ: number } }
/** @since 9 */
declare function moveFile(src: string, dest: string): void;
`,
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const e = map.entries.find(
      (x) => x.dep.kit === "@system.file" && x.dep.members?.[0] === "move",
    );
    assert.ok(e, "system.file.move entry exists");
    assert.equal(e!.crossKitMemberDropin, true, "leaf-rename to module-level fn flagged");
    assert.equal(e!.repl?.kit, "@ohos.file.fs");
    assert.equal(e!.repl?.members?.[0], "moveFile");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: 1-seg semantic redirect whose leaf has a same-name export drop-in stays manual", () => {
  // `@ohos.fileio`'s module-level `read` -> `@ohos.file.fs.read` is a same-name
  // export drop-in (the authoritative replacement for the symbol `fileio.read`).
  // The namespace function `fileio.read` -> `file.fs.listFile` is a DIFFERENT leaf
  // — a semantic redirect, not a drop-in. For namespace usage `fileio.read(...)`,
  // rebinding to `listFile` would splice the wrong leaf. The export-conflict gate
  // unflags such 1-seg entries: the leaf collides with a same-name export drop-in
  // whose target matches repl.kit, and the replacement leaf differs.
  const sdk = makeTree({
    "@ohos.fileio.d.ts": `
/** @since 6 @deprecated since 9 @useinstead ohos.file.fs.read */
declare function read(fd: number): void;
declare namespace fileio {
  /** @since 6 @deprecated since 9 @useinstead ohos.file.fs.listFile */
  function read(path: string): void;
}
`,
    "@ohos.file.fs.d.ts": `
declare namespace fileIo {}
declare function read(fd: number): void;
declare function listFile(path: string): string[];
`,
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    // The module-level `read` is a same-name export drop-in.
    assert.equal(map.crossKitDropin?.["@ohos.fileio\0read"], "@ohos.file.fs");
    // The namespace-function read -> listFile semantic redirect is NOT flagged
    // (would splice the wrong leaf for namespace usage of the colliding `read`).
    const nsRead = map.entries.find(
      (x) =>
        x.dep.kit === "@ohos.fileio" &&
        x.dep.exportName === "fileio" &&
        x.dep.members?.[0] === "read",
    );
    assert.ok(nsRead, "namespace function read entry exists");
    assert.notEqual(nsRead!.crossKitMemberDropin, true, "semantic redirect must NOT be flagged");
    assert.equal(nsRead!.repl?.members?.[0], "listFile");
  } finally {
    cleanup(sdk);
  }
});

test("indexer + scan: default-export move rewrites a default import's specifier", () => {
  // `export default class Want` -> @ohos.app.ability.Want: a default import
  // `import Want from '@ohos.application.Want'` only needs its specifier
  // rewritten; the local binding `Want` is the default export and stays.
  const sdk = makeTree(SDK_FILES);
  const root = makeTree({ "p.ts": `import Want from '@ohos.application.Want';\nconst w = new Want();` });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    assert.equal(map.crossKitDropin?.["@ohos.application.Want\0default"], "@ohos.app.ability.Want");
    const { findings } = scanProjectCrossKitDropin({ projectRoot: root, map });
    const f = bySymbol(findings, "@ohos.application.Want");
    assert.equal(f?.rule, "rewrite-import");
    assert.equal(f?.newSymbol, "@ohos.app.ability.Want");
    // No binding alias (default import cannot be aliased).
    assert.equal(bySymbol(findings, "default"), undefined);
    const res = rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "p.ts"), "utf8");
    assert.ok(out.includes("import Want from '@ohos.app.ability.Want';"), "specifier rewritten");
    assert.ok(out.includes("new Want()"), "call site unchanged");
    assert.equal(res.skippedManual, 0);
  } finally {
    cleanup(sdk);
    cleanup(root);
  }
});

test("indexer + scan + rewrite: cross-kit member dropin injects import end-to-end", () => {
  // Real indexer verifies the leaf in the target kit -> crossKitMemberDropin
  // flag -> scanner emits rebind + inject-import -> rewriter applies both.
  const sdk = makeTree(SDK_FILES);
  const root = makeTree({
    "p.ts": `import * as particleAbility from '@ohos.ability.particleAbility';
export function go() { particleAbility.startBackgroundRunning('ctx'); }
`,
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const { findings } = scanProjectMembers({ projectRoot: root, map });
    assert.ok(findings.some((f) => f.rule === "inject-import"));
    const res = rewriteProject(root, findings, { write: true });
    assert.equal(res.skippedManual, 0);
    const out = readFileSync(join(root, "p.ts"), "utf8");
    assert.ok(out.includes("import * as backgroundTaskManager from '@ohos.resourceschedule.backgroundTaskManager';"));
    assert.ok(out.includes("backgroundTaskManager.startBackgroundRunning('ctx');"));
  } finally {
    cleanup(sdk);
    cleanup(root);
  }
});

test("indexer: nested file resolved via `import * as` re-export", () => {
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const appInfo = map.entries.find(
      (e) => e.dep.members?.includes("metadata") && e.dep.exportName === "ApplicationInfo",
    );
    assert.ok(appInfo, "ApplicationInfo.metadata indexed");
    assert.equal(appInfo?.dep.kit, "@ohos.bundle.bundleManager", "attributed via namespace import");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: nested file resolved via named import re-export", () => {
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const ctx = map.entries.find(
      (e) => e.dep.members?.includes("setShowOnLockScreen"),
    );
    assert.ok(ctx, "Context.setShowOnLockScreen indexed");
    assert.equal(ctx?.dep.kit, "@ohos.app.ability", "attributed via named import");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: unresolved nested file gets @? synthetic kit", () => {
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const orphan = map.entries.find((e) => e.dep.members?.includes("m") && e.dep.exportName === "Orphan");
    assert.ok(orphan, "orphan indexed for completeness");
    assert.ok(orphan?.dep.kit.startsWith("@?"), "non-importable synthetic kit");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: legacy @system.* kits are top-level (not @? synthetic)", () => {
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const ro = map.entries.find((e) => e.dep.exportName === "RouterOptions" && !e.dep.members?.length);
    assert.ok(ro, "RouterOptions indexed");
    assert.equal(ro?.dep.kit, "@system.router", "attributed to the @system kit, not @?");
    assert.equal(ro?.repl?.kit, "@ohos.router");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: transitive re-export attributes second-level nested files", () => {
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const inner = map.entries.find((e) => e.dep.exportName === "Inner" && e.dep.members?.includes("old"));
    assert.ok(inner, "Inner.old indexed");
    assert.equal(inner?.dep.kit, "@ohos.fake", "second-level nested file attributed transitively");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: export re-export statement binds a nested file to the kit", () => {
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const thing = map.entries.find((e) => e.dep.exportName === "Thing" && e.dep.members?.includes("old"));
    assert.ok(thing, "Thing.old indexed");
    assert.equal(thing?.dep.kit, "@ohos.mod", "attributed via `export { Thing } from`");
  } finally {
    cleanup(sdk);
  }
});

/* Round 8: a kit's public API is frequently split across re-exported nested
 * `.d.ts` files (e.g. @ohos.arkui.modifier re-exports NavigatorModifier from
 * arkui/NavigatorModifier.d.ts; @ohos.ability.featureAbility re-exports
 * ElementName/CustomizeData/ModuleInfo from bundle/*.d.ts). The export-rename,
 * cross-kit same-name drop-in, and cross-kit rename-export rules must apply to
 * these nested-file exports too — not only to declarations in the kit's
 * top-level file. `resolveOwnKit` attributes a nested file to its kit only when
 * the kit re-exports from it, so `ownKit` is a real importable kit (never the
 * `@?` orphan sentinel); the indexer now gates on `!ownKit.startsWith("@?")`
 * rather than `isTopLevel(filePath)`. */

function nestedExportSdk(): string {
  return makeTree({
    // Same-kit export rename via a re-exported nested file.
    "@ohos.mod.d.ts": `export { Thing } from './mod/thing';`,
    "mod/thing.d.ts": `/** @since 9 @deprecated since 10 @useinstead ohos.mod.NewThing */ export declare class Thing {}`,
    // Cross-kit same-name export drop-in (whole export moved to another kit).
    "@ohos.settings.d.ts": `export { ResultSet } from './data/rdb/resultSet';`,
    "data/rdb/resultSet.d.ts": `/** @since 6 @deprecated since 10 @useinstead ohos.data.relationalStore.ResultSet */ export declare class ResultSet {}`,
    "@ohos.data.relationalStore.d.ts": `declare namespace relationalStore {}`,
    // Cross-kit different-name export (rename-export, alias the binding).
    "@ohos.ability.featureAbility.d.ts": `export { CustomizeData } from './bundle/customizeData'; export { ElementName } from './bundle/elementName';`,
    "bundle/customizeData.d.ts": `/** @since 6 @deprecated since 9 @useinstead ohos.bundle.bundleManager.Metadata */ export declare class CustomizeData {}`,
    "bundle/elementName.d.ts": `/** @since 6 @deprecated since 9 @useinstead ohos.bundle.bundleManager.ElementName */ export declare class ElementName {}`,
    "@ohos.bundle.bundleManager.d.ts": `declare namespace bundleManager {}`,
  });
}

test("indexer: nested-file export rename reaches exportIndex", () => {
  const sdk = nestedExportSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    assert.equal(map.exportIndex?.["@ohos.mod\0Thing"], "NewThing");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: nested-file cross-kit same-name export reaches crossKitDropin", () => {
  const sdk = nestedExportSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    assert.equal(map.crossKitDropin?.["@ohos.settings\0ResultSet"], "@ohos.data.relationalStore");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: nested-file cross-kit rename-export reaches crossKitRenameExport", () => {
  const sdk = nestedExportSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    assert.equal(
      map.crossKitRenameExport?.["@ohos.ability.featureAbility\0CustomizeData"],
      "@ohos.bundle.bundleManager\0Metadata",
    );
  } finally {
    cleanup(sdk);
  }
});

test("indexer: orphan nested file (no re-exporter) stays out of export rules", () => {
  // A nested file with NO re-exporter is attributed the `@?` synthetic kit and
  // must NOT get a crossKitDropin entry — its repl.kit is not a real importable
  // module for the project's import specifier, so rewriting the specifier would
  // produce an invalid `from '@?...'`.
  const sdk = makeTree({
    "@ohos.target.d.ts": `declare namespace target {}`,
    "orphan/standalone.d.ts": `/** @since 6 @deprecated since 9 @useinstead ohos.target.Standalone */ export declare class Standalone {}`,
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const e = map.entries.find((x) => x.dep.exportName === "Standalone" && (!x.dep.members || !x.dep.members.length));
    assert.ok(e, "Standalone entry indexed");
    assert.equal(e!.dep.kit, "@?standalone", "orphan kit attributed");
    assert.equal(map.crossKitDropin?.["@?standalone\0Standalone"], undefined, "orphan excluded from dropin");
  } finally {
    cleanup(sdk);
  }
});

test("scan+rewrite: nested-file export rename aliases a named import (real indexer map)", () => {
  const sdk = nestedExportSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const root = makeTree({
      "p.ts": `import { Thing } from '@ohos.mod';
const x = new Thing();`,
    });
    try {
      const { findings } = scanProjectExportRenames({ projectRoot: root, map });
      const f = findings.find((x) => x.oldSymbol === "Thing");
      assert.equal(f?.rule, "rename-export");
      assert.equal(f?.replacement, "NewThing as Thing");
      rewriteProject(root, findings, { write: true });
      const out = readFileSync(join(root, "p.ts"), "utf8");
      assert.ok(out.includes("import { NewThing as Thing } from '@ohos.mod';"), "import aliased");
      // Body reference untouched (the alias keeps `Thing` resolving to NewThing).
      assert.ok(out.includes("const x = new Thing();"));
    } finally {
      cleanup(root);
    }
  } finally {
    cleanup(sdk);
  }
});

test("indexer: .d.ets is indexed", () => {
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const chip = map.entries.find((e) => e.dep.members?.includes("oldSize"));
    assert.ok(chip, ".d.ets declaration indexed");
    assert.equal(chip?.dep.kit, "@ohos.arkui.advanced.ChipGroup");
  } finally {
    cleanup(sdk);
  }
});

test("indexer: @internal/** is skipped", () => {
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const fa = map.entries.find((e) => e.dep.exportName === "featureAbility");
    assert.equal(fa, undefined, "@internal not indexed");
  } finally {
    cleanup(sdk);
  }
});

/* ------------------------------------------------------------------ */
/* 2. Scanner — every rule kind                                       */
/* ------------------------------------------------------------------ */

// A project exercising all member-level branches at once.
function memberProject(): string {
  return makeTree({
    "page.ets": `
import router from '@ohos.router';
import prompt from '@ohos.prompt';
import i18n from '@ohos.i18n';
import animator from '@ohos.animator';
import snap from '@ohos.snap';
import dataRdb from '@ohos.data.rdb';
import same from '@ohos.same';
import noop from '@ohos.noop';
import unresolved from '@ohos.unresolved';

router.push({ url: 'x' });           // rename-member (same-kit)
router.pushUrl({ url: 'y' });        // override UIContext Router
prompt.showToast({ message: 'm' }); // override UIContext PromptAction
i18n.registerFont({});              // override UIContext Font (get<Head>)
animator.createAnimator({});        // override UIContext self-head
snap.takePhoto();                   // cross-kit non-override -> manual
dataRdb.getRdbStore({});            // cross-kit non-override -> manual
same.foo();                         // no-op rename (leaf == old) -> suppressed
noop.bar();                         // no @useinstead -> manual
unresolved.deep.chain();            // multi-seg unresolved kit -> manual
`,
  });
}

function memberMap(): DeprecationMap {
  return mapOf([
    entry("@ohos.router", ["push"], { members: ["pushUrl"] }, 9),          // rename-member
    entry("@ohos.router", ["pushUrl"], { kit: UI, members: ["Router", "pushUrl"] }, 18), // override Router
    entry("@ohos.prompt", ["showToast"], { kit: UI, members: ["PromptAction", "showToast"] }, 9), // override PromptAction
    entry("@ohos.i18n", ["registerFont"], { kit: UI, members: ["Font", "registerFont"] }, 9), // override Font
    entry("@ohos.animator", ["createAnimator"], { kit: UI, members: ["UIContext", "createAnimator"] }, 18), // override self
    entry("@ohos.snap", ["takePhoto"], { kit: "@ohos.camera", members: ["takePhoto"] }, 9), // cross-kit manual
    entry("@ohos.data.rdb", ["getRdbStore"], { kit: "@ohos.data.relationalStore", members: ["getRdbStore"] }, 9),
    entry("@ohos.same", ["foo"], { kit: "@ohos.same", members: ["foo"] }, 9), // no-op rename
    entry("@ohos.noop", ["bar"], null, 9),                                  // no replacement
    entry("@ohos.unresolved", ["deep", "chain"], { members: ["a", "b"] }, 9), // unresolved kit chain
  ]);
}

test("scan: rename-member is auto-fixable", () => {
  const root = memberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: memberMap() });
    const f = bySymbol(findings, "router.push");
    assert.equal(f?.rule, "rename-member");
    assert.equal(f?.replacement, "router.pushUrl");
    assert.equal(f?.needsManual, false);
  } finally {
    cleanup(root);
  }
});

test("scan: override UIContext Router -> getRouter()", () => {
  const root = memberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: memberMap() });
    const f = bySymbol(findings, "router.pushUrl");
    assert.equal(f?.rule, "override");
    assert.equal(f?.replacement, "this.getUIContext().getRouter().pushUrl");
  } finally {
    cleanup(root);
  }
});

test("scan: override UIContext PromptAction -> getPromptAction()", () => {
  const root = memberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: memberMap() });
    const f = bySymbol(findings, "prompt.showToast");
    assert.equal(f?.rule, "override");
    assert.equal(f?.replacement, "this.getUIContext().getPromptAction().showToast");
  } finally {
    cleanup(root);
  }
});

test("scan: override UIContext Font derives get<Head>()", () => {
  const root = memberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: memberMap() });
    const f = bySymbol(findings, "i18n.registerFont");
    assert.equal(f?.rule, "override");
    assert.equal(f?.replacement, "this.getUIContext().getFont().registerFont");
  } finally {
    cleanup(root);
  }
});

test("scan: override UIContext self-head calls directly on the context", () => {
  const root = memberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: memberMap() });
    const f = bySymbol(findings, "animator.createAnimator");
    assert.equal(f?.rule, "override");
    assert.equal(f?.replacement, "this.getUIContext().createAnimator");
  } finally {
    cleanup(root);
  }
});

test("scan: cross-kit non-override replacement is manual", () => {
  const root = memberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: memberMap() });
    const f = bySymbol(findings, "snap.takePhoto");
    assert.equal(f?.rule, "manual");
    assert.equal(f?.needsManual, true);
    assert.equal(f?.replacement, undefined, "no splice for manual");
  } finally {
    cleanup(root);
  }
});

test("scan: no-op rename (same leaf) is suppressed, no finding", () => {
  const root = memberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: memberMap() });
    // Self-referential replacement (repl === dep): the call site already
    // targets the right symbol, so no member finding is emitted.
    assert.equal(bySymbol(findings, "same.foo"), undefined);
  } finally {
    cleanup(root);
  }
});

test("scan: missing @useinstead is manual", () => {
  const root = memberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: memberMap() });
    const f = bySymbol(findings, "noop.bar");
    assert.equal(f?.rule, "manual");
    assert.equal(f?.needsManual, true);
  } finally {
    cleanup(root);
  }
});

test("scan: multi-segment replacement without kit is manual", () => {
  const root = memberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: memberMap() });
    const f = bySymbol(findings, "unresolved.deep.chain");
    assert.equal(f?.rule, "manual");
    assert.equal(f?.replacement, undefined);
  } finally {
    cleanup(root);
  }
});

/* kit-move alignment: cross-kit members whose repl.kit lines up with the
 * deprecated kit's indexed module move. After rewrite-import re-points the
 * binding, the member is reached on the same binding. */

function alignedProject(): string {
  return makeTree({
    "page.ets": `
import bt from '@ohos.bluetooth';
import dutil from '@ohos.ability.dataUriUtils';
bt.getProfileConnState(1);   // aligned leaf-rename -> rename-member
dutil.getId('x');           // aligned no-op (chain identical) -> suppressed
bt.unrelatedDeep();         // aligned but prefix differs -> manual
`,
  });
}

function alignedMap(): DeprecationMap {
  const kitIndex: DeprecationMap["kitIndex"] = {
    "@ohos.bluetooth": { since: 9, newKit: "@ohos.bluetoothManager" },
    "@ohos.ability.dataUriUtils": { since: 9, newKit: "@ohos.app.ability.dataUriUtils" },
  };
  return mapOf(
    [
      // aligned leaf-rename: only the leaf changes on the re-pointed binding
      entry("@ohos.bluetooth", ["getProfileConnState"], { kit: "@ohos.bluetoothManager", members: ["getProfileConnectionState"] }, 9),
      // aligned no-op: chain identical -> covered by the kit move (rewrite-import)
      entry("@ohos.ability.dataUriUtils", ["getId"], { kit: "@ohos.app.ability.dataUriUtils", members: ["getId"] }, 9),
      // aligned but prefix differs -> still manual
      entry("@ohos.bluetooth", ["unrelatedDeep"], { kit: "@ohos.bluetoothManager", members: ["other", "deep"] }, 9),
    ],
    kitIndex,
  );
}

test("scan: aligned leaf-rename is rename-member on the re-pointed binding", () => {
  const root = alignedProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: alignedMap() });
    const f = bySymbol(findings, "bt.getProfileConnState");
    assert.equal(f?.rule, "rename-member");
    assert.equal(f?.replacement, "bt.getProfileConnectionState");
  } finally {
    cleanup(root);
  }
});

test("scan: aligned no-op (chain identical) is suppressed", () => {
  const root = alignedProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: alignedMap() });
    // rewrite-import re-points the binding; the member works unchanged, so no
    // member finding should be emitted for `dutil.getId`.
    assert.equal(bySymbol(findings, "dutil.getId"), undefined);
  } finally {
    cleanup(root);
  }
});

test("scan: aligned prefix-diff stays manual", () => {
  const root = alignedProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: alignedMap() });
    const f = bySymbol(findings, "bt.unrelatedDeep");
    assert.equal(f?.rule, "manual");
    assert.equal(f?.replacement, undefined);
  } finally {
    cleanup(root);
  }
});

test("rewrite: aligned kit move + member rename both apply", () => {
  const root = alignedProject();
  try {
    const mod = scanProject({ projectRoot: root, map: alignedMap() });
    const mem = scanProjectMembers({ projectRoot: root, map: alignedMap() });
    const findings = [...mod.findings, ...mem.findings];
    const res = rewriteProject(root, findings, { write: false });
    // bt import rewritten + member leaf renamed; the suppressed dutil.getId
    // contributes no member edit (only its import is rewritten).
    const bt = res.changedFiles.find((c) => c.file === "page.ets");
    assert.ok(bt, "page.ets changed");
    assert.ok(bt.diff.includes("@ohos.bluetoothManager"), "import rewritten");
    assert.ok(bt.diff.includes("getProfileConnectionState"), "member renamed");
    // The aligned no-op member must NOT produce a splice (getId stays).
    assert.ok(!bt.diff.includes("getId"), "aligned no-op member not spliced");
  } finally {
    cleanup(root);
  }
});

/* cross-kit same-name drop-in: a named export or `export default` moved
 * wholesale to another kit under the same name. The import-specifier rewrite
 * (scanProjectCrossKitDropin) re-points the binding, so a member with an
 * unchanged chain resolves on the new kit — the member finding is redundant
 * and must be suppressed. A member whose chain changed still needs its own
 * splice, so it is NOT suppressed. */

function dropinMemberProject(): string {
  return makeTree({
    "page.ets": `
import Want from '@ohos.application.Want';
import { Configuration } from '@ohos.application.Configuration';
Want.deviceId;            // default dropin, chain equal -> suppressed
Configuration.language;   // named dropin, chain equal -> suppressed
Want.renamed;             // default dropin but chain differs -> still reported
`,
  });
}

function dropinMemberMap(): DeprecationMap {
  const crossKitDropin: DeprecationMap["crossKitDropin"] = {
    "@ohos.application.Want\0default": "@ohos.app.ability.Want",
    "@ohos.application.Configuration\0Configuration": "@ohos.app.ability.Configuration",
  };
  const e = (
    kit: string, exportName: string, members: string[], repl: ReplSymbol, since = 9,
  ): DeprecationEntry => ({
    dep: { kit, exportName, members }, since, repl, kind: "member", source: { file: "", line: 0 },
  });
  return mapOf([
    e("@ohos.application.Want", "Want", ["deviceId"], { kit: "@ohos.app.ability.Want", members: ["deviceId"] }),
    e("@ohos.application.Configuration", "Configuration", ["language"], { kit: "@ohos.app.ability.Configuration", members: ["language"] }),
    e("@ohos.application.Want", "Want", ["renamed"], { kit: "@ohos.app.ability.Want", members: ["newName"] }),
  ], {}, {}, crossKitDropin);
}

test("scan: cross-kit dropin suppresses chain-equal member findings", () => {
  const root = dropinMemberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: dropinMemberMap() });
    // default-export dropin, chain unchanged -> specifier rewrite covers it
    assert.equal(bySymbol(findings, "Want.deviceId"), undefined);
    // named-export dropin, chain unchanged -> specifier rewrite covers it
    assert.equal(bySymbol(findings, "Configuration.language"), undefined);
    // chain differs -> still needs a member splice, so still reported (manual)
    const f = bySymbol(findings, "Want.renamed");
    assert.equal(f?.rule, "manual");
  } finally {
    cleanup(root);
  }
});

/* The instance scanners (regex + tsc) must mirror the binding scanner's
 * container drop-in suppression: when a member's container moved cross-kit
 * via a same-name drop-in and the member chain is unchanged, the import-
 * specifier rewrite already covers `cfg.language` on the re-pointed binding —
 * the instance finding is redundant. Mirrors the fix for the
 * `@ohos.application.Configuration.language` / `@ohos.application.Want.*`
 * redundant manual findings (11 entries in the real API-24 map). */

function dropinInstanceProject(): string {
  return makeTree({
    "page.ets": `
import { Configuration } from '@ohos.application.Configuration';
import { Want } from '@ohos.application.Want';
let cfg: Configuration;
let w: Want;
cfg.language;    // named dropin, chain equal -> suppressed
cfg.colorMode;   // (extra member, not in map -> not flagged at all)
w.deviceId;      // named dropin, chain equal -> suppressed
w.renamed;       // chain differs -> still reported (manual)
`,
  });
}

test("scan instance: cross-kit dropin suppresses chain-equal instance findings", () => {
  const root = dropinInstanceProject();
  try {
    const map = dropinMemberMap();
    // Add a second Configuration member + the Want.renamed (already in map) so
    // both the suppressed and reported paths are exercised via instance access.
    const e = (
      kit: string, exportName: string, members: string[], repl: ReplSymbol, since = 9,
    ): DeprecationEntry => ({
      dep: { kit, exportName, members }, since, repl, kind: "member", source: { file: "", line: 0 },
    });
    const entries = map.entries.concat([
      e("@ohos.application.Configuration", "Configuration", ["colorMode"], { kit: "@ohos.app.ability.Configuration", members: ["colorMode"] }),
    ]);
    const mapWithColor = { ...map, entries };
    const { findings } = scanProjectInstanceMembers({ projectRoot: root, map: mapWithColor });
    // named-export dropin, chain unchanged -> specifier rewrite covers it
    assert.equal(bySymbol(findings, "cfg.language"), undefined);
    assert.equal(bySymbol(findings, "cfg.colorMode"), undefined);
    assert.equal(bySymbol(findings, "w.deviceId"), undefined);
    // chain differs -> still needs a member splice, so still reported (manual)
    const f = bySymbol(findings, "w.renamed");
    assert.equal(f?.rule, "manual");
  } finally {
    cleanup(root);
  }
});

/* Asymmetric 1->2 container drop-in: the container (a class/interface) lives
 * in `dep.exportName` and the leaf in `dep.members` (1 seg), but the
 * replacement RESTATES the container as `repl.members[0]` — e.g.
 * `fileio.Stat.ino` -> `file.fs.Stat.ino` (dep.exportName=Stat,
 * dep.members=[ino], repl.members=[Stat, ino]). The container moved wholesale
 * via a same-name cross-kit drop-in, so `rewrite-import` re-points the import
 * specifier; the member chain is unchanged (only the kit differs), so the
 * finding is redundant — suppress it. This is the real shape of the ~66
 * `Stat`/`Stream`/`Watcher`/`ResultSet` instance members in the API-24 map,
 * which are reached via instance access (`s.ino`), not `binding.Stat.ino`
 * (interface static access is invalid in value position — dormant for the
 * binding scanner). The instance scanner would otherwise emit a spurious
 * "wiring changes" manual finding for each. */

function asymmetricDropinMap(): DeprecationMap {
  const crossKitDropin: DeprecationMap["crossKitDropin"] = {
    "@ohos.fileio\0Stat": "@ohos.file.fs",
  };
  const e = (
    kit: string, exportName: string, members: string[], repl: ReplSymbol, since = 9,
  ): DeprecationEntry => ({
    dep: { kit, exportName, members }, since, repl, kind: "member", source: { file: "", line: 0 },
  });
  return mapOf([
    // asymmetric: container in exportName, repl = [container, leaf], kit matches dropin -> suppress
    e("@ohos.fileio", "Stat", ["ino"], { kit: "@ohos.file.fs", members: ["Stat", "ino"] }),
    // control: repl kit differs from dropin (member did NOT travel with container) -> report
    e("@ohos.fileio", "Stat", ["dev"], { kit: "@ohos.some.other", members: ["Stat", "dev"] }),
  ], {}, {}, crossKitDropin);
}

function asymmetricBindingProject(): string {
  return makeTree({
    "page.ets": `
import fileio from '@ohos.fileio';
fileio.ino;    // asymmetric, kit matches dropin -> suppressed
fileio.dev;    // repl kit != dropin -> still reported (manual)
`,
  });
}

test("scan: asymmetric 1->2 container dropin suppresses binding member findings", () => {
  const root = asymmetricBindingProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: asymmetricDropinMap() });
    // container moved via same-name dropin, repl = [Stat, ino] restates it,
    // repl.kit === dropin -> the import-specifier rewrite covers it -> suppress
    assert.equal(bySymbol(findings, "fileio.ino"), undefined);
    // repl.kit != dropin (member's @useinstead points elsewhere) -> still manual
    assert.equal(bySymbol(findings, "fileio.dev")?.rule, "manual");
  } finally {
    cleanup(root);
  }
});

function asymmetricInstanceProject(): string {
  return makeTree({
    "page.ets": `
import { Stat } from '@ohos.fileio';
let s: Stat;
s.ino;     // asymmetric, kit matches dropin -> suppressed
s.dev;     // repl kit != dropin -> still reported (manual)
`,
  });
}

test("scan instance: asymmetric 1->2 container dropin suppresses instance findings", () => {
  const root = asymmetricInstanceProject();
  try {
    const { findings } = scanProjectInstanceMembers({ projectRoot: root, map: asymmetricDropinMap() });
    // instance access on a moved container: the import-specifier rewrite
    // re-points `Stat` to @ohos.file.fs, so `s.ino` already resolves on the
    // re-pointed binding — the finding is redundant -> suppress (no spurious
    // "wiring changes" manual finding)
    assert.equal(bySymbol(findings, "s.ino"), undefined);
    // repl.kit != dropin -> member did not travel with the container -> manual
    assert.equal(bySymbol(findings, "s.dev")?.rule, "manual");
  } finally {
    cleanup(root);
  }
});

/* cross-kit single-leaf member move (crossKitMemberDropin): the kit did NOT
 * move as a whole, so rewrite-import can't rebind it. The scanner instead
 * rebinds the receiver to a (reused or injected) binding for repl.kit and
 * emits one per-file inject-import finding. Mirrors particleAbility ->
 * backgroundTaskManager in the real SDK. */

function crossKitMemberEntry(
  kit: string,
  members: string[],
  repl: ReplSymbol,
  since = 10,
): DeprecationEntry {
  return {
    dep: { kit, exportName: "x", members },
    since,
    repl,
    kind: "member",
    source: { file: "", line: 0 },
    crossKitMemberDropin: true,
  };
}

function crossKitMemberMap(): DeprecationMap {
  return mapOf([
    // same-leaf dropin: startBackgroundRunning -> startBackgroundRunning
    crossKitMemberEntry("@ohos.ability.particleAbility", ["startBackgroundRunning"],
      { kit: "@ohos.resourceschedule.backgroundTaskManager", members: ["startBackgroundRunning"] }),
    // leaf-rename: cancelBackgroundRunning -> stopBackgroundRunning
    crossKitMemberEntry("@ohos.ability.particleAbility", ["cancelBackgroundRunning"],
      { kit: "@ohos.resourceschedule.backgroundTaskManager", members: ["stopBackgroundRunning"] }),
  ]);
}

function crossKitMemberProject(): string {
  return makeTree({
    "p.ts": `import * as particleAbility from '@ohos.ability.particleAbility';
import * as other from '@ohos.something.else';
export function go() {
  particleAbility.startBackgroundRunning('ctx');
  particleAbility.cancelBackgroundRunning();
  particleAbility.untouchedMember();
}
`,
  });
}

test("scan: cross-kit member dropin rebinds + emits one inject-import", () => {
  const root = crossKitMemberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: crossKitMemberMap() });
    const a = bySymbol(findings, "particleAbility.startBackgroundRunning");
    assert.equal(a?.rule, "rename-member");
    assert.equal(a?.replacement, "backgroundTaskManager.startBackgroundRunning");
    assert.ok(a?.note.includes("injected import"));
    const b = bySymbol(findings, "particleAbility.cancelBackgroundRunning");
    assert.equal(b?.replacement, "backgroundTaskManager.stopBackgroundRunning");
    // exactly one inject-import finding for the file
    const injects = findings.filter((f) => f.rule === "inject-import");
    assert.equal(injects.length, 1);
    assert.ok(injects[0].replacement!.includes("import * as backgroundTaskManager from '@ohos.resourceschedule.backgroundTaskManager';"));
    assert.equal(injects[0].matchStart, injects[0].matchEnd); // zero-length insertion
  } finally {
    cleanup(root);
  }
});

test("rewrite: cross-kit member dropin injects import + rebinds receiver", () => {
  const root = crossKitMemberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: crossKitMemberMap() });
    const res = rewriteProject(root, findings, { write: true });
    assert.equal(res.skippedManual, 0);
    const out = readFileSync(join(root, "p.ts"), "utf8");
    assert.ok(out.includes("import * as backgroundTaskManager from '@ohos.resourceschedule.backgroundTaskManager';"));
    assert.ok(out.includes("backgroundTaskManager.startBackgroundRunning('ctx');"));
    assert.ok(out.includes("backgroundTaskManager.stopBackgroundRunning();"));
    // old binding retained for the non-deprecated member
    assert.ok(out.includes("particleAbility.untouchedMember();"));
    assert.ok(!out.includes("particleAbility.startBackgroundRunning"));
  } finally {
    cleanup(root);
  }
});

test("scan: cross-kit member dropin reuses an existing target-kit import (no inject)", () => {
  const root = makeTree({
    "p.ts": `import * as particleAbility from '@ohos.ability.particleAbility';
import * as backgroundTaskManager from '@ohos.resourceschedule.backgroundTaskManager';
export function go() { particleAbility.startBackgroundRunning('ctx'); }
`,
  });
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: crossKitMemberMap() });
    const a = bySymbol(findings, "particleAbility.startBackgroundRunning");
    assert.equal(a?.replacement, "backgroundTaskManager.startBackgroundRunning");
    // target kit already imported -> no inject-import finding
    assert.equal(findings.filter((f) => f.rule === "inject-import").length, 0);
  } finally {
    cleanup(root);
  }
});

test("scan: cross-kit member dropin suffixes a colliding binding name", () => {
  const root = makeTree({
    "p.ts": `import * as particleAbility from '@ohos.ability.particleAbility';
import * as backgroundTaskManager from '@ohos.totally.different';
export function go() { particleAbility.startBackgroundRunning('ctx'); }
`,
  });
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: crossKitMemberMap() });
    const a = bySymbol(findings, "particleAbility.startBackgroundRunning");
    // `backgroundTaskManager` is taken by a different kit -> allocate `2`
    assert.equal(a?.replacement, "backgroundTaskManager2.startBackgroundRunning");
    const inj = findings.find((f) => f.rule === "inject-import");
    assert.ok(inj?.replacement!.includes("import * as backgroundTaskManager2 from '@ohos.resourceschedule.backgroundTaskManager';"));
  } finally {
    cleanup(root);
  }
});

/* cross-kit 2-segment path-preserving member move (crossKitMemberDropin,
 * multi-segment): the whole nested namespace moved to another kit, the member
 * chain unchanged. The scanner rebinds the receiver to a (reused or injected)
 * binding for repl.kit and splices the full chain `newBinding.Container.member`.
 * Mirrors bluetoothManager.A2dpSourceProfile.connect -> bluetooth.a2dp... in the
 * real SDK. */

function crossKitMember2SegMap(): DeprecationMap {
  return mapOf([
    crossKitMemberEntry("@ohos.bluetoothManager", ["A2dpSourceProfile", "connect"],
      { kit: "@ohos.bluetooth.a2dp", members: ["A2dpSourceProfile", "connect"] }),
  ]);
}

test("scan: cross-kit 2-seg dropin rebinds full chain + emits one inject-import", () => {
  const root = makeTree({
    "p.ts": `import * as bm from '@ohos.bluetoothManager';
import * as other from '@ohos.something.else';
export function go() {
  bm.A2dpSourceProfile.connect();
  bm.untouchedMember();
}
`,
  });
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: crossKitMember2SegMap() });
    const a = bySymbol(findings, "bm.A2dpSourceProfile.connect");
    assert.equal(a?.rule, "rename-member");
    assert.equal(a?.replacement, "a2dp.A2dpSourceProfile.connect");
    assert.ok(a?.note.includes("injected import"));
    const injects = findings.filter((f) => f.rule === "inject-import");
    assert.equal(injects.length, 1);
    assert.ok(injects[0].replacement!.includes("import * as a2dp from '@ohos.bluetooth.a2dp';"));
  } finally {
    cleanup(root);
  }
});

test("rewrite: cross-kit 2-seg dropin injects import + rebinds full chain", () => {
  const root = makeTree({
    "p.ts": `import * as bm from '@ohos.bluetoothManager';
export function go() { bm.A2dpSourceProfile.connect(); bm.untouchedMember(); }
`,
  });
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: crossKitMember2SegMap() });
    const res = rewriteProject(root, findings, { write: true });
    assert.equal(res.skippedManual, 0);
    const out = readFileSync(join(root, "p.ts"), "utf8");
    assert.ok(out.includes("import * as a2dp from '@ohos.bluetooth.a2dp';"));
    assert.ok(out.includes("a2dp.A2dpSourceProfile.connect();"));
    assert.ok(out.includes("bm.untouchedMember();"));
    assert.ok(!out.includes("bm.A2dpSourceProfile.connect"));
  } finally {
    cleanup(root);
  }
});

test("scan: 2-seg dropin reuses an existing target-kit import (no inject)", () => {
  const root = makeTree({
    "p.ts": `import * as bm from '@ohos.bluetoothManager';
import * as a2dp from '@ohos.bluetooth.a2dp';
export function go() { bm.A2dpSourceProfile.connect(); }
`,
  });
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: crossKitMember2SegMap() });
    const a = bySymbol(findings, "bm.A2dpSourceProfile.connect");
    assert.equal(a?.replacement, "a2dp.A2dpSourceProfile.connect");
    assert.equal(findings.filter((f) => f.rule === "inject-import").length, 0);
  } finally {
    cleanup(root);
  }
});

test("scan: 2-seg dropin suffixes a colliding binding name", () => {
  const root = makeTree({
    "p.ts": `import * as bm from '@ohos.bluetoothManager';
import * as a2dp from '@ohos.totally.different';
export function go() { bm.A2dpSourceProfile.connect(); }
`,
  });
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: crossKitMember2SegMap() });
    const a = bySymbol(findings, "bm.A2dpSourceProfile.connect");
    assert.equal(a?.replacement, "a2dp2.A2dpSourceProfile.connect");
    const inj = findings.find((f) => f.rule === "inject-import");
    assert.ok(inj?.replacement!.includes("import * as a2dp2 from '@ohos.bluetooth.a2dp';"));
  } finally {
    cleanup(root);
  }
});

/* Round-7 end-to-end: the indexer now collects module-level sibling functions
 * (e.g. `declare function moveFile` alongside `declare namespace fileIo`),
 * so `system.file.move -> @ohos.file.fs.moveFile` is correctly flagged
 * crossKitMemberDropin and the scanner can rebind it. This exercises the full
 * buildDeprecationMap -> scanProjectMembers -> rewriteProject pipeline against
 * a real (synthetic) SDK tree rather than a hand-built map. */

function systemFileMoveSdk(): string {
  return makeTree({
    "@system.file.d.ts": `
declare namespace file {
  /** @since 6 @deprecated since 9 @useinstead ohos.file.fs.moveFile */
  function move(src: string, dest: string): void;
}
`,
    "@ohos.file.fs.d.ts": `
declare namespace fileIo { interface OpenMode { READ: number } }
/** @since 9 */
declare function moveFile(src: string, dest: string): void;
`,
  });
}

test("scan: real indexer flags system.file.move -> file.fs.moveFile (module-level fn)", () => {
  const sdk = systemFileMoveSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const e = map.entries.find(
      (x) => x.dep.kit === "@system.file" && x.dep.members?.[0] === "move",
    );
    assert.ok(e, "system.file.move entry exists");
    assert.equal(e!.crossKitMemberDropin, true, "flagged via module-level collection");

    const root = makeTree({
      "p.ts": `import * as sf from '@system.file';
export function go() { sf.move(a, b); sf.untouched(); }
`,
    });
    try {
      const { findings } = scanProjectMembers({ projectRoot: root, map });
      const a = bySymbol(findings, "sf.move");
      assert.equal(a?.rule, "rename-member");
      assert.equal(a?.replacement, "fs.moveFile");
      assert.ok(a?.note.includes("injected import"));
      const injects = findings.filter((f) => f.rule === "inject-import");
      assert.equal(injects.length, 1);
      assert.ok(injects[0].replacement!.includes("import * as fs from '@ohos.file.fs';"));
    } finally {
      cleanup(root);
    }
  } finally {
    cleanup(sdk);
  }
});

test("rewrite: real indexer pipeline system.file.move -> fs.moveFile injects + rebinds", () => {
  const sdk = systemFileMoveSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const root = makeTree({
      "p.ts": `import * as sf from '@system.file';
export function go() { sf.move(a, b); sf.untouched(); }
`,
    });
    try {
      const { findings } = scanProjectMembers({ projectRoot: root, map });
      const res = rewriteProject(root, findings, { write: true });
      assert.equal(res.skippedManual, 0);
      const out = readFileSync(join(root, "p.ts"), "utf8");
      assert.ok(out.includes("import * as fs from '@ohos.file.fs';"));
      assert.ok(out.includes("fs.moveFile(a, b);"));
      // old binding retained for the non-deprecated member
      assert.ok(out.includes("sf.untouched();"));
      assert.ok(!out.includes("sf.move("));
    } finally {
      cleanup(root);
    }
  } finally {
    cleanup(sdk);
  }
});

test("indexer + scan + rewrite: cross-kit 2-seg dropin injects import end-to-end", () => {
  // Real indexer verifies the container in the target kit -> crossKitMemberDropin
  // -> scanner rebinds the full 2-seg chain + injects -> rewriter applies both.
  const sdk = makeTree(SDK_FILES);
  const root = makeTree({
    "p.ts": `import * as bm from '@ohos.bluetoothManager';
export function go() { bm.A2dpSourceProfile.connect(); }
`,
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const { findings } = scanProjectMembers({ projectRoot: root, map });
    assert.ok(findings.some((f) => f.rule === "inject-import"));
    const res = rewriteProject(root, findings, { write: true });
    assert.equal(res.skippedManual, 0);
    const out = readFileSync(join(root, "p.ts"), "utf8");
    assert.ok(out.includes("import * as a2dp from '@ohos.bluetooth.a2dp';"));
    assert.ok(out.includes("a2dp.A2dpSourceProfile.connect();"));
    assert.ok(!out.includes("bm.A2dpSourceProfile.connect"));
  } finally {
    cleanup(sdk);
    cleanup(root);
  }
});

test("rewrite: inject-import + rebind at the same offset (call site right after the import)", () => {
  // When the deprecated call site is the FIRST thing on the line immediately
  // after the import block, the inject anchor (start of that line) COINCIDES
  // with the rebind match offset. The zero-length inject edit must NOT be
  // dropped as "overlapping" the rebind, and the bottom-up pass must apply the
  // replacement (consuming [anchor, anchor+len]) BEFORE the insertion at the
  // shared offset — reversing that order would splice the wrong text.
  const root = makeTree({
    "p.ts": `import * as bm from '@ohos.bluetoothManager';
bm.A2dpSourceProfile.connect();
`,
  });
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: crossKitMember2SegMap() });
    assert.ok(findings.some((f) => f.rule === "inject-import"), "inject emitted");
    const res = rewriteProject(root, findings, { write: true });
    assert.equal(res.skippedManual, 0);
    const out = readFileSync(join(root, "p.ts"), "utf8");
    assert.ok(out.includes("import * as a2dp from '@ohos.bluetooth.a2dp';"), "import injected");
    assert.ok(out.includes("a2dp.A2dpSourceProfile.connect();"), "rebind applied");
    assert.ok(!out.includes("bm.A2dpSourceProfile.connect"), "old call site gone");
    assert.ok(out.includes("import * as bm from '@ohos.bluetoothManager';"), "old import retained");
  } finally {
    cleanup(root);
  }
});

/* module-level */

/* same-kit container-rename + nested-match overlap dedup:
 * `rpc.MessageParcel.create` -> `rpc.MessageSequence.create` (a non-leaf
 * segment changes, same length). The SDK also deprecates the class itself
 * (`rpc.MessageParcel` -> `rpc.MessageSequence`); both regex-match the same
 * call site, so the scanner must keep only the longer finding and the
 * rewriter must not corrupt the text by splicing twice. */

function containerProject(): string {
  return makeTree({
    "page.ets": `
import rpc from '@ohos.rpc';
import media from '@ohos.multimedia.media';
const p = rpc.MessageParcel.create();
const e = media.MediaErrorCode.MSERR_IO;
`,
  });
}

function containerMap(): DeprecationMap {
  return mapOf([
    // class-level rename (would overlap the method match below)
    entry("@ohos.rpc", ["MessageParcel"], { kit: "@ohos.rpc", members: ["MessageSequence"] }, 9),
    // method-level: container segment changes, leaf preserved
    entry("@ohos.rpc", ["MessageParcel", "create"], { kit: "@ohos.rpc", members: ["MessageSequence", "create"] }, 9),
    // container + leaf both change
    entry("@ohos.multimedia.media", ["MediaErrorCode"], { kit: "@ohos.multimedia.media", members: ["AVErrorCode"] }, 11),
    entry("@ohos.multimedia.media", ["MediaErrorCode", "MSERR_IO"], { kit: "@ohos.multimedia.media", members: ["AVErrorCode", "AVERR_IO"] }, 11),
  ]);
}

test("scan: same-kit container-rename is rename-member (whole chain spliced)", () => {
  const root = containerProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: containerMap() });
    const f = bySymbol(findings, "rpc.MessageParcel.create");
    assert.equal(f?.rule, "rename-member");
    assert.equal(f?.replacement, "rpc.MessageSequence.create");
    const m = bySymbol(findings, "media.MediaErrorCode.MSERR_IO");
    assert.equal(m?.rule, "rename-member");
    assert.equal(m?.replacement, "media.AVErrorCode.AVERR_IO");
  } finally {
    cleanup(root);
  }
});

test("scan: nested class+method matches collapse to the longer finding", () => {
  const root = containerProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: containerMap() });
    // The shorter `rpc.MessageParcel` finding is subsumed by the longer
    // `rpc.MessageParcel.create` finding at the same call site -> not emitted.
    assert.equal(bySymbol(findings, "rpc.MessageParcel"), undefined);
    assert.ok(bySymbol(findings, "rpc.MessageParcel.create"), "longer finding kept");
    assert.equal(bySymbol(findings, "media.MediaErrorCode"), undefined);
    assert.ok(bySymbol(findings, "media.MediaErrorCode.MSERR_IO"), "longer finding kept");
  } finally {
    cleanup(root);
  }
});

test("rewrite: container-rename splices the whole chain without corruption", () => {
  const root = containerProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: containerMap() });
    const res = rewriteProject(root, findings, { write: true });
    const page = res.changedFiles.find((c) => c.file === "page.ets");
    assert.ok(page, "page.ets changed");
    // Final file content: whole chains spliced, no overlap-corruption, no leftovers.
    const out = readFileSync(join(root, "page.ets"), "utf8");
    assert.ok(out.includes("rpc.MessageSequence.create()"), "method chain spliced");
    assert.ok(out.includes("media.AVErrorCode.AVERR_IO"), "enum chain spliced");
    assert.ok(!out.includes("createte"), "no corrupted splice");
    assert.ok(!out.includes("MessageParcel"), "no leftover old class name");
    assert.ok(!out.includes("MSERR_IO"), "no leftover old enum value");
  } finally {
    cleanup(root);
  }
});

function moduleProject(): string {
  return makeTree({
    "page.ets": `
import moved from '@ohos.reminderAgent';
import manual from '@ohos.legacy';
import untouched from '@ohos.fresh';
moved.x();
manual.y();
untouched.z();
`,
  });
}

function moduleMap(): DeprecationMap {
  return mapOf([], {
    "@ohos.reminderAgent": { since: 9, newKit: "@ohos.reminderAgentManager" },
    "@ohos.legacy": { since: 9, manual: true },
    // @ohos.fresh absent -> not deprecated
  });
}

test("scan module-level: rewrite-import finding", () => {
  const root = moduleProject();
  try {
    const { findings } = scanProject({ projectRoot: root, map: moduleMap() });
    const f = bySymbol(findings, "@ohos.reminderAgent");
    assert.equal(f?.rule, "rewrite-import");
    assert.equal(f?.newSymbol, "@ohos.reminderAgentManager");
    assert.equal(f?.line, 2);
  } finally {
    cleanup(root);
  }
});

test("scan module-level: manual kit finding", () => {
  const root = moduleProject();
  try {
    const { findings } = scanProject({ projectRoot: root, map: moduleMap() });
    const f = bySymbol(findings, "@ohos.legacy");
    assert.equal(f?.rule, "manual");
    assert.equal(f?.needsManual, true);
    assert.equal(f?.newSymbol, null);
  } finally {
    cleanup(root);
  }
});

test("scan module-level: non-deprecated import yields no finding", () => {
  const root = moduleProject();
  try {
    const { findings } = scanProject({ projectRoot: root, map: moduleMap() });
    assert.equal(bySymbol(findings, "@ohos.fresh"), undefined);
  } finally {
    cleanup(root);
  }
});

test("scan: --since filter excludes newer deprecations", () => {
  const root = memberProject();
  try {
    const all = scanProjectMembers({ projectRoot: root, map: memberMap() }).findings;
    const filtered = scanProjectMembers({ projectRoot: root, map: memberMap(), since: 9 }).findings;
    // router.pushUrl is since 18 -> excluded by since<=9; router.push (since 9) stays.
    assert.ok(all.some((f) => f.oldSymbol === "router.pushUrl"));
    assert.equal(bySymbol(filtered, "router.pushUrl"), undefined, "since 18 excluded by since<=9");
    assert.ok(filtered.some((f) => f.oldSymbol === "router.push"), "since 9 kept");
  } finally {
    cleanup(root);
  }
});

/* ------------------------------------------------------------------ */
/* 3. Rewriter                                                        */
/* ------------------------------------------------------------------ */

test("rewrite: dry-run does not modify files", () => {
  const root = memberProject();
  try {
    const before = readFileSync(join(root, "page.ets"), "utf8");
    const findings = [
      ...scanProject({ projectRoot: root, map: moduleMap() }).findings,
      ...scanProjectMembers({ projectRoot: root, map: memberMap() }).findings,
    ];
    const res = rewriteProject(root, findings, { write: false });
    assert.ok(res.changedFiles.length >= 1);
    const after = readFileSync(join(root, "page.ets"), "utf8");
    assert.equal(after, before, "dry-run leaves the file untouched");
  } finally {
    cleanup(root);
  }
});

test("rewrite: --write applies rename-member and override in one file", () => {
  const root = memberProject();
  try {
    const findings = scanProjectMembers({ projectRoot: root, map: memberMap() }).findings;
    const res = rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "page.ets"), "utf8");
    assert.ok(out.includes("this.getUIContext().getRouter().pushUrl({ url: 'y' });"), "override applied");
    assert.ok(out.includes("this.getUIContext().getPromptAction().showToast({ message: 'm' });"), "PromptAction override");
    assert.ok(out.includes("this.getUIContext().getFont().registerFont({});"), "Font override");
    assert.ok(out.includes("this.getUIContext().createAnimator({});"), "self-head override");
    // rename-member: router.push -> router.pushUrl (binding.push -> pushUrl)
    assert.ok(out.includes("router.pushUrl({ url: 'x' });"), "rename-member applied");
    // manuals untouched
    assert.ok(out.includes("snap.takePhoto();"), "manual left untouched");
    assert.ok(res.skippedManual >= 1);
  } finally {
    cleanup(root);
  }
});

test("rewrite: module-level rewrite-import is applied", () => {
  const root = moduleProject();
  try {
    const findings = scanProject({ projectRoot: root, map: moduleMap() }).findings;
    rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "page.ets"), "utf8");
    assert.ok(out.includes("import moved from '@ohos.reminderAgentManager';"), "import specifier rewritten");
    assert.ok(!out.includes("@ohos.reminderAgent'"), "old specifier gone");
  } finally {
    cleanup(root);
  }
});

test("rewrite: multiple edits per file applied bottom-up (offsets stay valid)", () => {
  // Two auto-fixable member rewrites on adjacent lines; bottom-up application
  // must keep earlier offsets valid after the first (lower) splice.
  const root = makeTree({
    "p.ets": `
import router from '@ohos.router';
router.push({ url: 'a' });
router.pushUrl({ url: 'b' });
`,
  });
  try {
    const map = mapOf([
      entry("@ohos.router", ["push"], { members: ["pushUrl"] }, 9),
      entry("@ohos.router", ["pushUrl"], { kit: UI, members: ["Router", "pushUrl"] }, 18),
    ]);
    const findings = scanProjectMembers({ projectRoot: root, map }).findings;
    const res = rewriteProject(root, findings, { write: true });
    assert.equal(res.changedFiles.length, 1);
    assert.equal(res.changedFiles[0].edits.length, 2, "both edits applied");
    const out = readFileSync(join(root, "p.ets"), "utf8");
    assert.ok(out.includes("router.pushUrl({ url: 'a' });"));
    assert.ok(out.includes("this.getUIContext().getRouter().pushUrl({ url: 'b' });"));
  } finally {
    cleanup(root);
  }
});

test("rewrite: custom --ui-context expression is respected", () => {
  const root = makeTree({
    "p.ets": `
import prompt from '@ohos.prompt';
prompt.showToast({ message: 'm' });
`,
  });
  try {
    const map = mapOf([
      entry("@ohos.prompt", ["showToast"], { kit: UI, members: ["PromptAction", "showToast"] }, 9),
    ]);
    const findings = scanProjectMembers({ projectRoot: root, map, uiContextExpr: "this.ctx_" }).findings;
    rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "p.ets"), "utf8");
    assert.ok(out.includes("this.ctx_.getPromptAction().showToast"), "custom ctx used");
  } finally {
    cleanup(root);
  }
});

test("rewrite: overload dedup emits one finding, preferring auto-fixable", () => {
  // Same deprecated symbol with two map entries (one manual, one rename);
  // the scanner dedupes by (file:line:symbol) and keeps the auto-fixable one.
  const root = makeTree({
    "p.ets": `
import router from '@ohos.router';
router.push({ url: 'a' });
`,
  });
  try {
    const map = mapOf([
      entry("@ohos.router", ["push"], null, 9),                       // manual (no repl)
      entry("@ohos.router", ["push"], { members: ["pushUrl"] }, 9),  // rename-member
    ]);
    const { findings } = scanProjectMembers({ projectRoot: root, map });
    const matches = findings.filter((f) => f.oldSymbol === "router.push");
    assert.equal(matches.length, 1, "deduped to one finding");
    assert.equal(matches[0].rule, "rename-member", "auto-fixable wins over manual");
  } finally {
    cleanup(root);
  }
});

test("rewrite: manual findings are never written", () => {
  const root = memberProject();
  try {
    const findings = scanProjectMembers({ projectRoot: root, map: memberMap() }).findings;
    const res = rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "page.ets"), "utf8");
    // Every manual finding's symbol must still be present verbatim.
    assert.ok(out.includes("snap.takePhoto();"));
    assert.ok(out.includes("dataRdb.getRdbStore({});"));
    assert.ok(out.includes("same.foo();"));
    assert.ok(out.includes("noop.bar();"));
    assert.ok(out.includes("unresolved.deep.chain();"));
    assert.ok(res.skippedManual >= 4, "manuals counted as skipped");
  } finally {
    cleanup(root);
  }
});

/* ------------------------------------------------------------------ */
/* 4. Window recipe (WindowStage / Window cross-kit overrides)       */
/* ------------------------------------------------------------------ */

test("scan+rewrite: window WindowStage override end-to-end", () => {
  // FAModel Context.setShowOnLockScreen -> WindowStage.setShowOnLockScreen.
  // `context` is bound via the import so the member scanner can match it.
  const root = makeTree({
    "fa.ets": `
import context from '@ohos.ability.featureAbility';
context.setShowOnLockScreen(true);
context.setWakeUpScreen(false);
`,
  });
  try {
    const map = mapOf([
      entry("@ohos.ability.featureAbility", ["setShowOnLockScreen"],
        { kit: "@ohos.window", members: ["WindowStage", "setShowOnLockScreen"] }, 9),
      entry("@ohos.ability.featureAbility", ["setWakeUpScreen"],
        { kit: "@ohos.window", members: ["Window", "setWakeUpScreen"] }, 12),
    ]);
    const { findings } = scanProjectMembers({
      projectRoot: root, map,
      windowStageExpr: "this.windowStage", windowExpr: "this.window",
    });
    const stage = bySymbol(findings, "context.setShowOnLockScreen");
    const win = bySymbol(findings, "context.setWakeUpScreen");
    assert.equal(stage?.rule, "override");
    assert.equal(stage?.replacement, "this.windowStage.setShowOnLockScreen");
    assert.equal(win?.rule, "override");
    assert.equal(win?.replacement, "this.window.setWakeUpScreen");

    rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "fa.ets"), "utf8");
    assert.ok(out.includes("this.windowStage.setShowOnLockScreen(true);"));
    assert.ok(out.includes("this.window.setWakeUpScreen(false);"));
  } finally {
    cleanup(root);
  }
});

test("scan: same-kit window method rename is auto-fixable (rename-member), not override", () => {
  // window.Window.show -> window.Window.showWindow is same-kit; the window
  // recipe must not fire (would splice a wrong `this.window.showWindow`), but
  // the multi-segment leaf rename IS auto-fixable as rename-member.
  const root = makeTree({
    "w.ets": `
import window from '@ohos.window';
window.Window.show();
`,
  });
  try {
    const map = mapOf([
      entry("@ohos.window", ["Window", "show"],
        { kit: "@ohos.window", members: ["Window", "showWindow"] }, 9),
    ]);
    const { findings } = scanProjectMembers({ projectRoot: root, map });
    const f = bySymbol(findings, "window.Window.show");
    assert.equal(f?.rule, "rename-member", "multi-seg leaf rename is auto-fixable");
    assert.equal(f?.replacement, "window.Window.showWindow");
  } finally {
    cleanup(root);
  }
});

/* ------------------------------------------------------------------ */
/* 5. rename-export (same-kit export rename, e.g. By -> On)          */
/* ------------------------------------------------------------------ */

function exportMap(): DeprecationMap {
  // @ohos.UiTest export `By` is renamed to `On` (same kit). The memberless
  // entry (exportName=By, no members) carries the `since` for the --since
  // filter; the member-level entry (By.text -> On.text) is covered by the
  // export rename (aliased `By` resolves to `On`), so it is NOT also
  // auto-spliced in the body.
  const memberless: DeprecationEntry = {
    dep: { kit: "@ohos.UiTest", exportName: "By", members: [] },
    since: 9,
    repl: { kit: "@ohos.UiTest", members: ["On"] },
    kind: "member",
    source: { file: "", line: 0 },
  };
  return mapOf(
    [memberless, entry("@ohos.UiTest", ["text"], { kit: "@ohos.UiTest", members: ["On", "text"] }, 9)],
    {},
    { "@ohos.UiTest\0By": "On" },
  );
}

test("scan+rewrite: rename-export aliases a no-alias import to preserve the local binding", () => {
  const root = makeTree({
    "uitest.ets": `
import { By } from '@ohos.UiTest';
const x = By.text('hello');
const y = new By();
`,
  });
  try {
    const map = exportMap();
    const { findings } = scanProjectExportRenames({ projectRoot: root, map });
    const f = findings.find((x) => x.oldSymbol === "By");
    assert.equal(f?.rule, "rename-export");
    assert.equal(f?.replacement, "On as By", "no-alias -> alias to preserve local `By`");
    assert.equal(f?.newSymbol, "On");

    rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "uitest.ets"), "utf8");
    assert.ok(out.includes("import { On as By } from '@ohos.UiTest';"), "import aliased");
    // Body references are untouched (the alias keeps `By` valid -> resolves to On).
    assert.ok(out.includes("const x = By.text('hello');"));
    assert.ok(out.includes("const y = new By();"));
  } finally {
    cleanup(root);
  }
});

test("scan+rewrite: rename-export keeps an existing alias (`By as B` -> `On as B`)", () => {
  const root = makeTree({
    "uitest.ets": `
import { By as B } from '@ohos.UiTest';
const x = B.text('hello');
`,
  });
  try {
    const map = exportMap();
    const { findings } = scanProjectExportRenames({ projectRoot: root, map });
    const f = findings.find((x) => x.oldSymbol === "By");
    assert.equal(f?.replacement, "On", "aliased -> just swap the imported name");

    rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "uitest.ets"), "utf8");
    assert.ok(out.includes("import { On as B } from '@ohos.UiTest';"));
    assert.ok(out.includes("const x = B.text('hello');"), "local alias B unchanged");
  } finally {
    cleanup(root);
  }
});

test("scan: rename-export respects --since filter", () => {
  const root = makeTree({
    "uitest.ets": `
import { By } from '@ohos.UiTest';
`,
  });
  try {
    const map = exportMap();
    const kept = scanProjectExportRenames({ projectRoot: root, map, since: 9 }).findings;
    const filtered = scanProjectExportRenames({ projectRoot: root, map, since: 8 }).findings;
    assert.equal(kept.length, 1, "since 9 (deprecation since 9) is kept");
    assert.equal(filtered.length, 0, "since 8 excludes a since-9 deprecation");
  } finally {
    cleanup(root);
  }
});

test("scan: non-deprecated named imports yield no rename-export finding", () => {
  const root = makeTree({
    "fresh.ets": `
import { Fresh } from '@ohos.UiTest';
Fresh.foo();
`,
  });
  try {
    const map = exportMap();
    const { findings } = scanProjectExportRenames({ projectRoot: root, map });
    assert.equal(findings.length, 0);
  } finally {
    cleanup(root);
  }
});

/* 6. cross-kit drop-in (named-import clause, e.g.
 * `import { RouterOptions } from '@system.router'` -> '@ohos.router')       */
/* ------------------------------------------------------------------ */

function dropinMap(): DeprecationMap {
  // Exports moved to another kit under the same name. `@system.router`'s
  // RouterOptions and RouterState both -> @ohos.router (uniform). fileio's
  // access/open -> file.fs but hash -> file.hash (mixed); chmod has no drop-in
  // (removed) so a clause containing it must not rewrite.
  const dropin: DeprecationMap["crossKitDropin"] = {
    "@system.router\0RouterOptions": "@ohos.router",
    "@system.router\0RouterState": "@ohos.router",
    "@ohos.fileio\0access": "@ohos.file.fs",
    "@ohos.fileio\0open": "@ohos.file.fs",
    "@ohos.fileio\0hash": "@ohos.file.hash",
  };
  const e = (kit: string, name: string, target: string, since: number): DeprecationEntry => ({
    dep: { kit, exportName: name, members: [] },
    since,
    repl: { kit: target, members: [name] },
    kind: "member",
    source: { file: "", line: 0 },
  });
  return mapOf(
    [
      e("@system.router", "RouterOptions", "@ohos.router", 8),
      e("@system.router", "RouterState", "@ohos.router", 8),
      e("@ohos.fileio", "access", "@ohos.file.fs", 9),
      e("@ohos.fileio", "open", "@ohos.file.fs", 9),
      e("@ohos.fileio", "hash", "@ohos.file.hash", 9),
    ],
    {},
    {},
    dropin,
  );
}

test("scan: cross-kit drop-in rewrites a uniform named-import clause", () => {
  const root = makeTree({
    "p.ets": `
import { RouterOptions, RouterState } from '@system.router';
import { access, open } from '@ohos.fileio';
`,
  });
  try {
    const { findings } = scanProjectCrossKitDropin({ projectRoot: root, map: dropinMap() });
    const r = bySymbol(findings, "@system.router");
    assert.equal(r?.rule, "rewrite-import");
    assert.equal(r?.newSymbol, "@ohos.router");
    const f = bySymbol(findings, "@ohos.fileio");
    assert.equal(f?.newSymbol, "@ohos.file.fs");
  } finally {
    cleanup(root);
  }
});

test("scan: mixed-target clause is NOT rewritten", () => {
  const root = makeTree({ "p.ets": `import { access, hash } from '@ohos.fileio';` });
  try {
    const { findings } = scanProjectCrossKitDropin({ projectRoot: root, map: dropinMap() });
    assert.equal(findings.length, 0, "mixed targets -> no rewrite");
  } finally {
    cleanup(root);
  }
});

test("scan: clause with a removed export (no drop-in) is NOT rewritten", () => {
  // `chmod` has no drop-in target (removed) -> the whole clause is left alone.
  const root = makeTree({ "p.ets": `import { access, chmod } from '@ohos.fileio';` });
  try {
    const { findings } = scanProjectCrossKitDropin({ projectRoot: root, map: dropinMap() });
    assert.equal(findings.length, 0, "removed export in clause -> no rewrite");
  } finally {
    cleanup(root);
  }
});

test("rewrite: cross-kit drop-in rewrites specifier, keeps names", () => {
  const root = makeTree({
    "p.ets": `
import { RouterOptions } from '@system.router';
import { access, open } from '@ohos.fileio';
import { access, hash } from '@ohos.fileio';
`,
  });
  try {
    const { findings } = scanProjectCrossKitDropin({ projectRoot: root, map: dropinMap() });
    const res = rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "p.ets"), "utf8");
    assert.ok(out.includes("from '@ohos.router'"), "system.router -> ohos.router");
    assert.ok(out.includes("import { access, open } from '@ohos.file.fs'"), "fileio uniform -> file.fs");
    // Mixed clause must be untouched.
    assert.ok(out.includes("import { access, hash } from '@ohos.fileio'"), "mixed clause untouched");
    assert.equal(res.skippedManual, 0);
  } finally {
    cleanup(root);
  }
});

/* 6b. cross-kit rename-export (named import moves to another kit under a
 * different name, e.g. `import { fstat } from '@ohos.fileio'` ->
 * `import { stat as fstat } from '@ohos.file.fs'`). The local binding is
 * aliased to the new name so call sites (`fstat(...)`) need no body rewrite. */
/* ------------------------------------------------------------------ */

function renameMap(): DeprecationMap {
  // `@ohos.fileio.fstat` -> `@ohos.file.fs.stat` (different name, same kit as
  // `access`/`open` which are same-name drop-ins). A mixed clause of
  // same-name + different-name to the SAME kit rewrites the specifier once
  // and aliases only the different-name binding.
  const dropin: DeprecationMap["crossKitDropin"] = {
    "@ohos.fileio\0access": "@ohos.file.fs",
  };
  const rename: DeprecationMap["crossKitRenameExport"] = {
    "@ohos.fileio\0fstat": "@ohos.file.fs\0stat",
    "@ohos.fileio\0opendir": "@ohos.file.fs\0listFile",
  };
  const e = (kit: string, name: string, tKit: string, tName: string, since: number): DeprecationEntry => ({
    dep: { kit, exportName: name, members: [] },
    since,
    repl: { kit: tKit, members: [tName] },
    kind: "member",
    source: { file: "", line: 0 },
  });
  return mapOf(
    [
      e("@ohos.fileio", "access", "@ohos.file.fs", "access", 9),
      e("@ohos.fileio", "fstat", "@ohos.file.fs", "stat", 9),
      e("@ohos.fileio", "opendir", "@ohos.file.fs", "listFile", 9),
    ],
    {},
    {},
    dropin,
    rename,
  );
}

test("scan: cross-kit rename aliases binding + rewrites specifier", () => {
  const root = makeTree({ "p.ts": `import { fstat } from '@ohos.fileio';` });
  try {
    const { findings } = scanProjectCrossKitDropin({ projectRoot: root, map: renameMap() });
    const spec = bySymbol(findings, "@ohos.fileio");
    assert.equal(spec?.rule, "rewrite-import");
    assert.equal(spec?.newSymbol, "@ohos.file.fs");
    const b = bySymbol(findings, "fstat");
    assert.equal(b?.rule, "rename-export");
    assert.equal(b?.newSymbol, "stat");
    assert.equal(b?.replacement, "stat as fstat");
  } finally {
    cleanup(root);
  }
});

test("scan: mixed same-name + rename clause to one kit rewrites + aliases only the rename", () => {
  // `access` (same-name drop-in) + `fstat` (rename) both -> @ohos.file.fs.
  const root = makeTree({ "p.ts": `import { access, fstat } from '@ohos.fileio';` });
  try {
    const { findings } = scanProjectCrossKitDropin({ projectRoot: root, map: renameMap() });
    const spec = bySymbol(findings, "@ohos.fileio");
    assert.equal(spec?.newSymbol, "@ohos.file.fs");
    const b = bySymbol(findings, "fstat");
    assert.equal(b?.replacement, "stat as fstat");
    // `access` keeps its name -> no rename-export finding for it.
    assert.equal(bySymbol(findings, "access"), undefined);
  } finally {
    cleanup(root);
  }
});

test("rewrite: cross-kit rename produces `stat as fstat` + new specifier", () => {
  const root = makeTree({ "p.ts": `import { fstat } from '@ohos.fileio';\nfstat(3);` });
  try {
    const { findings } = scanProjectCrossKitDropin({ projectRoot: root, map: renameMap() });
    const res = rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "p.ts"), "utf8");
    assert.ok(out.includes("import { stat as fstat } from '@ohos.file.fs';"), "specifier + alias applied");
    assert.ok(out.includes("fstat(3);"), "call site unchanged (local binding preserved)");
    assert.equal(res.skippedManual, 0);
  } finally {
    cleanup(root);
  }
});

test("scan: mixed-target rename clause is NOT rewritten", () => {
  // `fstat` -> @ohos.file.fs, but `hash` -> @ohos.file.hash (different kit).
  const root = makeTree({ "p.ts": `import { fstat, hash } from '@ohos.fileio';` });
  try {
    const map = renameMap();
    // add a hash -> file.hash to make targets mixed
    map.crossKitRenameExport!["@ohos.fileio\0hash"] = "@ohos.file.hash\0hashify";
    const { findings } = scanProjectCrossKitDropin({ projectRoot: root, map });
    assert.equal(findings.length, 0, "mixed target kits -> no rewrite");
  } finally {
    cleanup(root);
  }
});

/* 7. instance-method scanner (typed receiver, e.g. `m.getString()` where
 * `m` is typed `resourceManager.ResourceManager`). The binding-only scanner
 * misses these; the instance scanner resolves the var's type via imports. */
/* ------------------------------------------------------------------ */

function instanceMap(): DeprecationMap {
  // shape 1: namespace.type.leaf -> leaf (instanceSafe verified -> auto)
  const safe: DeprecationEntry = {
    dep: { kit: "@ohos.fake", exportName: "fake", members: ["Mgr", "old"] },
    since: 9, repl: { kit: "@ohos.fake", members: ["new"] }, kind: "member",
    source: { file: "", line: 0 }, instanceSafe: true,
  };
  // shape 1, same leaf, NOT instanceSafe (method -> namespace fn) -> manual
  const nsfn: DeprecationEntry = {
    dep: { kit: "@ohos.fake", exportName: "fake", members: ["Mgr", "op"] },
    since: 20, repl: { kit: "@ohos.fake", members: ["op"] }, kind: "member",
    source: { file: "", line: 0 },
  };
  // shape 2: type.leaf cross-kit (FA->stageless) -> manual
  const fa: DeprecationEntry = {
    dep: { kit: "@ohos.ability.featureAbility", exportName: "Context", members: ["setShowOnLockScreen"] },
    since: 9, repl: { kit: "@ohos.window", members: ["WindowStage", "setShowOnLockScreen"] }, kind: "member",
    source: { file: "", line: 0 },
  };
  return mapOf([safe, nsfn, fa]);
}

test("scan: instance-method rename on a typed param is auto-fixable", () => {
  const root = makeTree({
    "p.ets": `
import fake from '@ohos.fake';
function f(m: fake.Mgr) { m.old(); }
`,
  });
  try {
    const { findings } = scanProjectInstanceMembers({ projectRoot: root, map: instanceMap() });
    const r = bySymbol(findings, "m.old");
    assert.equal(r?.rule, "rename-member");
    assert.equal(r?.replacement, "m.new");
  } finally { cleanup(root); }
});

test("scan: method->namespace-function (same leaf, not instanceSafe) is manual", () => {
  const root = makeTree({
    "p.ets": `
import fake from '@ohos.fake';
function f(m: fake.Mgr) { m.op(); }
`,
  });
  try {
    const { findings } = scanProjectInstanceMembers({ projectRoot: root, map: instanceMap() });
    const r = bySymbol(findings, "m.op");
    assert.equal(r?.rule, "manual");
    assert.equal(r?.needsManual, true);
    assert.equal(r?.replacement, undefined, "no splice — receiver changes to the namespace");
  } finally { cleanup(root); }
});

test("scan: FA->stageless instance method is detected (not a silent miss)", () => {
  const root = makeTree({
    "p.ets": `
import fa from '@ohos.ability.featureAbility';
function f(ctx: fa.Context) { ctx.setShowOnLockScreen(true); }
`,
  });
  try {
    const { findings } = scanProjectInstanceMembers({ projectRoot: root, map: instanceMap() });
    const r = bySymbol(findings, "ctx.setShowOnLockScreen");
    assert.equal(r?.rule, "manual");
    assert.ok(r?.note.includes("@ohos.window/WindowStage.setShowOnLockScreen"));
  } finally { cleanup(root); }
});

test("scan: untyped receiver is NOT detected (no false positive)", () => {
  const root = makeTree({
    "p.ets": `
import fake from '@ohos.fake';
function f() { let m = getMgr(); m.old(); }
`,
  });
  try {
    const { findings } = scanProjectInstanceMembers({ projectRoot: root, map: instanceMap() });
    assert.equal(findings.length, 0, "untyped var not resolved -> no finding");
  } finally { cleanup(root); }
});

test("rewrite: instance-method rename splices the receiver's leaf", () => {
  const root = makeTree({
    "p.ets": `
import fake from '@ohos.fake';
function f(m: fake.Mgr) { m.old(); m.op(); }
`,
  });
  try {
    const { findings } = scanProjectInstanceMembers({ projectRoot: root, map: instanceMap() });
    const res = rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "p.ets"), "utf8");
    assert.ok(out.includes("m.new()"), "auto-fix applied");
    assert.ok(out.includes("m.op()"), "manual left untouched");
    assert.equal(res.skippedManual, 1);
  } finally { cleanup(root); }
});

/* 8. Asymmetric @useinstead shapes authored as `ohos.<kit>.<namespace>#<member>`
 * (JSDoc Class#member notation). Two sub-cases:
 *   B1 — namespace-function rename: `<namespace>` == the kit's own namespace
 *        (== kit last segment); the leading repl segment is the binding itself,
 *        not a member. Stripping it yields a 1-seg same-kit leaf rename the
 *        binding scanner auto-fixes (e.g. pasteboard.createHtmlData ->
 *        pasteboard.createData).
 *   B2 — instance-method rename: `<namespace>` is a real class/interface
 *        (differs from the kit last segment); repl stays 2-seg and is handled
 *        by the instance scanner once verifyInstanceSafe's asymmetric branch
 *        confirms the new leaf is a sibling member (e.g. Router.getLength ->
 *        Router.getStackSize). */
/* ------------------------------------------------------------------ */

function asymmetricSdk(): string {
  return makeTree({
    "@ohos.pasteboard.d.ts": `
declare namespace pasteboard {
  /** @since 7 @deprecated since 9 @useinstead ohos.pasteboard.pasteboard#createData */
  function createHtmlData(htmlText: string): PasteData;
  function createData(): PasteData;
  export interface PasteData { data: string }
}
`,
    "@ohos.arkui.UIContext.d.ts": `
declare namespace UIContext {}
export class Router {
  /** @since 9 @deprecated since 10 @useinstead ohos.arkui.UIContext.Router#getStackSize */
  getLength(): string;
  getStackSize(): number;
}
/** control: the new leaf is NOT a sibling member -> instanceSafe stays unset */
export class Lone {
  /** @since 9 @deprecated since 10 @useinstead ohos.arkui.UIContext.Lone#newMethod */
  oldMethod(): void;
}
`,
  });
}

test("indexer: redundant kit-namespace prefix stripped from #member repl (B1)", () => {
  const sdk = asymmetricSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const e = map.entries.find(
      (x) => x.dep.kit === "@ohos.pasteboard" && x.dep.members?.[0] === "createHtmlData",
    );
    assert.ok(e, "createHtmlData indexed");
    assert.deepEqual(e!.repl?.members, ["createData"], "redundant `pasteboard` prefix stripped -> 1-seg");
    assert.equal(e!.repl?.kit, "@ohos.pasteboard", "kit preserved");
  } finally { cleanup(sdk); }
});

test("indexer + scan + rewrite: namespace-function #member rename auto-fixes (B1)", () => {
  const sdk = asymmetricSdk();
  const root = makeTree({
    "p.ets": `import pasteboard from '@ohos.pasteboard';\npasteboard.createHtmlData('x');\n`,
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const { findings } = scanProjectMembers({ projectRoot: root, map });
    const f = bySymbol(findings, "pasteboard.createHtmlData");
    assert.equal(f?.rule, "rename-member");
    assert.equal(f?.replacement, "pasteboard.createData");
    assert.equal(f?.needsManual, false);
    const res = rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "p.ets"), "utf8");
    assert.ok(out.includes("pasteboard.createData('x')"), "renamed");
    assert.ok(!out.includes("pasteboard.createHtmlData"), "old symbol gone");
    assert.equal(res.skippedManual, 0);
  } finally { cleanup(sdk); cleanup(root); }
});

test("indexer: asymmetric 1->2 instance-method repl flagged instanceSafe (B2)", () => {
  const sdk = asymmetricSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const e = map.entries.find(
      (x) => x.dep.kit === "@ohos.arkui.UIContext" && x.dep.exportName === "Router" && x.dep.members?.[0] === "getLength",
    );
    assert.ok(e, "Router.getLength indexed");
    assert.deepEqual(e!.repl?.members, ["Router", "getStackSize"], "repl stays 2-seg (class, not stripped)");
    assert.equal(e!.instanceSafe, true, "asymmetric sibling-verified -> instanceSafe");
    // control: Lone.oldMethod -> newMethod, but newMethod is not a sibling member
    const lone = map.entries.find(
      (x) => x.dep.exportName === "Lone" && x.dep.members?.[0] === "oldMethod",
    );
    assert.ok(lone, "Lone.oldMethod indexed");
    assert.notEqual(lone!.instanceSafe, true, "no sibling -> NOT instanceSafe (stays manual)");
  } finally { cleanup(sdk); }
});

test("scan + rewrite: asymmetric instance-method rename auto-fixes (B2)", () => {
  const sdk = asymmetricSdk();
  const root = makeTree({
    "p.ts": `import { Router } from '@ohos.arkui.UIContext';\nlet r: Router = {} as Router;\nr.getLength();\n`,
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const { findings } = scanProjectInstanceMembers({ projectRoot: root, map });
    const f = bySymbol(findings, "r.getLength");
    assert.equal(f?.rule, "rename-member");
    assert.equal(f?.replacement, "r.getStackSize");
    assert.equal(f?.needsManual, false);
    rewriteProject(root, findings, { write: true });
    const out = readFileSync(join(root, "p.ts"), "utf8");
    assert.ok(out.includes("r.getStackSize()"), "instance method renamed");
    assert.ok(!out.includes("r.getLength()"), "old call gone");
  } finally { cleanup(sdk); cleanup(root); }
});

/**
 * Round 11 — a relocated kit (kit move) where the new kit PRESERVES some
 * members (no @useinstead: the kit-move import rewrite already covers them)
 * but DROPS others. The verifier must flag only the preserved ones; dropped
 * members stay manual (the re-pointed binding would reference a kit that no
 * longer declares them). Encodes the trap found during investigation: a naive
 * "suppress every no-repl member under a relocated kit" would corrupt call
 * sites of removed members (e.g. wantConstant.Action.ACTION_HOME, where the
 * Action enum was dropped from the new kit).
 */
function movedSdk(): string {
  return makeTree({
    "@ohos.ability.fakeConst.d.ts": `
/**
 * @since 9 @deprecated since 9
 * @useinstead ohos.app.ability.fakeConst
 */
declare namespace fakeConst {
    export enum Action {
        /** @since 9 @deprecated since 10 */
        A = 1,
        /** @since 9 @deprecated since 10 */
        B = 2,
    }
    export enum Flags {
        /** @since 9 @deprecated since 10 */
        F1 = 1,
        /** @since 9 @deprecated since 10 */
        F2 = 2,
        /** @since 9 @deprecated since 10 */
        F3 = 4,
    }
}
`,
    // New kit: `Flags` survives WITH F1 and F3 (F2 dropped); `Action` is gone.
    "@ohos.app.ability.fakeConst.d.ts": `
declare namespace fakeConst {
    export enum Flags {
        F1 = 1,
        F3 = 4,
    }
}
`,
  });
}

/**
 * Round 11 (drop-in shape) — an interface moved cross-kit under the same name
 * (`Stat` @ohos.fileio -> @ohos.file.fs) where the new interface PRESERVES some
 * properties and DROPS others. The named-import drop-in re-points `import
 * {Stat}` to the new kit, so a preserved property's instance access already
 * resolves on the re-pointed binding (suppress); a dropped property stays
 * manual.
 */
function dropinMovedSdk(): string {
  return makeTree({
    // `Stat` is a MODULE-LEVEL `declare interface` (matching the real
    // `@ohos.fileio.d.ts`): export-level, so its @useinstead registers a
    // cross-kit same-name drop-in. Its properties `dev`/`nlink` are separate
    // member entries (exportName=Stat, members=[dev|nlink]).
    "@ohos.fileio.d.ts": `
/** @since 9 @deprecated since 10 @useinstead ohos.file.fs.Stat */
declare interface Stat {
    /** @since 9 @deprecated since 10 */
    dev: number;
    /** @since 9 @deprecated since 10 */
    nlink: number;
}
`,
    // New kit: `Stat` survives WITH `nlink` (preserved) but WITHOUT `dev`.
    "@ohos.file.fs.d.ts": `
declare namespace fs {
    export interface Stat {
        ino: bigint;
        nlink: number;
    }
}
`,
  });
}

test("indexer: relocated-kit member flagged memberPreservedByMove only when preserved (B3 trap guard)", () => {
  const sdk = movedSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const get = (chain: string) => map.entries.find(
      (x) => x.dep.kit === "@ohos.ability.fakeConst" && x.dep.members?.join(".") === chain,
    );
    // Preserved in the new kit -> flagged (covered by the kit-move import rewrite).
    assert.equal(get("Flags.F1")?.memberPreservedByMove, true, "Flags.F1 preserved -> flagged");
    assert.equal(get("Flags.F3")?.memberPreservedByMove, true, "Flags.F3 preserved -> flagged");
    // Dropped in the new kit -> NOT flagged (stays manual: re-pointed binding
    // would reference a kit that no longer declares the member).
    assert.notEqual(get("Flags.F2")?.memberPreservedByMove, true, "Flags.F2 dropped -> NOT flagged");
    // The whole `Action` enum was dropped from the new kit -> its members stay manual.
    assert.notEqual(get("Action.A")?.memberPreservedByMove, true, "Action.A (enum dropped) -> NOT flagged");
    assert.notEqual(get("Action.B")?.memberPreservedByMove, true, "Action.B (enum dropped) -> NOT flagged");
  } finally { cleanup(sdk); }
});

test("scan + rewrite: preserved member suppressed, removed member still reported (kit move)", () => {
  const sdk = movedSdk();
  const root = makeTree({
    "p.ts":
      `import { fakeConst } from '@ohos.ability.fakeConst';\n` +
      `fakeConst.Flags.F1;\n` +   // preserved -> suppressed (kit-move rewrite covers it)
      `fakeConst.Flags.F2;\n` +   // removed -> manual finding
      `fakeConst.Action.A;\n`,    // removed -> manual finding
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const { findings } = scanProjectMembers({ projectRoot: root, map });
    // F1 is preserved: NO member finding (the kit-move import rewrite handles it).
    assert.ok(!bySymbol(findings as any, "fakeConst.Flags.F1"), "F1 preserved -> no member finding");
    // F2 and Action.A were dropped: manual findings still surface them.
    const f2 = bySymbol(findings as any, "fakeConst.Flags.F2");
    assert.equal(f2?.rule, "manual");
    assert.equal(f2?.needsManual, true);
    const aa = bySymbol(findings as any, "fakeConst.Action.A");
    assert.equal(aa?.rule, "manual");
    assert.equal(aa?.needsManual, true);
  } finally { cleanup(sdk); cleanup(root); }
});

/**
 * Round 12 (same-kit container-rename shape) — a container declared in a kit is
 * `@deprecated` with a SAME-KIT `@useinstead` pointing to a renamed container
 * (mirrors `huks.HuksResult` -> `HuksReturnResult`, or `huks.HuksErrorCode` ->
 * `HuksExceptionErrCode`). Its members are separate no-`@useinstead` 2-seg
 * entries. The container rename's own 1-seg repl auto-rewrites the binding
 * (`import {ErrorCode}` -> `import {ErrorCode2}`), so a member PRESERVED in the
 * new container needs no access-site splice (suppress); a member removed or
 * renamed in the new container stays manual. This is also the classic trap:
 * `huks.HuksErrorCode.HUKS_*` whose target `HuksExceptionErrCode` uses the
 * `HUKS_ERR_CODE_*` naming — none preserved, so all stay manual.
 */
function sameKitRenameSdk(): string {
  return makeTree({
    "@ohos.sec.fake.d.ts": `
declare namespace fake {
    /**
     * @since 9 @deprecated since 10
     * @useinstead ohos.sec.fake.ErrorCode2
     */
    export enum ErrorCode {
        /** @since 9 @deprecated since 10 */
        SUCCESS = 0,
        /** @since 9 @deprecated since 10 */
        FAILURE = 1,
    }
    export enum ErrorCode2 {
        SUCCESS = 0,
        FAILURE2 = 1,
    }
}
`,
  });
}

test("indexer: same-kit container-rename member flagged memberPreservedByMove only when preserved", () => {
  const sdk = sameKitRenameSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const get = (leaf: string) => map.entries.find(
      (x) => x.dep.kit === "@ohos.sec.fake" && x.dep.members?.join(".") === `ErrorCode.${leaf}`,
    );
    // Preserved in the renamed container -> flagged (the 1-seg container rename
    // covers it).
    assert.equal(get("SUCCESS")?.memberPreservedByMove, true, "ErrorCode.SUCCESS preserved -> flagged");
    // Renamed away in the new container (FAILURE -> FAILURE2) -> NOT flagged.
    assert.notEqual(get("FAILURE")?.memberPreservedByMove, true, "ErrorCode.FAILURE not in ErrorCode2 -> NOT flagged");
  } finally { cleanup(sdk); }
});

test("scan + rewrite: same-kit preserved member suppressed, renamed member still reported", () => {
  const sdk = sameKitRenameSdk();
  const root = makeTree({
    "p.ts":
      `import { fake } from '@ohos.sec.fake';\n` +
      `fake.ErrorCode.SUCCESS;\n` +   // preserved -> suppressed (container rename covers it)
      `fake.ErrorCode.FAILURE;\n`,   // renamed (FAILURE2) -> manual finding
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const { findings } = scanProjectMembers({ projectRoot: root, map });
    // SUCCESS is preserved: NO member finding (the container rename handles it).
    assert.ok(!bySymbol(findings as any, "fake.ErrorCode.SUCCESS"), "SUCCESS preserved -> no member finding");
    // FAILURE was renamed away: manual finding still surfaces it.
    const f = bySymbol(findings as any, "fake.ErrorCode.FAILURE");
    assert.equal(f?.rule, "manual");
    assert.equal(f?.needsManual, true);
  } finally { cleanup(sdk); cleanup(root); }
});

/**
 * Round 13 (cross-kit redundant-namespace-prefix strip, leaf-preserved) — an
 * `@useinstead` authored as `ohos.<newKit>.<newNamespace>#<leaf>` where the
 * new namespace is the new kit's OWN namespace (e.g.
 * `@system.router.Router.push` -> `@ohos.router:router.push`). The redundant
 * `router` prefix differs from the OLD export name `Router`, so round 10's
 * same-kit strip (which requires `repl[0]===dep.exportName`) left it a 2-seg
 * chain-mismatch. Round 13 strips it when the leaf is PRESERVED, yielding a
 * 1-seg cross-kit dropin the existing verifier+scanner auto-rebinds
 * (`Router.push` -> `router.push` via injected `import * as router`).
 *
 * The leaf-RENAMED sibling (`getStorageSync` -> `getPreferences`, mirroring the
 * real `storage.getStorageSync` -> `preferences.getPreferences` which adds a
 * `Context` arg and turns sync into async) is NOT stripped — a renamed leaf on
 * a cross-kit move coincides with signature changes, so a 1-seg rebind would
 * mis-splice. It stays 2-seg chain-mismatch (manual).
 */
function crossKitRenameSdk(): string {
  return makeTree({
    "@system.fakeRouter.d.ts": `
declare namespace fakeRouter {
    /** @since 9 @deprecated since 10 @useinstead ohos.fake.router.router#push */
    export function push(options: object): void;
    /** @since 9 @deprecated since 10 @useinstead ohos.fake.router.router#getPreferences */
    export function getStorageSync(name: string): void;
}
`,
    "@ohos.fake.router.d.ts": `
declare namespace router {
    export function push(options: object): void;
    export function getPreferences(context: object, name: string): void;
}
`,
  });
}

test("indexer: cross-kit redundant-namespace-prefix strip only when leaf preserved", () => {
  const sdk = crossKitRenameSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const get = (leaf: string) => map.entries.find(
      (x) => x.dep.kit === "@system.fakeRouter" && x.dep.members?.[0] === leaf,
    );
    // push: leaf preserved (push->push) -> redundant `router` prefix stripped ->
    // 1-seg cross-kit dropin, verified against the new kit's top-level exports.
    const push = get("push");
    assert.equal(push?.crossKitMemberDropin, true, "push leaf-preserved -> stripped + flagged");
    assert.deepEqual(push?.repl?.members, ["push"], "redundant router prefix stripped");
    // getStorageSync: leaf renamed (->getPreferences) -> NOT stripped (signature-
    // change risk), stays 2-seg chain-mismatch, not flagged.
    const sync = get("getStorageSync");
    assert.notEqual(sync?.crossKitMemberDropin, true, "getStorageSync leaf-renamed -> NOT flagged");
    assert.deepEqual(sync?.repl?.members, ["router", "getPreferences"], "leaf-renamed repl stays 2-seg");
  } finally { cleanup(sdk); }
});

test("scan + rewrite: cross-kit prefix-strip rebinds Router.push -> router.push (leaf-renamed stays manual)", () => {
  const sdk = crossKitRenameSdk();
  const root = makeTree({
    "p.ts":
      `import { fakeRouter } from '@system.fakeRouter';\n` +
      `fakeRouter.push({});\n` +          // leaf-preserved -> auto rebind
      `fakeRouter.getStorageSync('k');\n`, // leaf-renamed -> manual finding
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const { findings } = scanProjectMembers({ projectRoot: root, map });
    // push is auto: one rename-member rebind + one inject-import.
    const push = bySymbol(findings as any, "fakeRouter.push");
    assert.equal(push?.rule, "rename-member");
    assert.ok(push?.replacement?.includes("router.push"), push?.replacement);
    assert.ok(findings.some((f) => f.rule === "inject-import" && f.replacement?.includes("@ohos.fake.router")));
    // getStorageSync is leaf-renamed -> manual (signature change).
    const sync = bySymbol(findings as any, "fakeRouter.getStorageSync");
    assert.equal(sync?.rule, "manual");
    assert.equal(sync?.needsManual, true);
  } finally { cleanup(sdk); cleanup(root); }
});

/**
 * Round 14 (same-kit 1->2 nested-container INSERT) — a deprecated top-level
 * function whose `@useinstead` points at a STATIC method of a nested class in
 * the SAME kit (e.g. `@ohos.i18n.is24HourClock` -> `i18n.System.is24HourClock`,
 * `@ohos.UiTest.create` -> `UiTest.Driver.create`). The shape change is purely
 * an inserted container segment in front of a preserved leaf, so the scanner
 * splices `binding.<leaf>` -> `binding.<container>.<leaf>` and REUSES the
 * existing kit binding (no import injection).
 *
 * Five traps the verification gates must reject:
 *  - INSTANCE method (`process.ProcessManager.isAppUid` — calling an instance
 *    method on the class is broken): the leaf must be `static`.
 *  - INTERFACE container (`worker.WorkerEventTarget.*` — interfaces are
 *    type-only, no runtime value to call on): only a CLASS container qualifies.
 *  - STALE `@useinstead` naming a method the class doesn't declare
 *    (`i18n.set24HourClock` -> `System.set24HourClock`, but System has no
 *    setter): the method must actually exist on the class.
 *  - RESTATE-LEAF / non-container (`contact.addContact.addContact`): the
 *    container must be a real top-level export of the kit.
 *  - AMBIGUOUS symbol (`UiTest.click` -> both Component.click and Driver.click):
 *    the symbol must map to exactly one container.
 *
 * The fixture also covers the SDK's malformed short form `ohos.System.X` (no
 * resolvable kit) — repl.kit ends up undefined, but the same-kit intent holds
 * and the top-level-export gate verifies the container in dep.kit regardless.
 */
function nestedInsertSdk(): string {
  return makeTree({
    "@ohos.fakelib.d.ts": `
declare namespace fakelib {
    /** @since 9 @deprecated since 10 @useinstead ohos.fakelib/fakelib.System#is24HourClock */
    export function is24HourClock(): boolean;
    /** @since 9 @deprecated since 10 @useinstead ohos.System.getDisplayCountry */
    export function getDisplayCountry(country: string): string;
    /** @since 9 @deprecated since 10 @useinstead ohos.fakelib/fakelib.ProcessManager#isAppUid */
    export function isAppUid(v: number): boolean;
    /** @since 9 @deprecated since 10 @useinstead ohos.fakelib/fakelib.WorkerEventTarget#addEventListener */
    export function addEventListener(type: string): void;
    /** @since 9 @deprecated since 10 @useinstead ohos.fakelib/fakelib.System#set24HourClock */
    export function set24HourClock(option: boolean): void;

    export class System {
        static is24HourClock(): boolean;
        static getDisplayCountry(country: string): string;
    }
    export class ProcessManager {
        isAppUid(v: number): boolean;
    }
    export interface WorkerEventTarget {
        addEventListener(type: string): void;
    }
}
`,
  });
}

test("indexer: same-kit nested static-method insert flagged, traps rejected", () => {
  const sdk = nestedInsertSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const get = (leaf: string) => map.entries.find(
      (x) => x.dep.kit === "@ohos.fakelib" && x.dep.members?.[0] === leaf,
    );
    // Full-form @useinstead (repl.kit resolved) + static -> flagged.
    assert.equal(get("is24HourClock")?.nestedContainerInsert, true, "static System.is24HourClock -> flagged");
    assert.deepEqual(get("is24HourClock")?.repl?.members, ["System", "is24HourClock"]);
    // Malformed short form `ohos.System.X` (repl.kit undefined) + static -> flagged
    // (same-kit intent; the top-level-export gate verifies System in dep.kit).
    assert.equal(get("getDisplayCountry")?.nestedContainerInsert, true, "malformed-short-form static -> flagged");
    assert.equal(get("getDisplayCountry")?.repl?.kit, undefined, "short form leaves kit unresolved");
    // INSTANCE method -> NOT flagged (calling an instance method on the class breaks).
    assert.notEqual(get("isAppUid")?.nestedContainerInsert, true, "instance ProcessManager.isAppUid -> NOT flagged");
    // INTERFACE container -> NOT flagged (type-only, no runtime value).
    assert.notEqual(get("addEventListener")?.nestedContainerInsert, true, "interface WorkerEventTarget -> NOT flagged");
    // STALE @useinstead (System has no set24HourClock) -> NOT flagged.
    assert.notEqual(get("set24HourClock")?.nestedContainerInsert, true, "stale @useinstead -> NOT flagged");
  } finally { cleanup(sdk); }
});

test("scan: nested insert splices binding.leaf -> binding.container.leaf (no inject)", () => {
  const sdk = nestedInsertSdk();
  const root = makeTree({
    "p.ts":
      `import { fakelib } from '@ohos.fakelib';\n` +
      `fakelib.is24HourClock();\n` +        // static -> auto insert
      `fakelib.getDisplayCountry('US');\n` + // static (short form) -> auto insert
      `fakelib.isAppUid(1);\n` +            // instance -> manual
      `fakelib.set24HourClock(true);\n`,    // stale -> manual
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const { findings } = scanProjectMembers({ projectRoot: root, map });
    // Both static leaves are auto: rename-member, no manual.
    const clock = bySymbol(findings as any, "fakelib.is24HourClock");
    assert.equal(clock?.rule, "rename-member");
    assert.equal(clock?.needsManual, false);
    assert.equal(clock?.replacement, "fakelib.System.is24HourClock");
    const country = bySymbol(findings as any, "fakelib.getDisplayCountry");
    assert.equal(country?.rule, "rename-member");
    assert.equal(country?.replacement, "fakelib.System.getDisplayCountry");
    // Instance + stale are manual.
    assert.equal(bySymbol(findings as any, "fakelib.isAppUid")?.rule, "manual");
    assert.equal(bySymbol(findings as any, "fakelib.set24HourClock")?.rule, "manual");
    // No import injection: the existing kit binding is reused.
    assert.ok(!findings.some((f) => f.rule === "inject-import"), "no inject-import for same-kit insert");
  } finally { cleanup(sdk); cleanup(root); }
});

test("rewrite: nested insert splices in place + retains the kit binding (no inject)", () => {
  const sdk = nestedInsertSdk();
  const root = makeTree({
    "p.ts":
      `import { fakelib } from '@ohos.fakelib';\n` +
      `export function go() { fakelib.is24HourClock(); fakelib.getDisplayCountry('US'); }\n`,
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const { findings } = scanProjectMembers({ projectRoot: root, map });
    const res = rewriteProject(root, findings, { write: true });
    assert.equal(res.skippedManual, 0);
    const out = readFileSync(join(root, "p.ts"), "utf8");
    assert.ok(out.includes("fakelib.System.is24HourClock();"), "is24HourClock -> System.is24HourClock");
    assert.ok(out.includes("fakelib.System.getDisplayCountry('US');"), "getDisplayCountry -> System.getDisplayCountry");
    assert.ok(!out.includes("fakelib.is24HourClock("), "old call site gone");
    assert.ok(!out.includes("import * as"), "no injected namespace import");
    assert.ok(out.includes("import { fakelib } from '@ohos.fakelib';"), "old binding retained");
  } finally { cleanup(sdk); cleanup(root); }
});

test("indexer: container drop-in member flagged memberPreservedByMove only when preserved", () => {
  const sdk = dropinMovedSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const get = (leaf: string) => map.entries.find(
      (x) => x.dep.kit === "@ohos.fileio" && x.dep.exportName === "Stat" && x.dep.members?.[0] === leaf,
    );
    assert.equal(get("nlink")?.memberPreservedByMove, true, "Stat.nlink preserved in new kit -> flagged");
    assert.notEqual(get("dev")?.memberPreservedByMove, true, "Stat.dev dropped from new kit -> NOT flagged");
  } finally { cleanup(sdk); }
});

test("scan + rewrite: preserved instance member suppressed, removed one still reported (drop-in)", () => {
  const sdk = dropinMovedSdk();
  const root = makeTree({
    "p.ts":
      `import { Stat } from '@ohos.fileio';\n` +
      `let s: Stat = {} as Stat;\n` +
      `s.nlink;\n` +   // preserved -> suppressed (drop-in re-points `import {Stat}`)
      `s.dev;\n`,      // removed -> manual finding
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const { findings } = scanProjectInstanceMembers({ projectRoot: root, map });
    assert.ok(!bySymbol(findings as any, "s.nlink"), "s.nlink preserved -> no instance finding");
    const dev = bySymbol(findings as any, "s.dev");
    assert.equal(dev?.rule, "manual");
    assert.equal(dev?.needsManual, true);
  } finally { cleanup(sdk); cleanup(root); }
});

/**
 * Round 16 — an interface whose enclosing kit was relocated wholesale
 * (`@ohos.fakelib` -> `@ohos.fakelib.manager`), where each instance property's
 * @useinstead RESTATES the (unchanged) container type in the replacement chain
 * (`Stuff.isVisible` -> `[Stuff, exported]`). `verifyInstanceSafe` checks the
 * OLD kit's interface for the new leaf and fails (the new leaf lives in the NEW
 * kit's container, in a different file); `verifyInstanceSafeOnKitMove` verifies
 * the new leaf against the new kit's container and sets `instanceSafe`, so the
 * instance scanner splices a renamed leaf (`isVisible` -> `exported`) and
 * suppresses a preserved one (`oldProp`, a leaf-equal no-op). A property whose
 * new leaf is NOT in the new container (`goneProp`, removed) stays manual.
 *
 * Mirrors the real `@ohos.bundle` -> `@ohos.bundle.bundleManager` migration:
 * `AbilityInfo.isVisible` -> `[AbilityInfo, exported]` (verified member of the
 * new `AbilityInfo`), `AbilityInfo.bundleName` -> `[AbilityInfo, bundleName]`
 * (leaf preserved, verified present).
 */
function kitmoveInstanceSdk(): string {
  return makeTree({
    // Old kit: the namespace is deprecated as a whole-kit move to
    // `@ohos.fakelib.manager`; its `Stuff` interface's properties each have a
    // @useinstead that restates `Stuff` and names the new leaf.
    "@ohos.fakelib.d.ts": `
/** @since 9 @deprecated since 10 @useinstead ohos.fakelib.manager */
declare namespace fakelib {
    export interface Stuff {
        /** @since 9 @deprecated since 10 @useinstead ohos.fakelib.manager.Stuff.exported */
        isVisible: boolean;
        /** @since 9 @deprecated since 10 @useinstead ohos.fakelib.manager.Stuff.oldProp */
        oldProp: string;
        /** @since 9 @deprecated since 10 @useinstead ohos.fakelib.manager.Stuff.goneProp */
        goneProp: number;
    }
}
`,
    // New kit: `Stuff` survives WITH `exported` (renamed from `isVisible`) and
    // `oldProp` (preserved), but WITHOUT `goneProp` (removed).
    "@ohos.fakelib.manager.d.ts": `
declare namespace manager {
    export interface Stuff {
        exported: boolean;
        oldProp: string;
    }
}
`,
  });
}

test("indexer: kit-move instance rename flagged instanceSafe only when new leaf is in the new container", () => {
  const sdk = kitmoveInstanceSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    // `Stuff` is nested in `declare namespace fakelib`, so each member entry is
    // 2-seg: exportName="fakelib" (the namespace), members=["Stuff", <leaf>].
    const get = (leaf: string) => map.entries.find(
      (x) => x.dep.kit === "@ohos.fakelib" && x.dep.exportName === "fakelib" &&
        x.dep.members?.[0] === "Stuff" && x.dep.members?.[1] === leaf,
    );
    // RENAMED leaf (isVisible -> exported): new leaf is a member of the new
    // Stuff -> instanceSafe (instance scanner splices ai.isVisible -> ai.exported).
    assert.equal(get("isVisible")?.instanceSafe, true, "isVisible -> exported (verified in new Stuff) -> instanceSafe");
    assert.deepEqual(get("isVisible")?.repl?.members, ["Stuff", "exported"]);
    // PRESERVED leaf (oldProp -> oldProp): the new leaf equals the old leaf and
    // IS in the new Stuff -> instanceSafe (instance scanner suppresses the no-op).
    assert.equal(get("oldProp")?.instanceSafe, true, "oldProp preserved (verified in new Stuff) -> instanceSafe");
    // REMOVED leaf (goneProp -> goneProp): the new leaf is NOT in the new Stuff
    // -> NOT flagged (stays manual; the re-pointed binding would reference a
    // member the new container no longer declares).
    assert.notEqual(get("goneProp")?.instanceSafe, true, "goneProp removed from new Stuff -> NOT instanceSafe");
  } finally { cleanup(sdk); }
});

test("scan + rewrite: kit-move instance rename spliced, preserved suppressed, removed manual", () => {
  const sdk = kitmoveInstanceSdk();
  const root = makeTree({
    "p.ts":
      `import { Stuff } from '@ohos.fakelib';\n` +
      `let ai: Stuff = {} as Stuff;\n` +
      `ai.isVisible;\n` +   // renamed -> auto splice ai.isVisible -> ai.exported
      `ai.oldProp;\n` +     // preserved (leaf-equal) -> suppressed, no finding
      `ai.goneProp;\n`,      // removed -> manual finding
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const { findings } = scanProjectInstanceMembers({ projectRoot: root, map });
    // Renamed leaf: auto rename-member splice.
    const vis = bySymbol(findings as any, "ai.isVisible");
    assert.equal(vis?.rule, "rename-member");
    assert.equal(vis?.needsManual, false);
    assert.equal(vis?.replacement, "ai.exported");
    // Preserved leaf: no instance finding (suppress).
    assert.ok(!bySymbol(findings as any, "ai.oldProp"), "ai.oldProp preserved -> no finding");
    // Removed leaf: manual finding.
    const gone = bySymbol(findings as any, "ai.goneProp");
    assert.equal(gone?.rule, "manual");
    assert.equal(gone?.needsManual, true);
    // Rewrite: the renamed access site is spliced (instance scanner's job).
    // The kit-move import re-point is the binding scanner's job (tested
    // separately), so it is not asserted here. goneProp is skipped (manual).
    const res = rewriteProject(root, findings, { write: true });
    assert.equal(res.skippedManual, 1);
    const out = readFileSync(join(root, "p.ts"), "utf8");
    assert.ok(out.includes("ai.exported;"), "ai.isVisible -> ai.exported spliced");
    assert.ok(!out.includes("ai.isVisible;"), "old call site gone");
    assert.ok(out.includes("ai.goneProp;"), "manual goneProp left untouched");
    assert.ok(out.includes("ai.oldProp;"), "preserved oldProp left untouched (no-op)");
  } finally { cleanup(sdk); cleanup(root); }
});

/**
 * Round 17 — the body of the new kit's container lives in a NESTED file that
 * re-export attribution assigns to a DIFFERENT kit (first-writer-wins: the
 * `launcher` kit has a namespace import of the body, so `kitToSourceFiles[manager]`
 * lacks it). The `manager` kit re-exports the container via a NAMED-import type
 * alias: `import { Stuff as _Stuff } from './manager/Stuff'; export type Stuff = _Stuff;`.
 * Without alias-following, `containerHasMemberInKit(manager, "Stuff", leaf)` searches
 * only `manager.d.ts`, finds a TypeAlias (not an interface body) -> false -> manual.
 * `addTypeAliasReExportedFiles` follows the `export type Stuff = _Stuff` alias to the
 * body file (resolving the named import's module specifier and local binding), adds
 * it to `kitToSourceFiles[manager]`, so `verifyInstanceSafeOnKitMove` now verifies
 * the new leaf against the real interface body and sets `instanceSafe`. Mirrors the
 * real `@ohos.bundle.bundleManager` -> `export type ApplicationInfo = _ApplicationInfo`
 * case where `bundleManager/ApplicationInfo.d.ts` is attributed to
 * `@ohos.bundle.launcherBundleManager`.
 */
function kitmoveAliasReExportSdk(): string {
  return makeTree({
    // Old kit: whole-kit move to `@ohos.fakelib.manager`; each `Stuff` instance
    // property's @useinstead restates `Stuff` and names the new leaf.
    "@ohos.fakelib.d.ts": `
/** @since 9 @deprecated since 10 @useinstead ohos.fakelib.manager */
declare namespace fakelib {
    export interface Stuff {
        /** @since 9 @deprecated since 10 @useinstead ohos.fakelib.manager.Stuff.exported */
        isVisible: boolean;
        /** @since 9 @deprecated since 10 @useinstead ohos.fakelib.manager.Stuff.oldProp */
        oldProp: string;
        /** @since 9 @deprecated since 10 @useinstead ohos.fakelib.manager.Stuff.goneProp */
        goneProp: number;
    }
}
`,
    // Launcher kit: NAMESPACE import of the body -> first-writer-wins attributes
    // the body file to THIS kit, so `manager` does not directly own the body.
    "@ohos.fakelib.launcher.d.ts": `
import * as _Stuff from './manager/Stuff';
declare namespace launcher { export type Stuff = _Stuff.Stuff; }
`,
    // New kit: re-exports `Stuff` via a NAMED-import type alias. The interface
    // body is NOT in this file (only the alias), so `manager`'s attributed
    // SourceFile set cannot resolve members without alias-following.
    "@ohos.fakelib.manager.d.ts": `
import { Stuff as _Stuff } from './manager/Stuff';
declare namespace manager { export type Stuff = _Stuff; }
`,
    // The body: declared `export interface Stuff` (a nested file attributed to
    // `launcher` via the namespace import above). `exported` is the renamed
    // successor of `isVisible`; `oldProp` survives; `goneProp` is removed.
    "manager/Stuff.d.ts": `
export interface Stuff {
    exported: boolean;
    oldProp: string;
}
`,
  });
}

test("indexer: type-alias-re-exported container body followed so kit-move instance leaf verified", () => {
  const sdk = kitmoveAliasReExportSdk();
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const get = (leaf: string) => map.entries.find(
      (x) => x.dep.kit === "@ohos.fakelib" && x.dep.exportName === "fakelib" &&
        x.dep.members?.[0] === "Stuff" && x.dep.members?.[1] === leaf,
    );
    // RENAMED leaf (isVisible -> exported): the body file (attributed to
    // `launcher`, re-exported by `manager` via `export type Stuff = _Stuff`) is
    // only reachable through alias-following; once added, `exported` is verified
    // a member of the new Stuff -> instanceSafe.
    assert.equal(get("isVisible")?.instanceSafe, true,
      "isVisible -> exported verified via alias-followed body -> instanceSafe");
    assert.deepEqual(get("isVisible")?.repl?.members, ["Stuff", "exported"]);
    // PRESERVED leaf (oldProp): verified present in the alias-followed body ->
    // instanceSafe (instance scanner suppresses the leaf-equal no-op).
    assert.equal(get("oldProp")?.instanceSafe, true,
      "oldProp preserved (verified via alias-followed body) -> instanceSafe");
    // REMOVED leaf (goneProp): NOT in the body -> NOT flagged (stays manual).
    assert.notEqual(get("goneProp")?.instanceSafe, true,
      "goneProp removed from body -> NOT instanceSafe");
  } finally { cleanup(sdk); }
});

test("scan + rewrite: alias-re-exported kit-move instance rename spliced, preserved suppressed", () => {
  const sdk = kitmoveAliasReExportSdk();
  const root = makeTree({
    "p.ts":
      `import { Stuff } from '@ohos.fakelib';\n` +
      `let ai: Stuff = {} as Stuff;\n` +
      `ai.isVisible;\n` +   // renamed -> auto splice ai.isVisible -> ai.exported
      `ai.oldProp;\n` +     // preserved (leaf-equal) -> suppressed, no finding
      `ai.goneProp;\n`,      // removed -> manual finding
  });
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const { findings } = scanProjectInstanceMembers({ projectRoot: root, map });
    const vis = bySymbol(findings as any, "ai.isVisible");
    assert.equal(vis?.rule, "rename-member");
    assert.equal(vis?.needsManual, false);
    assert.equal(vis?.replacement, "ai.exported");
    assert.ok(!bySymbol(findings as any, "ai.oldProp"), "ai.oldProp preserved -> no finding");
    const gone = bySymbol(findings as any, "ai.goneProp");
    assert.equal(gone?.rule, "manual");
    assert.equal(gone?.needsManual, true);
    const res = rewriteProject(root, findings, { write: true });
    assert.equal(res.skippedManual, 1);
    const out = readFileSync(join(root, "p.ts"), "utf8");
    assert.ok(out.includes("ai.exported;"), "ai.isVisible -> ai.exported spliced");
    assert.ok(!out.includes("ai.isVisible;"), "old call site gone");
    assert.ok(out.includes("ai.goneProp;"), "manual goneProp left untouched");
    assert.ok(out.includes("ai.oldProp;"), "preserved oldProp left untouched (no-op)");
  } finally { cleanup(sdk); cleanup(root); }
});

