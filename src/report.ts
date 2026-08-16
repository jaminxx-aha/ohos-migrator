/**
 * Console + JSON report rendering for scan/rewrite results.
 */

import type { Finding } from "./rules/types.js";
import type { ScanResult } from "./scanner/scanner.js";
import type { RewriteResult } from "./rewriter/rewriter.js";

export function printScanSummary(result: ScanResult, scopedFile?: string): string {
  const { findings, filesScanned } = result;
  const lines: string[] = [];
  if (scopedFile) lines.push(`(scoped to ${scopedFile})`);
  lines.push(`Scanned ${filesScanned} file(s).`);
  lines.push(`${findings.length} deprecated usage(s) found.\n`);

  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = byRule.get(f.rule) ?? [];
    arr.push(f);
    byRule.set(f.rule, arr);
  }
  for (const [rule, fs] of byRule) {
    lines.push(`[${rule}] ${fs.length}`);
    for (const f of fs) {
      lines.push(
        `  ${f.file}:${f.line}  ${f.oldSymbol}${f.newSymbol ? " -> " + f.newSymbol : ""}  (since ${f.since}${f.needsManual ? ", manual" : ""})`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export interface RewriteSummaryInput {
  write: boolean;
  /** Dry-run only: the subset rewrite result, for showing candidate diffs. */
  dryRunResult?: RewriteResult;
  /** Distinct files whose edits survived verification. */
  appliedFiles: number;
  /** Edits that survived verification (still on disk). */
  appliedEdits: number;
  /** Edits reverted because they introduced compile errors. */
  revertedEdits: number;
  /** Findings the subset gate dropped (left for `--use-ai`). */
  droppedForAi: number;
  /** Findings with no `@useinstead` / override (need human review). */
  skippedManual: number;
  /** Whether the hvigor ground-truth check ran. */
  hvigorRan: boolean;
  hvigorReason?: string;
  /** Whether `--use-ai` was requested. */
  useAi: boolean;
  /** Deprecated findings sent to the AI under `--use-ai` (ALL findings; no subset pass). */
  leftForAiFindings: number;
  leftForAiFiles: number;
  /** When `--use-ai --write` ran, the batch AI replacement result. */
  ai?: {
    appliedFiles: number;
    retriedFiles: number;
    stillFailedFiles: number;
    hvigorRan: boolean;
    /** Which verifier grounded the edits (whole-project hvigor, or the
     *  TS-LS single-file delta used under `--file`). */
    verifyMode?: "hvigor" | "ts-ls";
    reason?: string;
  };
  aiModel?: string;
  aiBaseUrl?: string;
  /** When `--file` was given, the relative path the run was scoped to. */
  scopedFile?: string;
}

export function printRewriteSummary(s: RewriteSummaryInput): string {
  const lines: string[] = [];
  if (s.scopedFile) lines.push(`(scoped to ${s.scopedFile})`);

  if (s.useAi) {
    // Direct-AI path: no "obvious subset" pass. Report AI replacement only.
    if (s.write) {
      if (s.ai) {
        const a = s.ai;
        const verLabel = a.verifyMode === "ts-ls" ? "TS-LS verified, single-file" : "hvigor-verified";
        const verNoun = a.verifyMode === "ts-ls" ? "TS-LS verification" : "hvigor verification";
        if (!a.hvigorRan) {
          lines.push(
            `AI rewrite: reverted (no ${verNoun}: ${a.reason ?? "unavailable"}); ${a.appliedFiles} file(s) left at original state.`,
          );
        } else {
          lines.push(
            `AI rewrite (${verLabel}): ${a.appliedFiles} file(s) replaced; ${a.retriedFiles} retried with compiler feedback; ${a.stillFailedFiles} still failing (reverted to original).`,
          );
        }
        if (s.aiModel) {
          lines.push(`  model: ${s.aiModel}${s.aiBaseUrl ? ` @ ${s.aiBaseUrl}` : ""}`);
        }
      } else if (s.leftForAiFindings === 0) {
        lines.push("AI rewrite: no deprecated usages found. Nothing to send to AI.");
      } else {
        lines.push(
          `AI rewrite: ${s.leftForAiFindings} finding(s) across ${s.leftForAiFiles} file(s) would be sent to AI.`,
        );
        lines.push(
          "  (AI not configured — run `harmony-deprecate ai-config` / set --env-file / OHOS_MIGRATOR_AI_* env; skipping.)",
        );
      }
    } else {
      // dry-run + --use-ai
      if (s.leftForAiFindings === 0) {
        lines.push("Dry-run — no deprecated usages found. Nothing to send to AI.");
      } else {
        lines.push(
          `Dry-run — would send ${s.leftForAiFindings} finding(s) across ${s.leftForAiFiles} file(s) to AI for replacement.`,
        );
        lines.push("  (AI not invoked; rerun with --write to apply.)");
      }
    }
    return lines.join("\n");
  }

  // Default (subset) path.
  if (s.write) {
    lines.push("Applied rewrites (obvious subset, hvigor-verified):");
    lines.push(`  ${s.appliedEdits} edit(s) applied across ${s.appliedFiles} file(s).`);
    if (s.revertedEdits > 0) {
      lines.push(`  ${s.revertedEdits} edit(s) reverted (introduced compile errors).`);
    }
    lines.push(`  ${s.droppedForAi} finding(s) not in the obvious subset.`);
    lines.push(`  ${s.skippedManual} manual finding(s) left untouched (need human review).`);
    if (s.hvigorRan) {
      lines.push("  hvigor: real compile check ran.");
    } else {
      lines.push(
        `  hvigor: SKIPPED (${s.hvigorReason ?? "unavailable"}); subset applied without compile verification.`,
      );
    }
  } else {
    lines.push("Dry-run — would apply the obvious subset:");
    if (s.dryRunResult) {
      for (const cf of s.dryRunResult.changedFiles) {
        lines.push(`  ${cf.file}`);
        if (cf.diff) lines.push(cf.diff);
      }
    }
    lines.push(`  ${s.appliedEdits} edit(s) would apply across ${s.appliedFiles} file(s).`);
    lines.push(`  ${s.droppedForAi} finding(s) not in the obvious subset.`);
    lines.push(`  ${s.skippedManual} manual finding(s) left untouched (need human review).`);
    lines.push("  hvigor: SKIPPED (dry-run).");
  }
  return lines.join("\n");
}
