/**
 * Post-rewrite verification + revert gate.
 *
 * After the CLI applies the "obviously-correct" subset, `runHvigor` compiles the
 * project once. This module attributes any newly-introduced ArkTS errors back
 * to the edits that caused them and reverts just those edits (rewriting the
 * file from its ORIGINAL content with only the surviving edits), so the
 * on-disk output is guaranteed to compile — anything that didn't survive goes
 * back to its pre-rewrite (deprecated-but-compiling) state, left for `--use-ai`.
 *
 * Attribution is line-based. The subset only contains edits that add NO
 * newlines (same-kit member rename splices a member chain on one line;
 * whole-kit import swap replaces a quoted specifier on one line), so line
 * numbers are stable across the rewrite: an hvigor error at `(file, line)`
 * points at the same source line before and after the edit.
 *
 *   - `rename-member`: an error on `f.line` → that edit is broken.
 *   - `rewrite-import`: a broken swap surfaces as errors on the *usage* lines
 *     (members that don't exist in the new kit), not the import line. So a
 *     file that has unattributed errors (errors on lines that no member edit
 *     sits on) AND has an import-swap edit → the file's import-swap edit is
 *     reverted. Conservative: reverting a correct swap just leaves the
 *     deprecated kit (still compiles), so it never breaks the output.
 *
 * Errors that fall on lines with no subset edit, in a file with no import-swap
 * edit, are treated as pre-existing / unrelated and do NOT trigger a revert —
 * we don't attribute what we didn't touch.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { relative, sep } from "node:path";
import { rewriteProject } from "./rewriter.js";
import type { Finding, DeprecationMap } from "../rules/types.js";
import type { HvigorResult } from "../verify/hvigor.js";

export interface VerifyRevertResult {
  /** Edits that survived verification (still applied on disk). */
  kept: Finding[];
  /** Edits reverted because they introduced compile errors. */
  reverted: Finding[];
  /** Whether hvigor actually ran. False → no verification, subset kept as-is. */
  hvigorRan: boolean;
  /** When hvigorRan is false, why. */
  reason?: string;
}

/**
 * Revert any subset edit whose application introduced an ArkTS error.
 *
 * `originalContents` must hold the pre-rewrite text for every file in
 * `applied`; `applied` is the subset that was just written to disk.
 * Re-applies only the surviving `kept` edits from the originals so the disk
 * state is exactly "original + kept".
 */
export function revertBrokenEdits(
  projectRoot: string,
  originalContents: Map<string, string>,
  applied: Finding[],
  hvigor: HvigorResult,
  _map: DeprecationMap,
): VerifyRevertResult {
  if (!hvigor.ran) {
    return {
      kept: applied,
      reverted: [],
      hvigorRan: false,
      reason: hvigor.reason ?? "hvigor did not run",
    };
  }

  // hvigor paths are absolute; findings are project-relative (forward slash).
  const errorsByRelFile = new Map<string, Set<number>>();
  for (const [absPath, lines] of hvigor.errors) {
    const rel = relative(projectRoot, absPath).split(sep).join("/");
    if (!rel || rel.startsWith("..")) continue; // error outside project root
    errorsByRelFile.set(rel, new Set(lines));
  }

  const broken = new Set<Finding>();

  // Group applied findings by file for per-file attribution.
  const byFile = new Map<string, Finding[]>();
  for (const f of applied) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }

  for (const [relFile, fileFindings] of byFile) {
    const errLines = errorsByRelFile.get(relFile);
    if (!errLines || errLines.size === 0) continue; // clean file

    const memberEdits = fileFindings.filter((f) => f.rule === "rename-member");
    const importEdits = fileFindings.filter((f) => f.rule === "rewrite-import");
    const memberLines = new Set(memberEdits.map((f) => f.line));

    let unattributed = false;
    for (const line of errLines) {
      if (memberLines.has(line)) {
        // Error lands on a member-rename edit's line → that edit is broken.
        for (const f of memberEdits) {
          if (f.line === line) broken.add(f);
        }
      } else {
        unattributed = true;
      }
    }

    // Import-swap special case: an unattributed error in a file that has an
    // import swap means the swap broke a usage on another line → revert it.
    if (unattributed && importEdits.length > 0) {
      for (const f of importEdits) broken.add(f);
    }
  }

  const kept = applied.filter((f) => !broken.has(f));
  const reverted = [...broken];

  // Re-apply from originals: restore every touched file to its pre-rewrite
  // content, then apply only `kept` via the shared rewriter (which re-reads
  // disk). Files whose every edit was reverted are simply restored.
  for (const [relFile, content] of originalContents) {
    const abs = join(projectRoot, ...relFile.split("/"));
    writeFileSync(abs, content, "utf8");
  }
  if (kept.length > 0) {
    rewriteProject(projectRoot, kept, { write: true });
  }

  return { kept, reverted, hvigorRan: true };
}
