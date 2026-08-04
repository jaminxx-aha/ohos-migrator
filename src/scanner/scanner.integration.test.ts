import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "./scanner.js";
import { scanProjectMembers } from "./member-scanner.js";
import { rewriteProject } from "../rewriter/rewriter.js";
import type { DeprecationMap } from "../rules/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// Fixtures live outside src/ (not compiled) — reached from repo root.
const FIXTURES = resolve(__dirname, "..", "..", "test", "fixtures", "mini");

const map: DeprecationMap = {
  apiVersion: 12,
  sdkPath: "",
  generatedAt: "",
  kitIndex: {
    "@ohos.app.ability.dataUriUtils": { since: 12, newKit: "@ohos.ability.dataUriUtils" },
    "@ohos.reminderAgent": { since: 10, manual: true },
  },
  entries: [
    {
      dep: { kit: "@ohos.router", exportName: "router", members: ["pushUrl"] },
      since: 15,
      repl: { members: ["pushPath"] },
      kind: "member",
      source: { file: "", line: 0 },
    },
    {
      dep: { kit: "@ohos.reminderAgent", exportName: "reminder", members: ["publishReminder"] },
      since: 14,
      repl: null,
      kind: "member",
      source: { file: "", line: 0 },
    },
  ],
};

test("scanProject finds module-level deprecations", () => {
  const { findings, filesScanned } = scanProject({ projectRoot: FIXTURES, map });
  assert.ok(filesScanned >= 2);
  const dataUri = findings.find((f) => f.oldSymbol === "@ohos.app.ability.dataUriUtils");
  assert.ok(dataUri, "dataUriUtils module-move finding");
  assert.equal(dataUri.rule, "rewrite-import");
  assert.equal(dataUri.newSymbol, "@ohos.ability.dataUriUtils");
  assert.equal(dataUri.line, 1);

  const reminder = findings.find((f) => f.oldSymbol === "@ohos.reminderAgent");
  assert.ok(reminder, "reminderAgent manual finding");
  assert.equal(reminder.rule, "manual");
  assert.equal(reminder.needsManual, true);
});

test("scanProjectMembers finds member-level deprecations", () => {
  const { findings } = scanProjectMembers({ projectRoot: FIXTURES, map });
  const pushUrl = findings.find((f) => f.oldSymbol === "router.pushUrl");
  assert.ok(pushUrl, "router.pushUrl member finding");
  assert.equal(pushUrl.rule, "rename-member");
  assert.equal(pushUrl.newSymbol, "router.pushPath");
  assert.equal(pushUrl.line, 5);

  const pub = findings.find((f) => f.oldSymbol === "reminder.publishReminder");
  assert.ok(pub, "reminder.publishReminder member finding");
  assert.equal(pub.rule, "manual");
});

test("rewriteProject dry-run rewrites only safe imports", () => {
  const { findings } = scanProject({ projectRoot: FIXTURES, map });
  const result = rewriteProject(FIXTURES, findings, { write: false });
  // Only the dataUriUtils rewrite-import finding is auto-fixable.
  assert.equal(result.changedFiles.length, 1);
  const cf = result.changedFiles[0];
  assert.ok(cf.file.endsWith("page.ets"));
  assert.equal(cf.edits.length, 1);
  assert.equal(cf.edits[0].to, "@ohos.ability.dataUriUtils");
  // The dry-run diff shows the old vs new import line.
  assert.ok(cf.diff.includes("-"));
  assert.ok(cf.diff.includes("+"));
  assert.ok(cf.diff.includes("@ohos.ability.dataUriUtils"));
  // The manual reminderAgent finding is left untouched.
  assert.ok(result.skippedManual >= 1);
});
