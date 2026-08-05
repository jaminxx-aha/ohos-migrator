/**
 * Rewriter: apply safe auto-fixes.
 *
 * Two kinds of edits:
 *   - `rewrite-import`: replace the quoted import specifier (old kit -> new kit)
 *     at exact offsets from the import extractor. Bindings/call sites untouched.
 *   - `override`: replace a matched member symbol `<binding>.<member>` at its
 *     match offsets with a data-driven replacement (e.g. router.pushUrl ->
 *     this.getUIContext().getRouter().pushUrl).
 *   - `rename-member`: same-kit member rename (e.g. router.push ->
 *     router.pushUrl, Window.create -> Window.createWindow) — splice the new
 *     member chain at the match offsets.
 *
 * Edits within a file are applied bottom-up so earlier offsets stay valid.
 * `manual` findings are never auto-written. Default is dry-run; `--write`
 * persists.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractImports } from "../scanner/import-extractor.js";
import type { Finding } from "../rules/types.js";

export interface RewriteResult {
  changedFiles: ChangedFile[];
  skippedManual: number;
}

export interface ChangedFile {
  file: string;
  edits: { line: number; from: string; to: string }[];
  diff: string;
}

export function rewriteProject(
  projectRoot: string,
  findings: Finding[],
  options: { write: boolean },
): RewriteResult {
  const importFindings = findings.filter(
    (f) => f.rule === "rewrite-import" && f.newSymbol,
  );
  const memberFindings = findings.filter(
    (f) =>
      (f.rule === "override" || f.rule === "rename-member" || f.rule === "rename-export") &&
      f.replacement != null &&
      f.matchStart != null &&
      f.matchEnd != null,
  );
  const skippedManual = findings.filter((f) => f.needsManual).length;

  // Group all auto-fixable findings by file.
  const byFile = new Map<string, Finding[]>();
  for (const f of [...importFindings, ...memberFindings]) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }

  const changedFiles: ChangedFile[] = [];
  for (const [relFile, fileFindings] of byFile) {
    const absPath = join(projectRoot, ...relFile.split("/"));
    const content = readFileSync(absPath, "utf8");
    const imports = extractImports(content);

    type Edit = { start: number; end: number; text: string; line: number; from: string; to: string };
    const edits: Edit[] = [];

    for (const f of fileFindings) {
      if (f.rule === "rewrite-import") {
        const imp = imports.find((i) => i.line === f.line && i.specifier === f.oldSymbol);
        if (!imp) continue;
        const quote = content[imp.specStart];
        edits.push({
          start: imp.specStart,
          end: imp.specEnd,
          text: `${quote}${f.newSymbol}${quote}`,
          line: f.line,
          from: f.oldSymbol,
          to: f.newSymbol!,
        });
      } else if (f.rule === "override" || f.rule === "rename-member" || f.rule === "rename-export") {
        edits.push({
          start: f.matchStart!,
          end: f.matchEnd!,
          text: f.replacement!,
          line: f.line,
          from: f.oldSymbol,
          to: f.replacement!,
        });
      }
    }
    if (edits.length === 0) continue;

    // Drop overlapping edits. Member-chain matches can nest: e.g. a class
    // rename `rpc.MessageParcel` and its method `rpc.MessageParcel.create`
    // both match the same call site, and applying both corrupts the text
    // (`...createte()`). Keep the longest (most specific) match per span and
    // discard any edit whose range it subsumes or overlaps.
    const deduped = dedupeOverlapping(edits);

    deduped.sort((a, b) => b.start - a.start);
    let next = content;
    for (const e of deduped) {
      next = next.slice(0, e.start) + e.text + next.slice(e.end);
    }

    if (options.write) writeFileSync(absPath, next, "utf8");
    changedFiles.push({
      file: relFile,
      edits: deduped.map((e) => ({ line: e.line, from: e.from, to: e.to })),
      diff: renderDiff(content, next, deduped),
    });
  }

  return { changedFiles, skippedManual };
}

/**
 * Remove edits whose range overlaps an earlier (longer / more specific) edit.
 * Edits are ordered by start ascending, then by end descending so the longest
 * match at a given offset wins. An edit is dropped when it starts before the
 * previous kept edit ends (containment or partial overlap). Touching ranges
 * (start == prev end) are kept — they are adjacent, independent edits.
 */
function dedupeOverlapping<T extends { start: number; end: number }>(edits: T[]): T[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: T[] = [];
  const seen = new Set<string>();
  for (const e of sorted) {
    const key = `${e.start}\0${e.end}`;
    if (seen.has(key)) continue; // duplicate exact span (keep first)
    if (kept.length && e.start < kept[kept.length - 1].end) continue; // overlaps
    seen.add(key);
    kept.push(e);
  }
  return kept;
}

function renderDiff(
  before: string,
  after: string,
  edits: { line: number; from: string; to: string }[],
): string {
  const lines: string[] = [];
  for (const e of edits) {
    lines.push(`  line ${e.line}:`);
    lines.push(`  - ${lineText(before, e.line)}`);
    lines.push(`  + ${lineText(after, e.line)}`);
  }
  return lines.join("\n");
}

/** Return the trimmed text of a 1-based line number. */
function lineText(content: string, line1: number): string {
  return content.split("\n")[line1 - 1]?.trim() ?? "";
}
