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

export function printRewriteSummary(result: RewriteResult, write: boolean): string {
  const lines: string[] = [];
  lines.push(write ? "Applied rewrites:" : "Dry-run — would apply rewrites:");
  for (const cf of result.changedFiles) {
    lines.push(`  ${cf.file}`);
    for (const e of cf.edits) {
      lines.push(`    line ${e.line}: '${e.oldSpecifier}' -> '${e.newSpecifier}'`);
    }
  }
  lines.push(`${result.changedFiles.length} file(s) ${write ? "changed" : "would change"}.`);
  lines.push(`${result.skippedManual} manual finding(s) left untouched (need human review).`);
  return lines.join("\n");
}
