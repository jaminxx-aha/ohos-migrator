#!/usr/bin/env node
/**
 * harmony-deprecate CLI
 *
 *   index   --sdk <path>            build/refresh the deprecation map cache
 *   scan    --project <path> [--sdk <path>] [--since N]
 *   rewrite --project <path> [--write] [--since N]
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { Command } from "commander";
import { buildDeprecationMap } from "./indexer/sdk-indexer.js";
import { scanProject } from "./scanner/scanner.js";
import { scanProjectExportRenames } from "./scanner/scanner.js";
import { scanProjectCrossKitDropin } from "./scanner/scanner.js";
import { scanProjectMembers, scanProjectInstanceMembers } from "./scanner/member-scanner.js";
import { scanProjectInstanceMembersTsc } from "./scanner/tsc-instance-scanner.js";
import { rewriteProject } from "./rewriter/rewriter.js";
import { printScanSummary, printRewriteSummary } from "./report.js";
import {
  cacheFile,
  cacheDir,
  readApiVersion,
  resolveSdkApiDir,
} from "./config.js";
import { walkFiles } from "./walk.js";
import type { DeprecationMap } from "./rules/types.js";

const program = new Command();

program
  .name("harmony-deprecate")
  .description("Scan a HarmonyOS project for deprecated @ohos APIs and replace them.");

program
  .command("index")
  .description("Build/refresh the deprecation map cache from the SDK .d.ts files.")
  .option("--sdk <path>", "SDK ets/api directory (auto-detected if omitted)")
  .action((opts) => {
    const sdkApiDir = resolveSdkApiDir(opts.sdk);
    const apiVersion = readApiVersion(sdkApiDir);
    console.log(`Indexing SDK at ${sdkApiDir} (apiVersion ${apiVersion}) ...`);
    const map = buildDeprecationMap({ sdkApiDir, apiVersion });
    mkdirSync(cacheDir(), { recursive: true });
    const out = cacheFile(apiVersion);
    writeFileSync(out, JSON.stringify(map, null, 2), "utf8");
    const moves = Object.entries(map.kitIndex).filter(([, v]) => v.newKit).length;
    const manual = Object.values(map.kitIndex).filter((v) => v.manual).length;
    console.log(
      `  entries: ${map.entries.length}  |  kits: ${Object.keys(map.kitIndex).length}  |  module-moves: ${moves}  |  manual kits: ${manual}`,
    );
    console.log(`  cache: ${out}`);
  });

program
  .command("scan")
  .description("Scan a project for deprecated SDK usages.")
  .requiredOption("--project <path>", "project root directory")
  .option("--sdk <path>", "SDK ets/api directory (to build map if missing)")
  .option("--since <n>", "only report deprecations with since <= N", (v) => Number(v), 0)
  .option("--symbol-overrides <path>", "JSON file of per-symbol overrides (merged over builtin)")
  .action((opts) => {
    const map = loadMap(opts.sdk);
    const projectRoot = resolve(opts.project);
    const mod = scanProject({ projectRoot, map, since: opts.since || 0 });
    const mem = scanProjectMembers({ projectRoot, map, since: opts.since || 0, symbolOverrides: opts.symbolOverrides });
    const ins = scanProjectInstanceMembers({ projectRoot, map, since: opts.since || 0 });
    const tsc = scanProjectInstanceMembersTsc({ projectRoot, map, since: opts.since || 0 });
    const exp = scanProjectExportRenames({ projectRoot, map, since: opts.since || 0 });
    const drp = scanProjectCrossKitDropin({ projectRoot, map, since: opts.since || 0 });
    const findings = [...mod.findings, ...mem.findings, ...ins.findings, ...tsc.findings, ...exp.findings, ...drp.findings];
    console.log(
      printScanSummary(
        { findings, filesScanned: Math.max(mod.filesScanned, mem.filesScanned, ins.filesScanned, tsc.filesScanned, exp.filesScanned, drp.filesScanned) },
      ),
    );
  });

program
  .command("rewrite")
  .description("Apply safe rewrites (dry-run unless --write).")
  .requiredOption("--project <path>", "project root directory")
  .option("--sdk <path>", "SDK ets/api directory (to build map if missing)")
  .option("--since <n>", "only rewrite deprecations with since <= N", (v) => Number(v), 0)
  .option("--ui-context <expr>", "UIContext expression for cross-kit overrides", "this.getUIContext()")
  .option("--window-stage-expr <expr>", "WindowStage expression for window overrides", "this.windowStage")
  .option("--window-expr <expr>", "Window expression for window overrides", "this.window")
  .option("--symbol-overrides <path>", "JSON file of per-symbol overrides (merged over builtin)")
  .option("--write", "write changes to disk (default: dry-run)")
  .action((opts) => {
    const map = loadMap(opts.sdk);
    const projectRoot = resolve(opts.project);
    const mod = scanProject({ projectRoot, map, since: opts.since || 0 });
    const mem = scanProjectMembers({
      projectRoot,
      map,
      since: opts.since || 0,
      uiContextExpr: opts.uiContext,
      windowStageExpr: opts.windowStageExpr,
      windowExpr: opts.windowExpr,
      symbolOverrides: opts.symbolOverrides,
    });
    const exp = scanProjectExportRenames({ projectRoot, map, since: opts.since || 0 });
    const drp = scanProjectCrossKitDropin({ projectRoot, map, since: opts.since || 0 });
    const ins = scanProjectInstanceMembers({
      projectRoot,
      map,
      since: opts.since || 0,
      uiContextExpr: opts.uiContext,
      windowStageExpr: opts.windowStageExpr,
      windowExpr: opts.windowExpr,
    });
    const tsc = scanProjectInstanceMembersTsc({
      projectRoot,
      map,
      since: opts.since || 0,
      uiContextExpr: opts.uiContext,
      windowStageExpr: opts.windowStageExpr,
      windowExpr: opts.windowExpr,
    });
    const findings = [...mod.findings, ...mem.findings, ...ins.findings, ...tsc.findings, ...exp.findings, ...drp.findings];
    const result = rewriteProject(projectRoot, findings, { write: !!opts.write });
    console.log(printRewriteSummary(result, !!opts.write));
  });

function loadMap(sdk?: string): DeprecationMap {
  // Try cache for the resolved apiVersion first.
  let apiVersion: number;
  try {
    apiVersion = readApiVersion(resolveSdkApiDir(sdk));
  } catch {
    // SDK unavailable: fall back to the highest-version cached map.
    const cached = pickHighestVersionCache();
    if (cached) return readJSON(cached.path) as DeprecationMap;
    throw new Error(
      "No deprecation map found. Run `harmony-deprecate index --sdk <path>` first.",
    );
  }
  const cache = cacheFile(apiVersion);
  if (existsSync(cache)) return readJSON(cache) as DeprecationMap;
  // Build on demand if SDK is available.
  const sdkApiDir = resolveSdkApiDir(sdk);
  const map = buildDeprecationMap({ sdkApiDir, apiVersion });
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(cache, JSON.stringify(map, null, 2), "utf8");
  return map;
}

function readJSON(p: string): unknown {
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Pick the cached map with the highest apiVersion; null if none. */
function pickHighestVersionCache(): { path: string; version: number } | null {
  const dir = cacheDir();
  if (!existsSync(dir)) return null;
  const files = walkFiles(dir, { extensions: [".json"] });
  let best: { path: string; version: number } | null = null;
  for (const f of files) {
    const m = basename(f).match(/deprecation-map\.(\d+)\.json$/);
    if (!m) continue;
    const version = Number(m[1]);
    if (!best || version > best.version) best = { path: f, version };
  }
  return best;
}

program.parseAsync(process.argv).catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
