/**
 * Console + JSON report rendering for scan/rewrite results.
 */

import type { Finding } from "./rules/types.js";
import type { ScanResult } from "./scanner/scanner.js";
import type { RewriteResult } from "./rewriter/rewriter.js";

export function printScanSummary(result: ScanResult): string {
  const { findings, filesScanned } = result;
  const lines: string[] = [];
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
  /** Residual deprecated findings after the subset (for `--use-ai`). */
  leftForAiFindings: number;
  leftForAiFiles: number;
  /** When `--use-ai --write` ran, the batch AI replacement result. */
  ai?: {
    appliedFiles: number;
    retriedFiles: number;
    stillFailedFiles: number;
    hvigorRan: boolean;
    reason?: string;
  };
  aiModel?: string;
  aiBaseUrl?: string;
}

export function printRewriteSummary(s: RewriteSummaryInput): string {
  const lines: string[] = [];
  if (s.write) {
    lines.push("Applied rewrites (obvious subset, hvigor-verified):");
    lines.push(`  ${s.appliedEdits} edit(s) applied across ${s.appliedFiles} file(s).`);
    if (s.revertedEdits > 0) {
      lines.push(
        `  ${s.revertedEdits} edit(s) reverted (introduced compile errors; left for --use-ai).`,
      );
    }
    lines.push(
      `  ${s.droppedForAi} finding(s) not in the obvious subset (left for --use-ai).`,
    );
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
    lines.push(
      `  ${s.droppedForAi} finding(s) not in the obvious subset (left for --use-ai).`,
    );
    lines.push(`  ${s.skippedManual} manual finding(s) left untouched (need human review).`);
    lines.push("  hvigor: SKIPPED (dry-run).");
  }

  if (s.useAi) {
    lines.push("");
    if (s.ai) {
      const a = s.ai;
      if (!a.hvigorRan) {
        lines.push(
          `--use-ai: AI edits reverted (no hvigor verification: ${a.reason ?? "unavailable"}); ${a.appliedFiles} file(s) left at pre-AI state.`,
        );
      } else {
        lines.push(
          `--use-ai: AI replaced ${a.appliedFiles} file(s); ${a.retriedFiles} retried with compiler feedback; ${a.stillFailedFiles} still failing (reverted to pre-AI).`,
        );
      }
      if (s.aiModel) {
        lines.push(`  model: ${s.aiModel}${s.aiBaseUrl ? ` @ ${s.aiBaseUrl}` : ""}`);
      }
    } else if (s.leftForAiFindings > 0) {
      lines.push(
        `--use-ai: ${s.leftForAiFindings} residual finding(s) across ${s.leftForAiFiles} file(s).`,
      );
      if (s.write) {
        lines.push("  (AI not configured — set --ai-base-url/--ai-api-key/--ai-model; skipping AI replacement.)");
      } else {
        lines.push("  (dry-run — AI not invoked; rerun with --write to apply AI replacement.)");
      }
    } else {
      lines.push("--use-ai: no residual deprecated usages after the subset. Nothing to send to AI.");
    }
  }
  return lines.join("\n");
}
