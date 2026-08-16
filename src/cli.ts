#!/usr/bin/env node
/**
 * harmony-deprecate CLI
 *
 *   index   --sdk <path>                       build/refresh the deprecation map cache
 *   scan    --project <path> [--sdk] [--since N]   TS-LS scan + show deprecated usages
 *   rewrite --project <path> [--write] [--since N] [--use-ai] [--patch-syscap]
 *
 * `rewrite` applies ONLY the "obviously-correct" subset (same-kit member
 * rename / whole-kit import swap), then verifies with a real hvigor compile
 * and reverts any edit that introduced an error — so written output compiles.
 * Everything else is left untouched for `--use-ai` (skeleton only this step).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { Command } from "commander";
import { buildDeprecationMap } from "./indexer/sdk-indexer.js";
import { scanProject } from "./scanner/scanner.js";
import { scanProjectExportRenames } from "./scanner/scanner.js";
import { scanProjectCrossKitDropin } from "./scanner/scanner.js";
import { scanProjectDeprecatedMembers } from "./scanner/tsc-diagnostics-scanner.js";
import { rewriteProject } from "./rewriter/rewriter.js";
import { filterObviousSubset } from "./rewriter/subset.js";
import { revertBrokenEdits } from "./rewriter/verify-revert.js";
import { runHvigor } from "./verify/hvigor.js";
import { runAiRewrite, type AiRewriteResult } from "./ai/pipeline.js";
import { resolveAiConfig, writeConfigTemplate } from "./ai/config.js";
import { printScanSummary, printRewriteSummary } from "./report.js";
import {
  cacheFile,
  cacheDir,
  readApiVersion,
  resolveSdkApiDir,
} from "./config.js";
import { walkFiles } from "./walk.js";
import type { Finding, DeprecationMap } from "./rules/types.js";

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
    // Member/instance detection runs exclusively via the TypeScript
    // LanguageService (codes 6385/6387): it catches instance/indirected calls
    // + .ets and never matches text in comments/strings. The SDK must be on
    // disk so the LS can resolve `@ohos.*` imports against the declaration
    // files; without it the tool cannot detect member-level deprecations and
    // refuses to run (no regex fallback).
    //
    // The scan report shows TS-LS results only. Import-level rewrites (kit
    // moves, export renames, cross-kit drop-ins) are NOT reported here — TS-LS
    // gives no module-move signal at the import statement — but `rewrite`
    // still applies them so the output compiles. Deprecated members whose
    // whole kit moved are suppressed as redundant with that import rewrite.
    const tsc = scanProjectDeprecatedMembers({
      projectRoot, map, since: opts.since || 0, symbolOverrides: opts.symbolOverrides,
    });
    if (!tsc.ran) {
      console.error(
        "Error: TS-LS scanning requires the HarmonyOS SDK on disk. Set --sdk, DEVECO_SDK_HOME, or OHOS_SDK_HOME.",
      );
      process.exit(1);
    }
    console.log(printScanSummary({ findings: tsc.findings, filesScanned: tsc.filesScanned }));
  });

program
  .command("rewrite")
  .description("Apply the obviously-correct subset (dry-run unless --write).")
  .requiredOption("--project <path>", "project root directory")
  .option("--sdk <path>", "SDK ets/api directory (to build map if missing)")
  .option("--since <n>", "only rewrite deprecations with since <= N", (v) => Number(v), 0)
  .option("--ui-context <expr>", "UIContext expression for cross-kit overrides", "this.getUIContext()")
  .option("--window-stage-expr <expr>", "WindowStage expression for window overrides", "this.windowStage")
  .option("--window-expr <expr>", "Window expression for window overrides", "this.window")
  .option("--symbol-overrides <path>", "JSON file of per-symbol overrides (merged over builtin)")
  .option("--write", "write changes to disk (default: dry-run)")
  .option("--use-ai", "after the subset, send residual deprecated usages to an AI (OpenAI-compatible) for replacement")
  .option("--ai-config <path>", "AI config JSON file (else discovered: ./.ohos-migrator-ai.json or ~/.ohos-migrator-ai.json)")
  .option("--ai-base-url <url>", "OpenAI-compatible base URL (env OHOS_MIGRATOR_AI_BASE_URL)")
  .option("--ai-api-key <key>", "API key for the AI endpoint (env OHOS_MIGRATOR_AI_API_KEY)")
  .option("--ai-model <name>", "model name (env OHOS_MIGRATOR_AI_MODEL)")
  .option("--patch-syscap", "allow patching the SDK device-define for @system.* syscap errors (TODO)")
  .action(async (opts) => {
    const map = loadMap(opts.sdk);
    const projectRoot = resolve(opts.project);
    const mod = scanProject({ projectRoot, map, since: opts.since || 0 });
    const exp = scanProjectExportRenames({ projectRoot, map, since: opts.since || 0 });
    const drp = scanProjectCrossKitDropin({ projectRoot, map, since: opts.since || 0 });
    // Member/instance detection runs exclusively via the TypeScript
    // LanguageService (SDK must be present). The import-level regex scanners
    // (mod/exp/drp) run alongside TS-LS — NOT as a fallback — because they
    // cover kit moves / export renames / cross-kit drop-ins that TS-LS cannot
    // see (it emits no diagnostic on the import statement). Their findings feed
    // the subset gate so import-level edits are considered alongside member
    // renames, even though they are not shown by `scan`.
    const tsc = scanProjectDeprecatedMembers({
      projectRoot,
      map,
      since: opts.since || 0,
      uiContextExpr: opts.uiContext,
      windowStageExpr: opts.windowStageExpr,
      windowExpr: opts.windowExpr,
      symbolOverrides: opts.symbolOverrides,
    });
    if (!tsc.ran) {
      console.error(
        "Error: TS-LS scanning requires the HarmonyOS SDK on disk. Set --sdk, DEVECO_SDK_HOME, or OHOS_SDK_HOME.",
      );
      process.exit(1);
    }
    const memberFindings = tsc.findings;
    const findings = [...mod.findings, ...memberFindings, ...exp.findings, ...drp.findings];

    // STEP 1 — the "obviously-correct" subset only. Everything else is left
    // untouched (source unchanged) for `--use-ai`.
    const subset = filterObviousSubset(findings, projectRoot, map);
    const droppedForAi = findings.length - subset.length;
    const skippedManual = findings.filter((f) => f.needsManual).length;
    const write = !!opts.write;

    // Backup originals of every file the subset touches (for verify-revert).
    const originalContents = new Map<string, string>();
    for (const rel of new Set(subset.map((f) => f.file))) {
      try {
        originalContents.set(rel, readFileSync(join(projectRoot, ...rel.split("/")), "utf8"));
      } catch {
        // file absent on disk — nothing to back up / revert
      }
    }

    // Dry-run: compute (but don't write) the subset for diff display.
    const dryRunResult = write ? undefined : rewriteProject(projectRoot, subset, { write: false });

    let kept: Finding[] = subset;
    let revertedEdits = 0;
    let hvigorRan = false;
    let hvigorReason: string | undefined;

    if (write) {
      // Apply the subset for real, then ground-truth it with hvigor.
      rewriteProject(projectRoot, subset, { write: true });
      if (subset.length > 0) {
        const hv = runHvigor({ projectRoot, patchSyscap: opts.patchSyscap });
        const vr = revertBrokenEdits(projectRoot, originalContents, subset, hv, map);
        hvigorRan = vr.hvigorRan;
        hvigorReason = vr.reason;
        kept = vr.kept;
        revertedEdits = vr.reverted.length;
      }
    }

    const appliedEdits = kept.length;
    const appliedFiles = new Set(kept.map((f) => f.file)).size;

    // --use-ai: residuals = findings the subset did NOT fix (dropped + reverted).
    // Real AI path: per-file OpenAI-compatible replacement + hvigor verify +
    // file-level revert + one retry. Only when --write and AI is configured;
    // dry-run just reports the residual count.
    let leftForAiFindings = 0;
    let leftForAiFiles = 0;
    let aiResult: AiRewriteResult | undefined;
    let aiModel: string | undefined;
    let aiBaseUrl: string | undefined;
    if (opts.useAi) {
      const keptSet = new Set(kept);
      const residual = findings.filter((f) => !keptSet.has(f));
      leftForAiFindings = residual.length;
      leftForAiFiles = new Set(residual.map((f) => f.file)).size;
      const byFile = new Map<string, Finding[]>();
      for (const f of residual) {
        const arr = byFile.get(f.file) ?? [];
        arr.push(f);
        byFile.set(f.file, arr);
      }
      const aiOpts = resolveAiConfig(opts, projectRoot);
      if (write && aiOpts && byFile.size > 0) {
        aiModel = aiOpts.model;
        aiBaseUrl = aiOpts.baseUrl;
        aiResult = await runAiRewrite(projectRoot, byFile, map, aiOpts, true);
      } else if (!aiOpts) {
        console.warn(
          "Warning: --use-ai set but AI config incomplete (baseUrl/apiKey/model). Configure via --ai-config file, --ai-* flags, or OHOS_MIGRATOR_AI_*/OPENAI_* env; run `harmony-deprecate ai-config` to scaffold a config file. Skipping AI replacement.",
        );
      }
    }

    console.log(
      printRewriteSummary({
        write,
        dryRunResult,
        appliedFiles,
        appliedEdits,
        revertedEdits,
        droppedForAi,
        skippedManual,
        hvigorRan,
        hvigorReason,
        useAi: !!opts.useAi,
        leftForAiFindings,
        leftForAiFiles,
        ai: aiResult,
        aiModel,
        aiBaseUrl,
      }),
    );
  });

program
  .command("ai-config")
  .description("Scaffold an AI config file (.ohos-migrator-ai.json) from current env, or a blank template.")
  .option("-o, --output <path>", "output file path", ".ohos-migrator-ai.json")
  .option("--blank", "write a blank template (ignore current env)")
  .action((opts) => {
    const out = resolve(opts.output);
    const written = writeConfigTemplate(out, !opts.blank);
    const filled = (["baseUrl", "apiKey", "model"] as const).filter((k) => written[k]);
    console.log(`Wrote ${out}`);
    console.log(`  baseUrl: ${written.baseUrl ? "(from env)" : "<set me>"}`);
    console.log(`  apiKey : ${written.apiKey ? "(from env)" : "<set me>"}`);
    console.log(`  model  : ${written.model || "<set me>"}`);
    console.log(`  ${filled.length}/3 field(s) populated from environment.`);
    if (filled.length < 3) {
      console.log("  Edit the file to fill the rest, then run `rewrite --use-ai` (it auto-discovers this file).");
    }
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
