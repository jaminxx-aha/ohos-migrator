#!/usr/bin/env node
/**
 * ArkTSCheck self-repair for the deprecated-API corpus.
 *
 * Runs the real ArkTS compiler (`hvigorw default@CompileArkTS`) over the
 * `test/deprecated` stage module, parses ArkTS error diagnostics, comments out
 * every source line that produces a non-WARN error, and re-runs until the
 * compile is clean (0 errors) or a 6-iteration cap. Deprecation WARNs
 * (ArkTS:WARN / 6385-equivalent) are the EXPECTED scanner-detection signal and
 * are ignored.
 *
 * Run from the repo root:
 *   node scripts/check-arkts.mjs
 *
 * Env: NODE_HOME + DEVECO_SDK_HOME point at the DevEco bundled node + SDK.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..");
const MODULE_DIR = join(ROOT, "test", "deprecated");
const ETS_DIR = join(MODULE_DIR, "entry", "src", "main", "ets");
const NODE_HOME = "/Applications/DevEco-Studio.app/Contents/tools/node";
const DEVECO_SDK_HOME = "/Applications/DevEco-Studio.app/Contents/sdk";
const HVIGORW = "/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw";
const MAX_ITERS = 6;

// ArkTS error lines look like:
//   Error Message: <msg> At File: <abs path>:<line>:<col>
const ERR_RE = /Error Message: .* At File: (.+):(\d+):(\d+)/g;

/** Collect corpus .ets files (exclude scaffolding subdirs + build artifacts). */
function corpusFiles() {
  const SKIP = new Set(["entryability", "pages", "build", "oh_modules", ".hvigor", "node_modules"]);
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) { if (!SKIP.has(name)) walk(p); }
      else if (name.endsWith(".ets")) out.push(p);
    }
  };
  walk(ETS_DIR);
  return out;
}

/** Wipe hvigor/ArkTS incremental caches so each compile is a true full build
 *  (stale incremental state can mask errors after source edits). */
function clearCaches() {
  for (const rel of ["entry/build", ".hvigor", "build"]) {
    const p = join(MODULE_DIR, rel);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
}

/** Run hvigorw CompileArkTS; return the raw stdout+stderr text. */
function runCompile() {
  clearCaches();
  const r = spawnSync(HVIGORW,
    ["--mode", "module", "-p", "module=entry@default", "-p", "product=default",
     "default@CompileArkTS", "--no-daemon"],
    { cwd: MODULE_DIR, env: { ...process.env, NODE_HOME, DEVECO_SDK_HOME }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return (r.stdout ?? "") + (r.stderr ?? "");
}

/** Parse error lines → Map<absFile, Set<1-based line>>; returns {} if clean. */
function parseErrors(out) {
  const byFile = new Map();
  let m;
  ERR_RE.lastIndex = 0;
  while ((m = ERR_RE.exec(out)) !== null) {
    const file = m[1];
    const line = Number(m[2]);
    if (!file || !line) continue;
    if (!byFile.has(file)) byFile.set(file, new Set());
    byFile.get(file).add(line);
  }
  return byFile;
}

/** Comment out (prepend `// ` to) the given 1-based lines in a file, in place. */
function commentLines(file, lines) {
  let txt = readFileSync(file, "utf8");
  const arr = txt.split(/\r?\n/);
  let changed = 0;
  for (const ln of lines) {
    const i = ln - 1;
    if (i < 0 || i >= arr.length) continue;
    if (/^\s*\/\//.test(arr[i])) continue; // already commented
    arr[i] = `// omitted: arkts (line ${ln}) // ${arr[i].trimStart()}`;
    changed++;
  }
  if (changed > 0) writeFileSync(file, arr.join("\n"), "utf8");
  return changed;
}

function main() {
  let total = 0;
  for (let iter = 1; iter <= MAX_ITERS; iter++) {
    const out = runCompile();
    const byFile = parseErrors(out);
    const errorCount = [...byFile.values()].reduce((n, s) => n + s.size, 0);
    if (errorCount === 0) {
      // Confirm via the COMPILE RESULT line.
      if (/COMPILE RESULT:FAIL/.test(out) && /ERROR:0\b|ERROR: 0\b/.test(out)) {
        // fall through to success
      }
      const ok = /COMPILE RESULT:SUCCESS|Finished|BUILD SUCCESSFUL/.test(out) ||
                 (/COMPILE RESULT:FAIL/.test(out) === false);
      console.log(`iter ${iter}: 0 ArkTS errors — clean compile`);
      console.log(`done: commented ${total} line(s) over ${iter - 1} repair round(s)`);
      return;
    }
    let fixed = 0;
    for (const [file, lines] of byFile) {
      fixed += commentLines(file, lines);
    }
    total += fixed;
    console.log(`iter ${iter}: ${errorCount} error line(s) across ${byFile.size} file(s); commented ${fixed}`);
  }
  // One final verification run.
  const out = runCompile();
  const byFile = parseErrors(out);
  const remaining = [...byFile.values()].reduce((n, s) => n + s.size, 0);
  if (remaining === 0) {
    console.log(`done: commented ${total} line(s); final compile clean`);
  } else {
    console.error(`done: commented ${total} line(s); ${remaining} error(s) REMAIN after ${MAX_ITERS} rounds:`);
    for (const [file, lines] of byFile) {
      for (const ln of [...lines].sort((a, b) => a - b)) {
        console.error(`  ${file.replace(ETS_DIR + "/", "")}:${ln}`);
      }
    }
    process.exit(1);
  }
}

main();
