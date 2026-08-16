/**
 * AI-driven replacement of residual deprecated APIs (the `--use-ai` path).
 *
 * Target flow (NOT yet implemented — this module is the skeleton):
 *   1. After the "obviously-correct" subset + hvigor verify-revert, the CLI
 *      re-runs `scanProjectDeprecatedMembers` to collect whatever deprecated
 *      usages remain (everything the subset deliberately left untouched).
 *   2. Findings are grouped per file. For each file, the AI is handed the file
 *      content + the per-file findings + the deprecation map (which carries
 *      the SDK's own `@useinstead` targets and kit/export metadata) and asked
 *      to produce a replacement that compiles against the SDK `.d.ts`.
 *   3. The replacement is verified (hvigor / TS-LS) before being kept; a bad
 *      AI edit is reverted, same contract as the subset gate.
 *
 * Step 1 (this implementation) does NOT call any model: it returns
 * `changed:false` so the CLI can report the residual count and surface the
 * TODO. Wiring a real model + verify loop is deferred to a later step per the
 * user's instruction ("后续再根据我的指令拓展 ai 修改功能").
 */

import type { Finding, DeprecationMap } from "../rules/types.js";

export interface AiReplaceInput {
  /** Project-relative file path (forward slashes). */
  file: string;
  /** Residual deprecated-API findings in this file. */
  findings: Finding[];
  /** The deprecation map (SDK metadata + `@useinstead` targets). */
  map: DeprecationMap;
  /** Project root (absolute), for reading the file. */
  projectRoot: string;
}

export interface AiReplaceResult {
  /** Whether the file was modified. */
  changed: boolean;
  /** Human-readable status / TODO note for reporting. */
  note: string;
}

/**
 * Replace deprecated APIs in one file via the AI. STUB: does not modify the
 * file. Returns `changed:false` with a TODO note; the CLI aggregates these to
 * report how many residuals await the real implementation.
 */
export async function aiReplaceFile(_input: AiReplaceInput): Promise<AiReplaceResult> {
  return {
    changed: false,
    note: "AI replacement not yet implemented (TODO step 2); file left unchanged",
  };
}
