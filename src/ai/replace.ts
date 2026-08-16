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
import { applyFindingsToContent, isAutoFixable } from "../rewriter/rewriter.js";
import type { Finding, DeprecationMap } from "../rules/types.js";

/**
 * Pick the findings that need the AI model's judgment: those the deterministic
 * splice cannot handle (not `isAutoFixable`) AND that are not `humanOnly`.
 * `humanOnly` manuals need a human-chosen argument the model can't supply
 * (e.g. a signature change tightening a param to a literal union) and stay on
 * the deprecated-but-compiling API for review — sending them to the model would
 * either produce a silent-wrong guess or a file-level revert that takes down
 * unrelated AI edits in the same file.
 */
export function selectResiduals(findings: Finding[]): Finding[] {
  return findings.filter((f) => !isAutoFixable(f) && !f.humanOnly);
}

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
  /** True iff the model was actually invoked (residuals > 0). False when the
   *  deterministic splice covered every finding. */
  aiInvoked: boolean;
}

export async function aiReplaceFile(
  input: AiReplaceInput,
  client: AiClientOpts,
  retryErrors?: string,
): Promise<AiReplaceOutcome> {
  const ctx = buildFileContext(input.projectRoot, input.file, input.findings, input.map);

  // 1. Deterministic pass: splice every auto-fixable finding (rewrite-import,
  //    member/override/inject/rename-export with a concrete replacement) into
  //    the content directly — exactly like the subset rewriter. These edits
  //    are computed from SDK metadata, not free-form, and the model applies
  //    such coordinated sets unreliably: on a partial kit-move it skips the
  //    import swap/inject and leaves a pointless binding rename with zero
  //    migration. Splice them ourselves so the binding-split (and every other
  //    deterministic edit) always lands.
  const det = applyFindingsToContent(ctx.fileContent, input.findings);
  const content = det.content;
  const detApplied = det.edits.length;

  // 2. Residuals = findings the deterministic splice cannot handle (no
  //    replacement — genuine manual / signature-change). `humanOnly` findings
  //    are excluded: they need human judgment the model can't supply (e.g. a
  //    signature change requiring a human-chosen argument) and are left on the
  //    deprecated-but-compiling API for review. Only the rest need the model.
  const residuals = selectResiduals(input.findings);
  const aiInvoked = residuals.length > 0;

  if (residuals.length === 0) {
    // The deterministic pass covered everything; no model call needed.
    if (detApplied === 0) {
      return {
        changed: false,
        content: ctx.fileContent,
        applied: 0,
        skipped: 0,
        note: "no auto-fixable findings and no residuals",
        aiInvoked,
      };
    }
    return {
      changed: true,
      content,
      applied: detApplied,
      skipped: 0,
      note: `applied ${detApplied} deterministic edit(s); 0 residuals for AI`,
      aiInvoked,
    };
  }

  // 3. Send ONLY the residuals to the model, on the deterministically-edited
  //    content. Re-derive briefs/slices for the residual set (slices are
  //    kit/member-keyed so unaffected by the in-memory edit; brief line numbers
  //    are from the pre-edit scan — flagged below so the model locates by
  //    symbol text, not line).
  const resCtx = buildFileContext(input.projectRoot, input.file, residuals, input.map);
  const user = [
    `## File: ${input.file} (with line numbers; deterministic import/member edits already applied)`,
    numberLines(content),
    "",
    "## Remaining deprecated call sites needing AI judgment (locate by oldSymbol text — line numbers are from the pre-edit scan and may have shifted)",
    ...resCtx.findingBriefs.map((b) => briefLine(b)),
    "",
    "## SDK declarations (deprecated + replacement, from the SDK .d.ts)",
    resCtx.sdkSlices.length ? resCtx.sdkSlices.join("\n\n") : "(none resolvable — rely on the call-site notes)",
  ].join("\n");

  const { edits, raw } = await requestEdits(client, user, retryErrors);
  const result = applyTargetedEdits(content, edits);

  if (detApplied === 0 && result.applied === 0) {
    return {
      changed: false,
      content: ctx.fileContent,
      applied: 0,
      skipped: result.skipped.length,
      note: edits.length === 0
        ? "model returned no edits"
        : `model returned ${edits.length} edit(s) but none applied (${result.skipped.length} skipped: ${summarizeSkipped(result.skipped)})`,
      aiInvoked,
    };
  }
  return {
    changed: true,
    content: result.content,
    applied: detApplied + result.applied,
    skipped: result.skipped.length,
    note: `applied ${detApplied} deterministic + ${result.applied} AI edit(s)${result.skipped.length ? `, skipped ${result.skipped.length}` : ""}`,
    aiInvoked,
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
