/**
 * Tests for the "obviously-correct" subset gate (`filterObviousSubset`).
 *
 * The gate keeps only two edit shapes — same-kit member rename (A) and
 * whole-kit import swap with all used members present (B) — and drops
 * everything else (override, cross-kit member dropin, reverse-dropin,
 * rename-export, kit-moved aligned renames, named-clause imports, swaps
 * missing a used member) so the `rewrite` output is correct by construction
 * and the rest is left for `--use-ai`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { filterObviousSubset } from "./subset.js";
import type { Finding, DeprecationMap } from "../rules/types.js";

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ohos-subset-"));
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

/** Minimal map: only the fields the subset gate reads. */
function makeMap(opts: {
  kitExports?: Record<string, string[]>;
  kitIndex?: Record<string, { since?: number; newKit?: string; manual?: boolean }>;
}): DeprecationMap {
  return {
    apiVersion: 1,
    sdkPath: "",
    generatedAt: "",
    entries: [],
    kitIndex: (opts.kitIndex ?? {}) as DeprecationMap["kitIndex"],
    kitExports: opts.kitExports,
  } as DeprecationMap;
}

function finding(over: Partial<Finding>): Finding {
  return {
    file: "src/a.ts",
    line: 1,
    oldSymbol: "",
    newSymbol: null,
    since: 0,
    rule: "rename-member",
    needsManual: false,
    note: "",
    ...over,
  } as Finding;
}

/* ---- A: same-kit member rename ---- */

test("A keeps same-kit member rename (new leaf is a real export of the same kit)", () => {
  const root = makeTree({ "src/a.ts": "import router from '@ohos.router'\nrouter.push(x)" });
  try {
    const map = makeMap({
      kitExports: { "@ohos.router": ["push", "pushUrl", "replace"] },
      kitIndex: { "@ohos.router": {} }, // no newKit → not moved
    });
    const fs = [
      finding({
        rule: "rename-member", line: 2, oldSymbol: "router.push",
        replacement: "router.pushUrl", matchStart: 36, matchEnd: 47,
      }),
    ];
    const kept = filterObviousSubset(fs, root, map);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].replacement, "router.pushUrl");
  } finally {
    cleanup(root);
  }
});

test("A drops a needsManual rename-member (reverse-dropin / manual)", () => {
  const root = makeTree({ "src/a.ts": "import router from '@ohos.router'\nrouter.push(x)" });
  try {
    const map = makeMap({
      kitExports: { "@ohos.router": ["push", "pushUrl"] },
      kitIndex: { "@ohos.router": {} },
    });
    const fs = [
      finding({
        rule: "rename-member", line: 2, oldSymbol: "router.push",
        replacement: "router.pushUrl", matchStart: 36, matchEnd: 47, needsManual: true,
      }),
    ];
    assert.equal(filterObviousSubset(fs, root, map).length, 0);
  } finally {
    cleanup(root);
  }
});

test("A drops a rename-member whose kit moved (aligned rename — not standalone-correct)", () => {
  const root = makeTree({ "src/a.ts": "import router from '@ohos.router'\nrouter.push(x)" });
  try {
    const map = makeMap({
      kitExports: { "@ohos.router": ["push", "pushUrl"] },
      kitIndex: { "@ohos.router": { newKit: "@ohos.router.new" } }, // kit moved
    });
    const fs = [
      finding({
        rule: "rename-member", line: 2, oldSymbol: "router.push",
        replacement: "router.pushUrl", matchStart: 36, matchEnd: 47,
      }),
    ];
    assert.equal(filterObviousSubset(fs, root, map).length, 0);
  } finally {
    cleanup(root);
  }
});

test("A drops a rename-member whose new leaf is not an export of the same kit", () => {
  const root = makeTree({ "src/a.ts": "import router from '@ohos.router'\nrouter.push(x)" });
  try {
    const map = makeMap({
      kitExports: { "@ohos.router": ["push"] }, // no pushUrl
      kitIndex: { "@ohos.router": {} },
    });
    const fs = [
      finding({
        rule: "rename-member", line: 2, oldSymbol: "router.push",
        replacement: "router.pushUrl", matchStart: 36, matchEnd: 47,
      }),
    ];
    assert.equal(filterObviousSubset(fs, root, map).length, 0);
  } finally {
    cleanup(root);
  }
});

test("A drops a cross-kit member dropin (rebind to a different binding)", () => {
  const root = makeTree({ "src/a.ts": "import pa from '@ohos.ability.particleAbility'\npa.start(x)" });
  try {
    const map = makeMap({
      kitExports: { "@ohos.ability.particleAbility": ["start"], "@ohos.bt": ["startBackgroundRunning"] },
      kitIndex: {},
    });
    const fs = [
      finding({
        rule: "rename-member", line: 2, oldSymbol: "pa.start",
        replacement: "backgroundTaskManager.startBackgroundRunning", matchStart: 60, matchEnd: 68,
      }),
    ];
    assert.equal(filterObviousSubset(fs, root, map).length, 0);
  } finally {
    cleanup(root);
  }
});

