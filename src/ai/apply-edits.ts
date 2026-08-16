/**
 * Apply AI-produced targeted edits (`{oldText, newText}`) to a file's content.
 *
 * The model is instructed to make each `oldText` a **unique** anchor (enough
 * surrounding context that it matches exactly one place in the file). We
 * enforce that here: an edit whose `oldText` appears 0 times is dropped as
 * `notFound`; one that appears >1 times is dropped as `ambiguous` (the model
 * gave too short an anchor). Only edits that match exactly once are applied.
 *
 * Applied edits are de-overlapped (longest/most-specific wins, mirroring
 * `rewriter.ts`'s `dedupeOverlapping`) and spliced bottom-up so earlier
 * offsets stay valid. The result is a deterministic, auditable transformation
 * — never a "the model rewrote whatever it felt like" whole-file overwrite.
 */

export interface AiEdit {
  oldText: string;
  newText: string;
  reason?: string;
}

export interface SkippedEdit {
  oldText: string;
  reason: "notFound" | "ambiguous";
  occurrences: number;
}

export interface ApplyResult {
  content: string;
  applied: number;
  skipped: SkippedEdit[];
}

interface Candidate extends AiEdit {
  start: number;
  end: number;
}

export function applyTargetedEdits(content: string, edits: AiEdit[]): ApplyResult {
  const skipped: SkippedEdit[] = [];
  const candidates: Candidate[] = [];

  for (const e of edits) {
    if (!e.oldText) {
      skipped.push({ oldText: e.oldText ?? "", reason: "notFound", occurrences: 0 });
      continue;
    }
    const occ = countOccurrences(content, e.oldText);
    if (occ === 1) {
      const start = content.indexOf(e.oldText);
      candidates.push({ ...e, start, end: start + e.oldText.length });
    } else {
      skipped.push({
        oldText: e.oldText,
        reason: occ === 0 ? "notFound" : "ambiguous",
        occurrences: occ,
      });
    }
  }

  // De-overlap: an edit whose span overlaps a kept (longer / earlier) edit is
  // dropped. Same algorithm as rewriter.ts dedupeOverlapping.
  const sorted = [...candidates].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Candidate[] = [];
  for (const c of sorted) {
    if (kept.length) {
      const prev = kept[kept.length - 1];
      if (c.start < prev.end && c.end > prev.start) {
        // overlaps an already-kept edit → drop (treat as ambiguous context)
        skipped.push({ oldText: c.oldText, reason: "ambiguous", occurrences: 1 });
        continue;
      }
    }
    kept.push(c);
  }

  // Apply bottom-up (highest offset first) so earlier offsets stay valid.
  kept.sort((a, b) => b.start - a.start);
  let next = content;
  for (const c of kept) {
    next = next.slice(0, c.start) + c.newText + next.slice(c.end);
  }

  return { content: next, applied: kept.length, skipped };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}
