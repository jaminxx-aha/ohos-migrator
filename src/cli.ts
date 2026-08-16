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
import { resolve, basename, join, relative, sep } from "node:path";
import { Command } from "commander";
import { buildDeprecationMap } from "./indexer/sdk-indexer.js";
import { scanProject } from "./scanner/scanner.js";
import { scanProjectExportRenames } from "./scanner/scanner.js";
import { scanProjectCrossKitDropin } from "./scanner/scanner.js";
import { scanProjectDeprecatedMembers } from "./scanner/tsc-diagnostics-scanner.js";
import { rewriteProject, type RewriteResult } from "./rewriter/rewriter.js";
import { filterObviousSubset } from "./rewriter/subset.js";
import { revertBrokenEdits } from "./rewriter/verify-revert.js";
import { runHvigor } from "./verify/hvigor.js";
import { runAiRewrite, type AiRewriteResult } from "./ai/pipeline.js";
import { resolveAiConfig, writeEnvTemplate } from "./ai/config.js";
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
  .option("--file <path>", "scan only this file (relative to cwd or --project)")
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
    let scanFindings = tsc.findings;
    const scopedFile = scopeFile(opts.file, projectRoot);
    if (scopedFile) scanFindings = scanFindings.filter((f) => f.file === scopedFile);
    console.log(printScanSummary({ findings: scanFindings, filesScanned: tsc.filesScanned }, scopedFile));
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
  .option("--file <path>", "rewrite only this file (relative to cwd or --project)")
  .option("--write", "write changes to disk (default: dry-run)")
  .option("--use-ai", "after the subset, send residual deprecated usages to an AI (OpenAI-compatible) for replacement")
  .option("--env-file <path>", "dotenv file to load AI config from (else discovered: <project>/.env, ./.env, ~/.env)")
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
    let findings = [...mod.findings, ...memberFindings, ...exp.findings, ...drp.findings];
    const scopedFile = scopeFile(opts.file, projectRoot);
    if (scopedFile) findings = findings.filter((f) => f.file === scopedFile);

    const write = !!opts.write;

    // Summary accumulators shared by both paths.
    let appliedEdits = 0;
    let appliedFiles = 0;
    let revertedEdits = 0;
    let droppedForAi = 0;
    let skippedManual = 0;
    let hvigorRan = false;
    let hvigorReason: string | undefined;
    let dryRunResult: RewriteResult | undefined;
    let leftForAiFindings = 0;
    let leftForAiFiles = 0;
    let aiResult: AiRewriteResult | undefined;
    let aiModel: string | undefined;
    let aiBaseUrl: string | undefined;

    if (opts.useAi) {
      // Direct AI path: send ALL deprecated findings to the AI (OpenAI-compatible)
      // for replacement — NO prior "obvious subset" pass. The AI pipeline backs up
      // each file's original content, applies AI edits, grounds them with hvigor,
      // reverts broken files to their original (compilable) state, and retries
      // once with compiler feedback. The rule-based subset is skipped entirely.
      const byFile = new Map<string, Finding[]>();
      for (const f of findings) {
        const arr = byFile.get(f.file) ?? [];
        arr.push(f);
        byFile.set(f.file, arr);
      }
      leftForAiFindings = findings.length;
      leftForAiFiles = byFile.size;
      const aiOpts = resolveAiConfig(opts, projectRoot);
      if (write && aiOpts && byFile.size > 0) {
        aiModel = aiOpts.model;
        aiBaseUrl = aiOpts.baseUrl;
        aiResult = await runAiRewrite(projectRoot, byFile, map, aiOpts, true);
      } else if (!aiOpts) {
        console.warn(
          "Warning: --use-ai set but AI config incomplete (baseUrl/apiKey/model). Configure via a .env file (run `harmony-deprecate ai-config`), --env-file, --ai-* flags, or OHOS_MIGRATOR_AI_*/OPENAI_* env. Skipping AI replacement.",
        );
      }
    } else {
      // Default path: apply ONLY the "obviously-correct" subset (same-kit member
      // rename / whole-kit import swap), then verify with a real hvigor compile
      // and revert any edit that introduced an error — so written output compiles.
      const subset = filterObviousSubset(findings, projectRoot, map);
      droppedForAi = findings.length - subset.length;
      skippedManual = findings.filter((f) => f.needsManual).length;

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
      dryRunResult = write ? undefined : rewriteProject(projectRoot, subset, { write: false });

      let kept: Finding[] = subset;
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
      appliedEdits = kept.length;
      appliedFiles = new Set(kept.map((f) => f.file)).size;
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
        scopedFile,
      }),
    );
  });

program
  .command("ai-config")
  .description("Scaffold a dotenv .env file with AI credentials, from current env or a blank template.")
  .option("-o, --output <path>", "output file path", ".env")
  .option("--blank", "write a blank template (ignore current env)")
  .action((opts) => {
    const out = resolve(opts.output);
    const res = writeEnvTemplate(out, !opts.blank);
    console.log(`Wrote ${out}`);
    for (const f of res.fields) {
      console.log(`  ${f.label.padEnd(7)}: ${f.filled ? "(from env)" : "<set me>"}`);
    }
    const filled = res.fields.filter((f) => f.filled).length;
    console.log(`  ${filled}/3 field(s) populated from environment.`);
    if (filled < 3) {
      console.log("  Edit the file to fill the rest; `rewrite --use-ai` auto-loads ./.env (or pass --env-file).");
    }
  });

/**
 * Normalize a `--file` path to the relative-to-projectRoot, /-joined form used
 * by `Finding.file`. Accepts paths relative to cwd, relative to --project, or
 * absolute. Returns undefined when no --file was given. When the resolved path
 * lies outside projectRoot (neither a cwd-relative nor project-root-relative
 * match inside the project), returns the computed relative string anyway so the
 * caller's filter simply matches nothing rather than crashing.
 */
function scopeFile(file: string | undefined, projectRoot: string): string | undefined {
  if (!file) return undefined;
  const abs = resolve(file); // relative to cwd
  let rel = relative(projectRoot, abs);
  if (rel.startsWith("..")) {
    // Maybe the user gave it relative to --project rather than cwd.
    const rel2 = relative(projectRoot, resolve(projectRoot, file));
    if (!rel2.startsWith("..")) rel = rel2;
  }
  return rel.split(sep).join("/");
}

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
