/**
 * Tests for `applyTargetedEdits` — the deterministic targeted-edit applier.
 *
 * Only edits whose `oldText` matches exactly once are applied; 0 or >1
 * matches are skipped. Applied edits are de-overlapped (longest wins) and
 * spliced bottom-up. This is the safety guarantee that the AI never gets a
 * "rewrite whatever" whole-file overwrite.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTargetedEdits, type AiEdit } from "./apply-edits.js";

test("applies a unique single edit", () => {
  const r = applyTargetedEdits("router.push({ url: '' });", [
    { oldText: "router.push({ url: '' });", newText: "router.pushUrl({ url: '' });" },
  ]);
  assert.equal(r.applied, 1);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.content, "router.pushUrl({ url: '' });");
});

test("skips an edit whose oldText is not found", () => {
  const r = applyTargetedEdits("router.pushUrl(x);", [
    { oldText: "router.push(", newText: "router.pushUrl(" },
  ]);
  assert.equal(r.applied, 0);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].reason, "notFound");
});

test("skips an edit whose oldText is ambiguous (>1 match)", () => {
  const r = applyTargetedEdits("a(); a();", [{ oldText: "a();", newText: "b();" }]);
  assert.equal(r.applied, 0);
  assert.equal(r.skipped[0].reason, "ambiguous");
  assert.equal(r.skipped[0].occurrences, 2);
});

test("applies multiple non-overlapping edits bottom-up (offsets stay valid)", () => {
  const content = "router.push(x);\nrouter.replace(y);\n";
  const r = applyTargetedEdits(content, [
    { oldText: "router.push(x);", newText: "router.pushUrl(x);" },
    { oldText: "router.replace(y);", newText: "router.replace(y);" }, // no-op swap
  ]);
  assert.equal(r.applied, 2);
  assert.equal(r.content, "router.pushUrl(x);\nrouter.replace(y);\n");
});

test("de-overlaps nested edits (longest/most-specific wins)", () => {
  // inner edit's oldText occurs once (inside the outer edit's oldText).
  const content = "router.push(x);";
  const r = applyTargetedEdits(content, [
    { oldText: "router.push(x);", newText: "router.pushUrl(x);" }, // longer span
    { oldText: "push", newText: "pushUrl" }, // nested inside the above
  ]);
  // The nested "push" appears once (inside the outer edit). After de-overlap,
  // the longer edit wins and the nested one is dropped.
  assert.equal(r.applied, 1);
  assert.equal(r.content, "router.pushUrl(x);");
});

test("empty edits list is a no-op", () => {
  const r = applyTargetedEdits("unchanged", []);
  assert.equal(r.applied, 0);
  assert.equal(r.content, "unchanged");
});
