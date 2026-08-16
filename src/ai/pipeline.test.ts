/**
 * Tests for the AI batch pipeline (`pipeline.ts`).
 *
 * The full flow (real AI call + real hvigor) is covered by end-to-end runs;
 * here we unit-test the pure helpers and the degrade paths that don't need
 * network or SDK: `groupRawByFile` (hvigor raw → per-file error text) and
 * the `write=false` / empty-residual short-circuits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { groupRawByFile, runAiRewrite } from "./pipeline.js";
import type { DeprecationMap } from "../rules/types.js";

test("groupRawByFile attributes hvigor error text to the right rel file", () => {
  const projectRoot = "/proj";
  const raw = [
    "ERROR: ArkTS:ERROR File: /proj/entry/src/a.ets:42:5",
    "  Type 'string' is not assignable to parameter of type 'number'. At File: /proj/entry/src/a.ets:42:5",
    "ERROR: ArkTS:ERROR File: /proj/entry/src/b.ets:7:1",
    "  cannot find name foo. At File: /proj/entry/src/b.ets:7:1",
  ].join("\n");
  const m = groupRawByFile(raw, projectRoot);
  assert.ok(m.has("entry/src/a.ets"));
  assert.ok(m.has("entry/src/b.ets"));
  assert.match(m.get("entry/src/a.ets")!, /42/);
  assert.match(m.get("entry/src/b.ets")!, /7/);
});

test("groupRawByFile ignores error paths outside the project root", () => {
  const m = groupRawByFile(
    "ERROR: ... At File: /other/x.ets:1:1",
    "/proj",
  );
  assert.equal(m.size, 0);
});

test("runAiRewrite returns an empty result when write=false (AI not invoked)", async () => {
  const root = mkdtempSync(join(tmpdir(), "ohos-ai-pipe-"));
  try {
    const map = { sdkPath: "" } as DeprecationMap;
    const residual = new Map([["src/a.ts", [] as never[]]]);
    const r = await runAiRewrite(root, residual, map, { baseUrl: "x", apiKey: "y", model: "z" }, false);
    assert.equal(r.appliedFiles, 0);
    assert.equal(r.retriedFiles, 0);
    assert.equal(r.stillFailedFiles, 0);
    assert.equal(r.hvigorRan, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runAiRewrite returns empty when there are no residual files", async () => {
  const root = mkdtempSync(join(tmpdir(), "ohos-ai-pipe-"));
  try {
    const map = { sdkPath: "" } as DeprecationMap;
    const r = await runAiRewrite(root, new Map(), map, { baseUrl: "x", apiKey: "y", model: "z" }, true);
    assert.equal(r.appliedFiles, 0);
    assert.equal(r.perFile.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
