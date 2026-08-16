/**
 * Tests for `selectResiduals` — the policy that decides which findings reach
 * the AI model. Auto-fixable findings are spliced deterministically (excluded);
 * `humanOnly` manuals need a human-chosen argument the model can't supply and
 * stay on the deprecated-but-compiling API for review (excluded); everything
 * else (ordinary manuals with no replacement) is the AI's job (kept).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { selectResiduals } from "./replace.js";
import type { Finding } from "../rules/types.js";

/** Minimal Finding factory; tests override the discriminator fields. */
function mk(partial: Partial<Finding>): Finding {
  return {
    file: "a.ts",
    line: 1,
    oldSymbol: "x",
    newSymbol: "y",
    since: 9,
    rule: "manual",
    needsManual: true,
    note: "",
    ...partial,
  } as Finding;
}

test("selectResiduals excludes auto-fixable findings (spliced deterministically, not the AI's job)", () => {
  const auto = mk({
    rule: "rename-member",
    needsManual: false,
    replacement: "x.y",
    matchStart: 0,
    matchEnd: 1,
  });
  assert.equal(selectResiduals([auto]).length, 0);
});

test("selectResiduals keeps an ordinary manual finding (no replacement) for the AI", () => {
  const m = mk({ rule: "manual", needsManual: true }); // no replacement, no humanOnly
  const res = selectResiduals([m]);
  assert.equal(res.length, 1);
  assert.equal(res[0].rule, "manual");
});

test("selectResiduals excludes humanOnly findings (need a human, not the model)", () => {
  // A signature-change manual the AI can only guess at — it must NOT be sent,
  // else a wrong guess or a file-level revert takes down unrelated AI edits.
  const h = mk({ rule: "manual", needsManual: true, humanOnly: true });
  assert.equal(selectResiduals([h]).length, 0);
});

test("selectResiduals on a mixed bag keeps only the non-humanOnly manuals", () => {
  const auto = mk({
    rule: "rename-member", needsManual: false, replacement: "x.y", matchStart: 0, matchEnd: 1,
  });
  const manual = mk({ rule: "manual", needsManual: true });
  const humanOnly = mk({ rule: "manual", needsManual: true, humanOnly: true });
  const res = selectResiduals([auto, manual, humanOnly]);
  assert.equal(res.length, 1);
  assert.equal(res[0], manual);
});

test("selectResiduals with no findings yields []", () => {
  assert.deepEqual(selectResiduals([]), []);
});
