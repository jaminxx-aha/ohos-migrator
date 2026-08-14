import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { scanProjectDeprecatedMembers } from "./tsc-diagnostics-scanner.js";
import type { DeprecationEntry, DeprecationMap, ReplSymbol } from "../rules/types.js";

/** Write a temp directory tree from a {relPath: content} map. */
function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ohos-tscdiag-"));
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

/** A static member entry: deprecated `binding.<members>` reached via a binding. */
function memberEntry(
  kit: string,
  exportName: string | undefined,
  members: string[],
  repl: ReplSymbol | null,
  since = 9,
): DeprecationEntry {
  return { dep: { kit, exportName, members }, since, repl, kind: "member", source: { file: "", line: 0 } };
}

/** An instance-method entry: deprecated `var.<leaf>` on a typed receiver. */
function instEntry(
  kit: string,
  exportName: string | undefined,
  members: string[],
  repl: ReplSymbol | null,
  since = 9,
): DeprecationEntry {
  return { dep: { kit, exportName, members }, since, repl, kind: "member", source: { file: "", line: 0 } };
}

/** SDK fixture file -> kit, mirroring the indexer's file→kit attribution. */
const FILE_KIT: Record<string, string> = {
  "@ohos.i18n.d.ts": "@ohos.i18n",
  "@ohos.rpc.d.ts": "@ohos.rpc",
};

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

/** Synthetic SDK with @deprecated JSDoc so TS emits 6385/6387 diagnostics. */
const SDK: Record<string, string> = {
  "@ohos.i18n.d.ts": `
declare namespace i18n {
  /** @deprecated use Unicode instead */
  export class Character {
    constructor();
    /** @deprecated use Unicode.isDigit instead */
    isDigit(ch: string): boolean;
  }
  export class Unicode {
    isDigit(ch: string): boolean;
  }
}
export default i18n;`,
  "@ohos.rpc.d.ts": `
declare namespace rpc {
  /** @deprecated use MessageSequence instead */
  export class MessageParcel {
    create(): void;
  }
  export class MessageSequence {
    create(): void;
  }
}
export default rpc;`,
};

test("tsc-diagnostics scanner: .ets ArkUI — static class rename + instance method (manual), no comment FP", () => {
  const sdk = makeTree(SDK);
  const proj = makeTree({
    "src/main/ets/pages/ProbePage.ets": `
import i18n from '@ohos.i18n';
@Entry
@Component
struct ProbePage {
  build() {
    // i18n.Character is deprecated — but this is a comment, must NOT flag.
    const c = new i18n.Character();
    c.isDigit('5');
    // c.isDigit('6');   <- commented usage, must NOT flag
  }
}
`,
  });
  try {
    const map = mkMap(sdk, [
      // static class rename: i18n.Character -> i18n.Unicode
      memberEntry("@ohos.i18n", "i18n", ["Character"], { kit: "@ohos.i18n", members: ["Unicode"] }),
      // instance method: c.isDigit -> @ohos.i18n/isDigit (instanceSafe unset -> manual)
      instEntry("@ohos.i18n", "i18n", ["Character", "isDigit"],
        { kit: "@ohos.i18n", exportName: "Unicode", members: ["isDigit"] }),
    ]);
    const r = scanProjectDeprecatedMembers({ projectRoot: proj, map });
    assert.equal(r.ran, true, "scanner should run (SDK present)");
    assert.ok(r.filesScanned >= 1);

    const cls = r.findings.find((f) => f.oldSymbol === "i18n.Character");
    assert.ok(cls, "expected a finding for i18n.Character");
    assert.equal(cls!.rule, "rename-member");
    assert.equal(cls!.replacement, "i18n.Unicode");

    const inst = r.findings.find((f) => f.oldSymbol === "c.isDigit");
    assert.ok(inst, "expected a finding for c.isDigit (the case regex misses)");
    assert.equal(inst!.rule, "manual");
    assert.equal(inst!.newSymbol, "@ohos.i18n/isDigit");

    // Exactly ONE c.isDigit finding — the commented `// c.isDigit('6')` must NOT
    // produce a second (the regex scanner's comment false-positive is gone).
    const instCount = r.findings.filter((f) => f.oldSymbol === "c.isDigit").length;
    assert.equal(instCount, 1, "commented usage must not flag");
  } finally {
    rm(sdk);
    rm(proj);
  }
});

test("tsc-diagnostics scanner: .ts — same detection on plain TypeScript", () => {
  const sdk = makeTree(SDK);
  const proj = makeTree({
    "src/logic.ts": `
import rpc from '@ohos.rpc';
function f() {
  const p = new rpc.MessageParcel();
  p.create();
}
`,
  });
  try {
    const map = mkMap(sdk, [
      memberEntry("@ohos.rpc", "rpc", ["MessageParcel"], { kit: "@ohos.rpc", members: ["MessageSequence"] }),
      instEntry("@ohos.rpc", "rpc", ["MessageParcel", "create"],
        { kit: "@ohos.rpc", exportName: "MessageSequence", members: ["create"] }),
    ]);
    const r = scanProjectDeprecatedMembers({ projectRoot: proj, map });
    assert.equal(r.ran, true);
    const cls = r.findings.find((f) => f.oldSymbol === "rpc.MessageParcel");
    assert.ok(cls, "expected a finding for rpc.MessageParcel");
    assert.equal(cls!.rule, "rename-member");
    assert.equal(cls!.replacement, "rpc.MessageSequence");
  } finally {
    rm(sdk);
    rm(proj);
  }
});

test("tsc-diagnostics scanner: no false positive on a non-deprecated member", () => {
  const sdk = makeTree(SDK);
  const proj = makeTree({
    "src/logic.ts": `
import i18n from '@ohos.i18n';
function f() {
  const u = new i18n.Unicode();   // Unicode is NOT deprecated
  u.isDigit('5');                 // isDigit on Unicode is NOT deprecated
}
`,
  });
  try {
    const map = mkMap(sdk, [
      memberEntry("@ohos.i18n", "i18n", ["Character"], { kit: "@ohos.i18n", members: ["Unicode"] }),
      instEntry("@ohos.i18n", "i18n", ["Character", "isDigit"],
        { kit: "@ohos.i18n", exportName: "Unicode", members: ["isDigit"] }),
    ]);
    const r = scanProjectDeprecatedMembers({ projectRoot: proj, map });
    assert.equal(r.ran, true);
    assert.equal(r.findings.length, 0, "Unicode.isDigit is not deprecated — no finding");
  } finally {
    rm(sdk);
    rm(proj);
  }
});

test("tsc-diagnostics scanner: degrades gracefully when SDK is absent", () => {
  const proj = makeTree({
    "src/logic.ts": `import i18n from '@ohos.i18n'; const c = new i18n.Character(); c.isDigit('5');`,
  });
  try {
    const map: DeprecationMap = {
      apiVersion: 24,
      sdkPath: "/nonexistent/sdk/path/that/does/not/exist",
      generatedAt: "",
      entries: [
        memberEntry("@ohos.i18n", "i18n", ["Character"], { kit: "@ohos.i18n", members: ["Unicode"] }),
      ],
      kitIndex: {},
    };
    const r = scanProjectDeprecatedMembers({ projectRoot: proj, map });
    assert.equal(r.ran, false, "scanner must signal fallback when SDK is absent");
    assert.equal(r.findings.length, 0);
  } finally {
    rm(proj);
  }
});
