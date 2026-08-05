import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { scanProjectInstanceMembersTsc } from "./tsc-instance-scanner.js";
import type { DeprecationMap, DeprecationEntry, ReplSymbol } from "../rules/types.js";

/** Write a temp directory tree from a {relPath: content} map. */
function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ohos-tsc-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

function rm(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** An instance-method entry whose deprecated shape is `kit/exportName.leaf`. */
function instEntry(
  kit: string,
  exportName: string,
  leaf: string,
  repl: ReplSymbol | null,
  opts: { instanceSafe?: boolean; since?: number } = {},
): DeprecationEntry {
  return {
    dep: { kit, exportName, members: [leaf] },
    since: opts.since ?? 10,
    repl,
    kind: "member",
    source: { file: "", line: 0 },
    ...(opts.instanceSafe ? { instanceSafe: true } : {}),
  };
}

/** SDK fixture file -> kit, mirroring the indexer's file→kit attribution. */
const FILE_KIT: Record<string, string> = {
  "@ohos.resourceManager.d.ts": "@ohos.resourceManager",
  "@ohos.ability.featureAbility.d.ts": "@ohos.ability.featureAbility",
  "@ohos.window.d.ts": "@ohos.window",
};

/** Build a map carrying the file→kit attribution the tsc scanner needs. */
function mkMap(sdk: string, entries: DeprecationEntry[]): DeprecationMap {
  return {
    apiVersion: 24,
    sdkPath: sdk,
    generatedAt: "",
    entries,
    kitIndex: {},
    fileKit: FILE_KIT,
  };
}

const SDK: Record<string, string> = {
  "@ohos.resourceManager.d.ts": `
declare namespace resourceManager {
  export interface ResourceManager {
    getString(resId: number): string;
    getStringValue(resId: number): string;
  }
  export function getResourceManager(): ResourceManager;
}
export default resourceManager;`,
  "@ohos.ability.featureAbility.d.ts": `
declare namespace featureAbility {
  export interface Context {
    setShowOnLockScreen(visible: boolean): void;
  }
  export function getContext(): Context;
}
export default featureAbility;`,
  "@ohos.window.d.ts": `
declare namespace window {
  export interface Window {
    setWakeUpScreen(visible: boolean): void;
    setScreenBrightness(b: number): void;
  }
  export function getLastWindow(): Promise<Window>;
}
export default window;`,
};

test("tsc instance scanner: untyped sync factory -> instanceSafe auto rename", () => {
  const sdk = makeTree(SDK);
  const proj = makeTree({
    "src/logic.ts": `
import resourceManager from '@ohos.resourceManager';
function f() {
  const rm = resourceManager.getResourceManager(); // untyped local
  rm.getString(1);
}
`,
  });
  try {
    const map = mkMap(sdk, [
        instEntry("@ohos.resourceManager", "ResourceManager", "getString",
          { kit: "@ohos.resourceManager", members: ["getStringValue"] },
          { instanceSafe: true }),
      ]);
    const r = scanProjectInstanceMembersTsc({ projectRoot: proj, map });
    assert.equal(r.ran, true);
    const f = r.findings.find((x) => x.oldSymbol === "rm.getString");
    assert.ok(f, "expected a finding for rm.getString");
    assert.equal(f!.rule, "rename-member");
    assert.equal(f!.replacement, "rm.getStringValue");
  } finally {
    rm(sdk);
    rm(proj);
  }
});

test("tsc instance scanner: awaited Promise factory unwraps receiver type", () => {
  const sdk = makeTree(SDK);
  const proj = makeTree({
    "src/logic.ts": `
import window from '@ohos.window';
async function f() {
  const win = await window.getLastWindow(); // Promise<Window> unwrapped
  win.setWakeUpScreen(true);
}
`,
  });
  try {
    const map = mkMap(sdk, [
        instEntry("@ohos.window", "Window", "setWakeUpScreen",
          { kit: "@ohos.window", members: ["setScreenBrightness"] },
          { instanceSafe: true }),
      ]);
    const r = scanProjectInstanceMembersTsc({ projectRoot: proj, map });
    const f = r.findings.find((x) => x.oldSymbol === "win.setWakeUpScreen");
    assert.ok(f, "expected a finding for win.setWakeUpScreen (Promise-unwrapped)");
    assert.equal(f!.rule, "rename-member");
    assert.equal(f!.replacement, "win.setScreenBrightness");
  } finally {
    rm(sdk);
    rm(proj);
  }
});

test("tsc instance scanner: cross-kit FA->stageless receiver detected as manual", () => {
  const sdk = makeTree(SDK);
  const proj = makeTree({
    "src/logic.ts": `
import featureAbility from '@ohos.ability.featureAbility';
function f() {
  const ctx = featureAbility.getContext();
  ctx.setShowOnLockScreen(true);
}
`,
  });
  try {
    const map = mkMap(sdk, [
        instEntry("@ohos.ability.featureAbility", "Context", "setShowOnLockScreen",
          { kit: "@ohos.window", members: ["WindowStage", "setShowOnLockScreen"] }),
      ]);
    const r = scanProjectInstanceMembersTsc({ projectRoot: proj, map });
    const f = r.findings.find((x) => x.oldSymbol === "ctx.setShowOnLockScreen");
    assert.ok(f, "expected a (manual) finding — not a silent miss");
    assert.equal(f!.rule, "manual");
    assert.ok(f!.newSymbol!.includes("@ohos.window"));
    assert.ok(f!.note.includes("wiring"));
  } finally {
    rm(sdk);
    rm(proj);
  }
});

test("tsc instance scanner: no false positive on non-deprecated member", () => {
  const sdk = makeTree(SDK);
  const proj = makeTree({
    "src/logic.ts": `
import resourceManager from '@ohos.resourceManager';
function f() {
  const rm = resourceManager.getResourceManager();
  rm.getStringValue(1); // already the new name — no deprecated entry for it
}
`,
  });
  try {
    const map = mkMap(sdk, [
        instEntry("@ohos.resourceManager", "ResourceManager", "getString",
          { kit: "@ohos.resourceManager", members: ["getStringValue"] },
          { instanceSafe: true }),
      ]);
    const r = scanProjectInstanceMembersTsc({ projectRoot: proj, map });
    assert.equal(r.findings.length, 0, "getStringValue is not deprecated — no finding");
  } finally {
    rm(sdk);
    rm(proj);
  }
});

test("tsc instance scanner: gracefully degrades when SDK is absent", () => {
  const proj = makeTree({
    "src/logic.ts": `import x from '@ohos.x'; const y = x.foo(); y.bar();`,
  });
  try {
    const map: DeprecationMap = {
      apiVersion: 24,
      sdkPath: "/nonexistent/sdk/path",
      generatedAt: "",
      entries: [],
      kitIndex: {},
    };
    const r = scanProjectInstanceMembersTsc({ projectRoot: proj, map });
    assert.equal(r.ran, false);
    assert.equal(r.findings.length, 0);
  } finally {
    rm(proj);
  }
});

test("tsc instance scanner: skips .ets (unparseable struct) without crashing", () => {
  const sdk = makeTree(SDK);
  const proj = makeTree({
    "src/page.ets": `
import resourceManager from '@ohos.resourceManager';
@Component
struct Page {
  build() {
    const rm = resourceManager.getResourceManager();
    rm.getString(1);
  }
}`,
  });
  try {
    const map = mkMap(sdk, [
        instEntry("@ohos.resourceManager", "ResourceManager", "getString",
          { kit: "@ohos.resourceManager", members: ["getStringValue"] },
          { instanceSafe: true }),
      ]);
    // .ets has no .ts files -> pass doesn't run; regex scanner remains source
    // of truth. Must not throw.
    const r = scanProjectInstanceMembersTsc({ projectRoot: proj, map });
    assert.equal(r.ran, false);
  } finally {
    rm(sdk);
    rm(proj);
  }
});
