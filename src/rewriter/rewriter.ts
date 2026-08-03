/**
 * Rewriter: apply safe `rewrite-import` fixes.
 *
 * For each rewrite-import finding we replace the quoted import specifier
 * (old kit -> new kit) at the exact offsets returned by the import extractor,
 * leaving bindings and call sites untouched. Files are processed one at a
 * time; edits within a file are applied from the bottom up so earlier offsets
 * stay valid. `manual` findings are never auto-written.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractImports } from "../scanner/import-extractor.js";
import type { Finding } from "../rules/types.js";

export interface RewriteResult {
  /** Files changed (when --write) or that would change (dry-run). */
  changedFiles: ChangedFile[];
  skippedManual: number;
}

export interface ChangedFile {
  file: string;
  /** Per-edit details. */
  edits: { line: number; oldSpecifier: string; newSpecifier: string }[];
  /** Unified-diff-ish preview (old vs new around each edit). */
  diff: string;
}

export function rewriteProject(
  projectRoot: string,
  findings: Finding[],
  options: { write: boolean },
): RewriteResult {
  const rewriteFindings = findings.filter((f) => f.rule === "rewrite-import" && f.newSymbol);
  const skippedManual = findings.filter((f) => f.needsManual).length;

  // Group by file.
  const byFile = new Map<string, Finding[]>();
  for (const f of rewriteFindings) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }

  const changedFiles: ChangedFile[] = [];
  for (const [relFile, fileFindings] of byFile) {
    const absPath = join(projectRoot, ...relFile.split("/"));
    const content = readFileSync(absPath, "utf8");
    const imports = extractImports(content);

    // Match findings to import offsets by (line, oldSpecifier).
    const edits: { start: number; end: number; newLiteral: string; line: number; oldSpecifier: string; newSpecifier: string }[] = [];
    for (const f of fileFindings) {
      const imp = imports.find((i) => i.line === f.line && i.specifier === f.oldSymbol);
      if (!imp) continue; // stale finding; skip
      const quote = content[imp.specStart];
      edits.push({
        start: imp.specStart,
        end: imp.specEnd,
        newLiteral: `${quote}${f.newSymbol}${quote}`,
        line: f.line,
        oldSpecifier: f.oldSymbol,
        newSpecifier: f.newSymbol!,
      });
    }
    if (edits.length === 0) continue;

    // Apply bottom-up.
    edits.sort((a, b) => b.start - a.start);
    let next = content;
    for (const e of edits) {
      next = next.slice(0, e.start) + e.newLiteral + next.slice(e.end);
    }

    if (options.write) writeFileSync(absPath, next, "utf8");
    changedFiles.push({
      file: relFile,
      edits: edits.map((e) => ({ line: e.line, oldSpecifier: e.oldSpecifier, newSpecifier: e.newSpecifier })),
      diff: renderDiff(content, next, edits),
    });
  }

  return { changedFiles, skippedManual };
}

function renderDiff(
  before: string,
  after: string,
  edits: { line: number; oldSpecifier: string; newSpecifier: string }[],
): string {
  const lines: string[] = [];
  for (const e of edits) {
    lines.push(`  line ${e.line}: '${e.oldSpecifier}' -> '${e.newSpecifier}'`);
  }
  void before;
  void after;
  return lines.join("\n");
}
