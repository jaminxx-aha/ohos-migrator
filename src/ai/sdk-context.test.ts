/**
 * Tests for the AI prompt context builder (`sdk-context.ts`).
 *
 * Hermetic: writes a fake SDK `.d.ts` tree and a fake project file to a temp
 * dir, so it runs without a real HarmonyOS SDK.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { kitFile, extractDeclSlice, buildFileContext, summarizeTypeRef } from "./sdk-context.js";
import type { Finding, DeprecationMap } from "../rules/types.js";

const SDK_DTS = `declare namespace router {
  /**
   * @deprecated since 9
   * @useinstead ohos.router.router#pushUrl
   */
  function push(options: RouterOptions): void;
  /**
   * @deprecated since 18
   * @useinstead ohos.arkui.UIContext.Router#pushUrl
   */
  function pushUrl(options: RouterOptions, callback: AsyncCallback<void>): void;
  function replace(options: RouterOptions): void;
}
export default router;
`;

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ohos-ai-ctx-"));
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

function makeMap(sdkPath: string, kitExports?: Record<string, string[]>): DeprecationMap {
  return {
    apiVersion: 1,
    sdkPath,
    generatedAt: "",
    entries: [],
    kitIndex: {},
    kitExports: kitExports,
  } as DeprecationMap;
}

function finding(over: Partial<Finding>): Finding {
  return {
    file: "src/a.ts", line: 2, oldSymbol: "", newSymbol: null, since: 0,
    rule: "rename-member", needsManual: false, note: "", ...over,
  } as Finding;
}

test("kitFile resolves a kit to its .d.ts path", () => {
  const p = kitFile("/sdk/ets/api", "@ohos.router");
  assert.equal(p, join("/sdk/ets/api", "@ohos.router.d.ts"));
});

test("extractDeclSlice returns the member declaration + preceding JSDoc", () => {
  const root = makeTree({ "@ohos.router.d.ts": SDK_DTS });
  try {
    const slice = extractDeclSlice(join(root, "@ohos.router.d.ts"), "push", "router");
    assert.ok(slice.includes("function push"));
    assert.ok(slice.includes("@deprecated since 9"));
    assert.ok(!slice.includes("function pushUrl"), "must not bleed into the next member");
  } finally {
    cleanup(root);
  }
});

test("extractDeclSlice returns '' for a missing member", () => {
  const root = makeTree({ "@ohos.router.d.ts": SDK_DTS });
  try {
    assert.equal(extractDeclSlice(join(root, "@ohos.router.d.ts"), "nope", "router"), "");
  } finally {
    cleanup(root);
  }
});

test("extractDeclSlice returns '' for a missing file", () => {
  assert.equal(extractDeclSlice("/no/such/file.d.ts", "push"), "");
});

test("buildFileContext dedups SDK slices across findings (same kit+member once)", () => {
  const root = makeTree({
    "@ohos.router.d.ts": SDK_DTS,
    "src/a.ts": "import router from '@ohos.router'\nrouter.push({ url: '' })\nrouter.push({ url: '' })\n",
  });
  try {
    const map = makeMap(root, { "@ohos.router": ["push", "pushUrl", "replace"] });
    // Two findings with the same deprecated + replacement targets.
    const fs = [
      finding({ line: 2, oldSymbol: "router.push", newSymbol: "router.pushUrl" }),
      finding({ line: 3, oldSymbol: "router.push", newSymbol: "router.pushUrl" }),
    ];
    const ctx = buildFileContext(root, "src/a.ts", fs, map);
    assert.ok(ctx.fileContent.includes("router.push"));
    assert.equal(ctx.findingBriefs.length, 2);
    // deprecated(push) + replacement(pushUrl) = 2 distinct slices (deduped from 4 targets).
    assert.equal(ctx.sdkSlices.length, 2);
    assert.ok(ctx.sdkSlices.some((s) => s.includes("deprecated")));
    assert.ok(ctx.sdkSlices.some((s) => s.includes("replacement")));
  } finally {
    cleanup(root);
  }
});

test("buildFileContext resolves a cross-kit replacement target from newSymbol", () => {
  const root = makeTree({
    "@ohos.router.d.ts": SDK_DTS,
    "@ohos.backgroundTaskManager.d.ts":
      "declare function startBackgroundRunning(ctx: Context, m: BackgroundMode): void;\n",
    "src/a.ts": "import pa from '@ohos.ability.particleAbility'\npa.startBackgroundRunning(1, {})\n",
  });
  try {
    const map = makeMap(root, {
      "@ohos.ability.particleAbility": ["startBackgroundRunning"],
      "@ohos.backgroundTaskManager": ["startBackgroundRunning"],
    });
    const fs = [
      finding({
        rule: "manual", line: 2, oldSymbol: "pa.startBackgroundRunning",
        newSymbol: "@ohos.backgroundTaskManager/startBackgroundRunning",
        note: "cross-kit replacement -> @ohos.backgroundTaskManager (requires wiring changes)",
      }),
    ];
    const ctx = buildFileContext(root, "src/a.ts", fs, map);
    // deprecated side: @ohos.ability.particleAbility.startBackgroundRunning (not on disk -> no slice)
    // replacement side: @ohos.backgroundTaskManager/startBackgroundRunning -> slice
    assert.ok(ctx.sdkSlices.some((s) => s.includes("startBackgroundRunning") && s.includes("replacement")));
  } finally {
    cleanup(root);
  }
});

const OVERLOAD_DTS = `declare namespace atManager {
  /**
   * @since 9
   */
  verifyAccessToken(tokenID: number, permissionName: Permissions): Promise<GrantStatus>;
  /**
   * @since 8
   * @deprecated since 9
   * @useinstead ohos.abilityAccessCtrl.AtManager#checkAccessToken
   */
  verifyAccessToken(tokenID: number, permissionName: string): Promise<GrantStatus>;
  /**
   * @since 9
   */
  checkAccessToken(tokenID: number, permissionName: Permissions): Promise<GrantStatus>;
}
export default atManager;
`;

test("extractDeclSlice collects EVERY overload of a member (not just the first)", () => {
  // A tightened signature is visible only by comparing overloads: verifyAccessToken
  // has a Permissions overload AND a deprecated string overload. Taking only the
  // first would hide the deprecated overload the call site actually resolves to.
  const root = makeTree({ "@ohos.abilityAccessCtrl.d.ts": OVERLOAD_DTS });
  try {
    const slice = extractDeclSlice(join(root, "@ohos.abilityAccessCtrl.d.ts"), "verifyAccessToken", "atManager");
    assert.ok(slice.includes("permissionName: Permissions"), "Permissions overload present");
    assert.ok(slice.includes("permissionName: string"), "deprecated string overload present (not lost)");
    assert.ok(slice.includes("@deprecated since 9"), "deprecated JSDoc present");
    assert.ok(slice.includes("@useinstead"), "useinstead marker present");
    // must not bleed into a different member's signature. The @useinstead
    // marker naming checkAccessToken IS expected in the deprecated overload's
    // JSDoc — only checkAccessToken's own signature line would be a bleed.
    assert.ok(!slice.includes("checkAccessToken(tokenID"), "must not bleed into checkAccessToken's signature");
  } finally {
    cleanup(root);
  }
});

test("summarizeTypeRef classifies a literal-union type as restricted (no bare string)", () => {
  const root = makeTree({
    "@ohos.abilityAccessCtrl.d.ts":
      "import { Permissions } from './permissions';\n" +
      "declare namespace atManager { verifyAccessToken(t: number, p: Permissions): void; }\n",
    "permissions.d.ts":
      "export type Permissions =\n  | 'ohos.permission.A'\n  | 'ohos.permission.B'\n  | 'ohos.permission.C';\n",
  });
  try {
    const s = summarizeTypeRef(join(root, "@ohos.abilityAccessCtrl.d.ts"), "Permissions");
    assert.ok(s.includes("literal union"), "classified as literal union");
    assert.ok(s.includes("3 literals"), "counted 3 literals");
    assert.ok(s.includes("no bare string"), "flagged no bare string");
    assert.ok(s.includes("restricted"), "flagged restricted");
  } finally {
    cleanup(root);
  }
});

test("summarizeTypeRef classifies a bare-string alias as loose", () => {
  const root = makeTree({
    "@ohos.abilityAccessCtrl.d.ts":
      "import { Loose } from './loose';\n" +
      "declare namespace atManager { verifyAccessToken(t: number, p: Loose): void; }\n",
    "loose.d.ts":
      "export type Loose = string;\n",
  });
  try {
    const s = summarizeTypeRef(join(root, "@ohos.abilityAccessCtrl.d.ts"), "Loose");
    assert.ok(s.includes("contains string"), "flagged contains string");
    assert.ok(s.includes("loose"), "flagged loose");
  } finally {
    cleanup(root);
  }
});

test("summarizeTypeRef returns '' for a built-in type and an unresolvable import", () => {
  const root = makeTree({ "@ohos.x.d.ts": "declare const f: (n: number) => void;\n" });
  try {
    assert.equal(summarizeTypeRef(join(root, "@ohos.x.d.ts"), "number"), "");
    assert.equal(summarizeTypeRef(join(root, "@ohos.x.d.ts"), "Unresolvable"), "");
  } finally {
    cleanup(root);
  }
});
