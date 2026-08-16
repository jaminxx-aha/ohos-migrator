/**
 * Real-compiler verification: run `hvigorw default@CompileArkTS` over a
 * HarmonyOS project and parse the ArkTS error sites.
 *
 * Used by the `rewrite` command as the ground-truth check after applying the
 * "obviously-correct" edit subset: any edit whose splice newly errors is
 * attributed (by line) and reverted, so the rewritten output is guaranteed to
 * compile. Deprecation *warnings* (ArkTS:WARN / 6385-equivalent) are the
 * expected scanner signal and are NOT parsed here — only blocking `At File:`
 * errors are.
 *
 * Reuses the compile invocation + `At File:` parser proven in
 * `scripts/check-arkts.mjs`, but ONLY the compile+parse (no line-commenting,
 * no device-define patching — those are the script's "mask" semantics, which
 * the rewrite gate deliberately does not adopt).
 */

import { existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

export interface HvigorResult {
  /** False when hvigor could not run (no DevEco SDK / not a HarmonyOS module). */
  ran: boolean;
  /** When ran, why not (for reporting). */
  reason?: string;
  /** abs file path -> sorted unique 1-based error line numbers. Empty if clean. */
  errors: Map<string, number[]>;
  /** Raw stdout+stderr (truncated) for debugging. */
  raw: string;
}

export interface HvigorOptions {
  /** Project root (must contain a HarmonyOS stage module, e.g. entry/). */
  projectRoot: string;
  /** When true, the caller intends @system.* support; this stub does NOT patch
   *  the SDK device-define yet (TODO) — it only warns. */
  patchSyscap?: boolean;
  /** Override the DevEco SDK home (defaults to env DEVECO_SDK_HOME / macOS path). */
  devecoSdkHome?: string;
}

/**
 * Locate the DevEco SDK home: explicit arg > env DEVECO_SDK_HOME > macOS default.
 * Returns undefined when nothing is present (=> hvigor cannot run).
 */
export function resolveDevEcoSdkHome(explicit?: string): string | undefined {
  const candidates = [
    explicit,
    process.env.DEVECO_SDK_HOME,
    // macOS standard install
    "/Applications/DevEco-Studio.app/Contents/sdk",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isDirectory()) return c;
  }
  return undefined;
}

/** Derive the hvigorw binary path from the SDK home (.../Contents/sdk ->
 *  .../Contents/tools/hvigor/bin/hvigorw). */
export function hvigorwPath(devecoSdkHome: string): string {
  return join(dirname(devecoSdkHome), "tools", "hvigor", "bin", "hvigorw");
}

/** Derive the bundled node dir (.../Contents/sdk -> .../Contents/tools/node). */
export function nodeHome(devecoSdkHome: string): string {
  return join(dirname(devecoSdkHome), "tools", "node");
}

/** Does `projectRoot` look like a HarmonyOS module (has a build-profile.json5
 *  and an entry module)? */
export function looksLikeHarmonyProject(projectRoot: string): boolean {
  return (
    existsSync(join(projectRoot, "build-profile.json5")) &&
    existsSync(join(projectRoot, "entry", "build-profile.json5"))
  );
}

/**
 * Run `hvigorw default@CompileArkTS` and parse error locations.
 *
 * Errors are parsed from the combined stdout+stderr via the `At File: <path>:<line>:<col>`
 * marker — the same marker `scripts/check-arkts.mjs` relies on. `ArkTS:WARN File:`
 * lines (deprecation warnings) are deliberately NOT matched, so the expected
 * deprecated-API signal never counts as a rewrite regression.
 */
export function runHvigor(opts: HvigorOptions): HvigorResult {
  const empty: HvigorResult = { ran: false, errors: new Map(), raw: "" };

  if (opts.patchSyscap) {
    // TODO: wire device-define syscap patching for @system.* (see
    // scripts/check-arkts.mjs patchSdkDeviceDefine). Until then the caller
    // may see spurious syscap errors on @system.* imports.
  }

  const sdkHome = resolveDevEcoSdkHome(opts.devecoSdkHome);
  if (!sdkHome) {
    return { ...empty, reason: "DEVECO_SDK_HOME not found (set it or install DevEco Studio)" };
  }
  const hvigorw = hvigorwPath(sdkHome);
  if (!existsSync(hvigorw)) {
    return { ...empty, reason: `hvigorw not found at ${hvigorw}` };
  }
  if (!looksLikeHarmonyProject(opts.projectRoot)) {
    return {
      ...empty,
      reason: `${opts.projectRoot} is not a HarmonyOS stage module (no entry/build-profile.json5)`,
    };
  }

  const nodeHomeDir = nodeHome(sdkHome);
  const r = spawnSync(
    hvigorw,
    [
      "--mode", "module",
      "-p", "module=entry@default",
      "-p", "product=default",
      "default@CompileArkTS",
      "--no-daemon",
    ],
    {
      cwd: opts.projectRoot,
      env: { ...process.env, NODE_HOME: nodeHomeDir, DEVECO_SDK_HOME: sdkHome },
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  return {
    ran: true,
    errors: parseErrorLines(out),
    // Full, untruncated output. groupRawByFile (pipeline.ts) parses
    // "At File:" markers from `raw` — they sit at the END of each error
    // block, so in a noisy project (thousands of ArkTS:WARN deprecation
    // lines) they land well past 40k. A truncated raw silently drops them,
    // making every arkts-* ERROR invisible to the verify gate (a false
    // "clean" that leaves broken AI output on disk). Keeping it whole is the
    // correctness fix; size is bounded by spawnSync maxBuffer (128 MB) and
    // groupRawByFile only retains up to 10 messages per file.
    raw: out,
  };
}

/**
 * Parse `At File: <path>:<line>:<col>` markers → Map<absPath, number[]>.
 * ArkTS errors span multiple lines (`Error Message: <…>\n  <…>. At File: …`),
 * and the `At File:` marker may sit on a continuation line, so a single-line
 * regex misses them — scan every line (mirrors check-arkts.mjs:parseErrors).
 */
export function parseErrorLines(output: string): Map<string, number[]> {
  const byFile = new Map<string, Set<number>>();
  const re = /At File: (\S+):(\d+):(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    const file = m[1];
    const line = Number(m[2]);
    if (!file || !line) continue;
    const set = byFile.get(file) ?? new Set<number>();
    set.add(line);
    byFile.set(file, set);
  }
  const out = new Map<string, number[]>();
  for (const [f, lines] of byFile) out.set(f, [...lines].sort((a, b) => a - b));
  return out;
}