test("A drops an override finding entirely (not a rename-member / rewrite-import)", () => {
  const root = makeTree({ "src/a.ts": "import router from '@ohos.router'\nrouter.push(x)" });
  try {
    const map = makeMap({ kitExports: { "@ohos.router": ["push"] } });
    const fs = [
      finding({
        rule: "override", line: 2, oldSymbol: "router.push",
        replacement: "this.getUIContext().getRouter().push(x)", matchStart: 36, matchEnd: 47,
      }),
    ];
    assert.equal(filterObviousSubset(fs, root, map).length, 0);
  } finally {
    cleanup(root);
  }
});

/* ---- B: whole-kit import swap ---- */

test("B keeps whole-kit import swap when every used member exists in the new kit", () => {
  const root = makeTree({
    "src/a.ts": "import router from '@ohos.deprecated.router'\nrouter.push(x)\nrouter.replace(y)",
  });
  try {
    const map = makeMap({
      kitExports: { "@ohos.router": ["push", "replace"] },
      kitIndex: { "@ohos.deprecated.router": { newKit: "@ohos.router" } },
    });
    const fs = [
      finding({
        rule: "rewrite-import", line: 1, oldSymbol: "@ohos.deprecated.router",
        newSymbol: "@ohos.router",
      }),
    ];
    const kept = filterObviousSubset(fs, root, map);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].newSymbol, "@ohos.router");
  } finally {
    cleanup(root);
  }
});

test("B keeps a namespace import swap with no member usages (vacuously safe)", () => {
  const root = makeTree({ "src/a.ts": "import * as ns from '@ohos.deprecated.router'\nconst x = ns" });
  try {
    const map = makeMap({
      kitExports: { "@ohos.router": ["anything"] },
      kitIndex: { "@ohos.deprecated.router": { newKit: "@ohos.router" } },
    });
    const fs = [
      finding({
        rule: "rewrite-import", line: 1, oldSymbol: "@ohos.deprecated.router",
        newSymbol: "@ohos.router",
      }),
    ];
    assert.equal(filterObviousSubset(fs, root, map).length, 1);
  } finally {
    cleanup(root);
  }
});

test("B drops the swap when a used member is missing in the new kit", () => {
  const root = makeTree({
    "src/a.ts": "import router from '@ohos.deprecated.router'\nrouter.push(x)\nrouter.removedMember(y)",
  });
  try {
    const map = makeMap({
      kitExports: { "@ohos.router": ["push"] }, // no removedMember
      kitIndex: { "@ohos.deprecated.router": { newKit: "@ohos.router" } },
    });
    const fs = [
      finding({
        rule: "rewrite-import", line: 1, oldSymbol: "@ohos.deprecated.router",
        newSymbol: "@ohos.router",
      }),
    ];
    assert.equal(filterObviousSubset(fs, root, map).length, 0);
  } finally {
    cleanup(root);
  }
});

test("B drops a named-clause import swap (only default/namespace bindings are kept)", () => {
  const root = makeTree({ "src/a.ts": "import { push } from '@ohos.deprecated.router'\npush(x)" });
  try {
    const map = makeMap({
      kitExports: { "@ohos.router": ["push"] },
      kitIndex: { "@ohos.deprecated.router": { newKit: "@ohos.router" } },
    });
    const fs = [
      finding({
        rule: "rewrite-import", line: 1, oldSymbol: "@ohos.deprecated.router",
        newSymbol: "@ohos.router",
      }),
    ];
    assert.equal(filterObviousSubset(fs, root, map).length, 0);
  } finally {
    cleanup(root);
  }
});

test("B drops a cross-kit dropin (not a kitIndex module move)", () => {
  const root = makeTree({ "src/a.ts": "import router from '@ohos.old.router'\nrouter.push(x)" });
  try {
    // kitIndex[old].newKit !== newSymbol (no kitIndex entry at all)
    const map = makeMap({
      kitExports: { "@ohos.router": ["push"] },
      kitIndex: {},
    });
    const fs = [
      finding({
        rule: "rewrite-import", line: 1, oldSymbol: "@ohos.old.router",
        newSymbol: "@ohos.router",
      }),
    ];
    assert.equal(filterObviousSubset(fs, root, map).length, 0);
  } finally {
    cleanup(root);
  }
});

test("findings for an unreadable file are all dropped (no crash)", () => {
  const root = makeTree({ "src/other.ts": "" }); // src/a.ts does not exist
  try {
    const map = makeMap({ kitExports: { "@ohos.router": ["push", "pushUrl"] } });
    const fs = [
      finding({
        file: "src/a.ts", rule: "rename-member", line: 2, oldSymbol: "router.push",
        replacement: "router.pushUrl", matchStart: 0, matchEnd: 0,
      }),
    ];
    assert.equal(filterObviousSubset(fs, root, map).length, 0);
  } finally {
    cleanup(root);
  }
});
