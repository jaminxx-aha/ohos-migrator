// Exhaustive re-derivation of the sound string-literal override seeds in
// src/rewriter/symbol-overrides.ts (BUILTIN). For every `no_replacement`
// member entry in the deprecation map, searches the WHOLE SDK declaration
// file for a line `leaf = 'x'` / `leaf = "x"` — a single string-literal enum/
// const member whose value IS the migration target (the canonical, stable
// value the deprecated symbol held). Run:
//
//   node scripts/find-literal-overrides.mjs
//
// The `^\s*leaf` anchor rejects type aliases like
// `type AuthEventKey = 'result' | 'tip'` (a union, not a single value) so they
// are NOT surfaced as false-positive seeds. Anything this script reports is a
// sound candidate; when the SDK updates, re-run to discover new seeds and add
// them to BUILTIN (verified against the new .d.ts first). As of API 24 it
// surfaces exactly 62 entries: wantConstant Action/Entity (31) +
// commonEventManager.Support (31).

import { readFileSync } from "node:fs";

const map = JSON.parse(readFileSync(".harmony-deprecate/deprecation-map.24.json", "utf8"));
const kitIndex = map.kitIndex || {};

const noRepl = map.entries.filter(
  (e) => e.dep.members && e.dep.members.length > 0 && (!e.repl || !e.repl.members || e.repl.members.length === 0),
);

const fileCache = new Map();
function getFile(file) {
  let txt = fileCache.get(file);
  if (!txt) {
    txt = readFileSync(file, "utf8");
    fileCache.set(file, txt);
  }
  return txt;
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-file search: for each no_replacement LEAF member, find ANY line in the
// SDK file matching `leaf = 'x'` or `leaf = "x"`. Captures enum members AND
// top-level string consts whose deprecation source pointed elsewhere.
const hits = [];
for (const e of noRepl) {
  const leaf = e.dep.members[e.dep.members.length - 1];
  const txt = getFile(e.source.file);
  const lines = txt.split(/\r?\n/);
  const re = new RegExp(`^\\s*${escapeRe(leaf)}\\s*=\\s*'([^']*)'|^\\s*${escapeRe(leaf)}\\s*=\\s*"([^"]*)"`);
  let found = null;
  let foundLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) {
      found = m[1] ?? m[2] ?? null;
      foundLine = i + 1;
      break;
    }
  }
  if (found != null) {
    hits.push({
      kit: e.dep.kit,
      exportName: e.dep.exportName,
      members: e.dep.members,
      leaf,
      literal: `'${found}'`,
      since: e.since,
      newKit: kitIndex[e.dep.kit]?.newKit,
      foundLine,
    });
  }
}

console.log("whole-file string-literal no_repl entries:", hits.length);
const byKit = {};
for (const h of hits) (byKit[h.kit] ??= []).push(h);
for (const [k, v] of Object.entries(byKit).sort((a, b) => b[1].length - a[1].length))
  console.log(`${v.length}\t${k}`);

console.log("\n=== hits NOT in wantConstant/commonEventManager ===");
for (const h of hits.filter((h) => !h.kit.includes("wantConstant") && !h.kit.includes("commonEventManager")))
  console.log(`  ${h.kit} ${h.exportName}.${h.members.join(".")} = ${h.literal}  (since ${h.since}, line ${h.foundLine})`);
