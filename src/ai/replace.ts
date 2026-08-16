/**
 * AI replacement for one file's residual deprecated APIs.
 *
 * Builds the prompt context (file content with line numbers + per-finding
 * briefs + deduped SDK declaration slices), calls the OpenAI-compatible model
 * for a structured `{edits:[{oldText,newText}]}` payload, applies the edits,
 * and returns the new content. This function does NOT write to disk or
 * verify — the batch pipeline (`pipeline.ts`) owns write/verify/revert so a
 * failed verify can re-run the same pre-AI content through `retryErrors`.
 */

import { buildFileContext, type FindingBrief } from "./sdk-context.js";
import { requestEdits, type AiClientOpts } from "./client.js";
import { applyTargetedEdits } from "./apply-edits.js";
import type { Finding, DeprecationMap } from "../rules/types.js";

export interface AiReplaceInput {
  file: string;
  findings: Finding[];
  map: DeprecationMap;
  projectRoot: string;
}

export interface AiReplaceOutcome {
  changed: boolean;
  /** New file content after applying edits (caller writes it). */
  content: string;
  applied: number;
  skipped: number;
  note: string;
}

export async function aiReplaceFile(
  input: AiReplaceInput,
  client: AiClientOpts,
  retryErrors?: string,
): Promise<AiReplaceOutcome> {
  const ctx = buildFileContext(input.projectRoot, input.file, input.findings, input.map);

  const user = [
    `## File: ${input.file} (with line numbers)`,
    numberLines(ctx.fileContent),
    "",
    "## Deprecated call sites to fix (line | oldSymbol -> newSymbol | rule | note)",
    ...ctx.findingBriefs.map((b) => briefLine(b)),
    "",
    "## SDK declarations (deprecated + replacement, from the SDK .d.ts)",
    ctx.sdkSlices.length ? ctx.sdkSlices.join("\n\n") : "(none resolvable — rely on the call-site notes)",
  ].join("\n");

  const { edits, raw } = await requestEdits(client, user, retryErrors);
  const result = applyTargetedEdits(ctx.fileContent, edits);

  if (result.applied === 0) {
    return {
      changed: false,
      content: ctx.fileContent,
      applied: 0,
      skipped: result.skipped.length,
      note: edits.length === 0
        ? "model returned no edits"
        : `model returned ${edits.length} edit(s) but none applied (${result.skipped.length} skipped: ${summarizeSkipped(result.skipped)})`,
    };
  }
  return {
    changed: true,
    content: result.content,
    applied: result.applied,
    skipped: result.skipped.length,
    note: `applied ${result.applied} edit(s)${result.skipped.length ? `, skipped ${result.skipped.length}` : ""}`,
  };
}

function numberLines(content: string): string {
  const lines = content.split("\n");
  const width = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(width)}| ${l}`).join("\n");
}

function briefLine(b: FindingBrief): string {
  const repl = b.replacement ? ` (replacement text: ${b.replacement})` : "";
  return `  L${b.line} | ${b.oldSymbol} -> ${b.newSymbol ?? "(none)"} | rule: ${b.rule} | note: ${b.note}${repl}`;
}

function summarizeSkipped(skipped: { oldText: string; reason: string }[]): string {
  const reasons = skipped.map((s) => s.reason);
  const uniq = [...new Set(reasons)];
  return uniq.join(", ");
}
