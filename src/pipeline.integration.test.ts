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
  // (repl.members = ["on","event:BLEDeviceFind"]). Splicing that would emit
  // invalid code, so the identifier guard must leave the entry unflagged (manual).
  const sdk = makeTree(SDK_FILES);
  try {
    const map = buildDeprecationMap({ sdkApiDir: sdk, apiVersion: 12, generatedAt: "" });
    const e = map.entries.find(
      (x) => x.dep.kit === "@ohos.bluetoothManager" && x.dep.members?.[0] === "BLE",
    );
    assert.ok(e, "bluetoothManager.BLE.on entry exists");
    assert.notEqual(e!.crossKitMemberDropin, true, "artifact chain must NOT be flagged");
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
