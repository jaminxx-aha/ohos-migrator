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
 *    manual family (no @useinstead, cross-kit non-override, no-op rename,
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
import { scanProject, scanProjectExportRenames } from "./scanner/scanner.js";
import { scanProjectMembers } from "./scanner/member-scanner.js";
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
): DeprecationMap {
  return { apiVersion: 12, sdkPath: "", generatedAt: "", entries, kitIndex, exportIndex };
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
same.foo();                         // no-op rename (leaf == old) -> manual
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

test("scan: no-op rename (same leaf) is manual, no splice", () => {
  const root = memberProject();
  try {
    const { findings } = scanProjectMembers({ projectRoot: root, map: memberMap() });
    const f = bySymbol(findings, "same.foo");
    assert.equal(f?.rule, "manual");
    assert.equal(f?.replacement, undefined);
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

/* module-level */

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
    assert.ok(res.skippedManual >= 5, "manuals counted as skipped");
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
