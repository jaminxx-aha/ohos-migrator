/**
 * Tests for the hvigor verification layer (`runHvigor` + `parseErrorLines`).
 *
 * The real `hvigorw` compile is exercised only end-to-end on a HarmonyOS
 * corpus; here we unit-test the pure pieces (error-line parser, SDK path
 * derivation) and the degrade path (`runHvigor` returns `ran:false` on a
 * non-HarmonyOS directory instead of trying to spawn a compiler).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseErrorLines,
  resolveDevEcoSdkHome,
  hvigorwPath,
  nodeHome,
  runHvigor,
} from "./hvigor.js";

test("parseErrorLines collects file -> sorted unique error lines", () => {
  const out = [
    "ERROR: ArkTS:ERROR ...",
    "  <probe>. At File: /abs/entry/src/a.ets:12:5",
    "ERROR: ArkTS:ERROR ...",
    "  <probe>. At File: /abs/entry/src/a.ets:12:9", // same line, dedup
    "  <probe>. At File: /abs/entry/src/b.ets:3:1",
    "ArkTS:WARN File: /abs/entry/src/warn.ets:7:1 should not be matched",
  ].join("\n");
  const m = parseErrorLines(out);
  assert.deepEqual(m.get("/abs/entry/src/a.ets"), [12]);
  assert.deepEqual(m.get("/abs/entry/src/b.ets"), [3]);
  assert.equal(m.has("/abs/entry/src/warn.ets"), false); // WARN line ignored
});

test("parseErrorLines ignores malformed / zero-line markers", () => {
  const out = [
    "At File: /x/y.ets:0:1", // line 0 dropped
    "At File: /empty.ets::1", // no line number
    "noise without a marker",
  ].join("\n");
  const m = parseErrorLines(out);
  assert.equal(m.size, 0);
});

test("hvigorwPath / nodeHome derive from a macOS-style SDK home", () => {
  const sdkHome = "/Applications/DevEco-Studio.app/Contents/sdk";
  assert.equal(hvigorwPath(sdkHome), "/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw");
  assert.equal(nodeHome(sdkHome), "/Applications/DevEco-Studio.app/Contents/tools/node");
});

test("resolveDevEcoSdkHome prefers an existing explicit path", () => {
  const saved = process.env.DEVECO_SDK_HOME;
  delete process.env.DEVECO_SDK_HOME;
  const root = mkdtempSync(join(tmpdir(), "ohos-sdk-"));
  try {
    assert.equal(resolveDevEcoSdkHome(root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (saved !== undefined) process.env.DEVECO_SDK_HOME = saved;
  }
});

test("resolveDevEcoSdkHome never returns a nonexistent explicit path", () => {
  // On a machine with DevEco installed it falls through to the macOS default;
  // on a CI box without it, undefined. Either is correct — just never the
  // bogus explicit path itself.
  const saved = process.env.DEVECO_SDK_HOME;
  delete process.env.DEVECO_SDK_HOME;
  try {
    const bogus = "/definitely/not/here/" + "x".repeat(12);
    assert.notEqual(resolveDevEcoSdkHome(bogus), bogus);
  } finally {
    if (saved !== undefined) process.env.DEVECO_SDK_HOME = saved;
  }
});

test("runHvigor returns ran:false on a non-HarmonyOS directory", () => {
  const root = mkdtempSync(join(tmpdir(), "ohos-hv-"));
  try {
    const r = runHvigor({ projectRoot: root });
    assert.equal(r.ran, false);
    assert.ok(r.reason, "expected a reason string when hvigor cannot run");
    assert.equal(r.errors.size, 0);
    // Reason is either "not a HarmonyOS stage module" (SDK present) or a
    // DEVECO_SDK_HOME-not-found message (SDK absent) — both are valid degrade
    // outcomes; we only require the run be refused cleanly.
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
