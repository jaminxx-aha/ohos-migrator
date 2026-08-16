/**
 * Batch orchestration for `--use-ai`: apply AI edits to every residual file,
 * ground-truth with hvigor, revert files that broke, and retry those once
 * with the compiler's error feedback. File-level granularity (an AI edit set
 * is multi-site free-form text, so line attribution is unreliable); reverting
 * a broken file restores its pre-AI (= post-subset, already-verified)
 * content, so the output never regresses below the subset baseline.
 *
 * Total hvigor runs ≤ 2 (after round 1, after round 2 retry).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { aiReplaceFile } from "./replace.js";
import { runHvigor } from "../verify/hvigor.js";
import type { AiClientOpts } from "./client.js";
import type { Finding, DeprecationMap } from "../rules/types.js";

export interface AiRewriteResult {
  appliedFiles: number;
  retriedFiles: number;
  stillFailedFiles: number;
  perFile: { file: string; applied: number; status: "applied" | "reverted" | "failed" }[];
  hvigorRan: boolean;
  reason?: string;
}

interface FileJob {
  file: string;
  findings: Finding[];
  preAi: string;
  applied: number;
  status: "applied" | "reverted" | "failed";
}

/**
 * Run AI replacement over all residual files. When `write` is false, the AI
 * is not called (returns an empty result — the caller reports residuals).
 */
export async function runAiRewrite(
  projectRoot: string,
  residualByFile: Map<string, Finding[]>,
  map: DeprecationMap,
  aiOpts: AiClientOpts,
  write: boolean,
): Promise<AiRewriteResult> {
  const empty: AiRewriteResult = {
    appliedFiles: 0, retriedFiles: 0, stillFailedFiles: 0, perFile: [], hvigorRan: false,
  };
  if (!write || residualByFile.size === 0) return empty;

  const concurrency = aiOpts.concurrency && aiOpts.concurrency > 0
    ? Math.min(aiOpts.concurrency, 16)
    : 4;

  // 1. Backup pre-AI (post-subset) content for every residual file.
  const jobs: FileJob[] = [];
  for (const [file, findings] of residualByFile) {
    let preAi = "";
    try {
      preAi = readFileSync(join(projectRoot, ...file.split("/")), "utf8");
    } catch {
      continue; // file unreadable — skip
    }
    jobs.push({ file, findings, preAi, applied: 0, status: "reverted" });
  }

  // 2. Round 1: AI-edit each file, write to disk.
  await mapPool(jobs, concurrency, async (job) => {
    try {
      const out = await aiReplaceFile(
        { file: job.file, findings: job.findings, map, projectRoot },
        aiOpts,
      );
      job.applied = out.applied;
      if (out.changed) {
        writeFileSync(join(projectRoot, ...job.file.split("/")), out.content, "utf8");
        job.status = "applied"; // provisional — pending hvigor
      } else {
        job.status = "reverted"; // model produced nothing applicable; keep pre-AI
      }
    } catch {
      job.status = "reverted"; // API failure → leave file at pre-AI
    }
  });

  // 3. Ground-truth with hvigor (run 1).
  const hv1 = runHvigor({ projectRoot });
  if (!hv1.ran) {
    // No verifier → revert everything AI-touched back to pre-AI (unverified
    // AI edits are never left on disk).
    for (const job of jobs) {
      writeFileSync(join(projectRoot, ...job.file.split("/")), job.preAi, "utf8");
      job.status = "reverted";
    }
    return {
      appliedFiles: 0,
      retriedFiles: 0,
      stillFailedFiles: 0,
      perFile: jobs.map((j) => ({ file: j.file, applied: j.applied, status: j.status })),
      hvigorRan: false,
      reason: hv1.reason ?? "hvigor unavailable",
    };
  }

  const fileErrors1 = groupRawByFile(hv1.raw, projectRoot); // relFile -> error text

  // 4. Revert files that have errors (round-1 survivors stay).
  const needRetry: FileJob[] = [];
  for (const job of jobs) {
    const errs = fileErrors1.get(job.file);
    if (job.status === "applied" && errs) {
      writeFileSync(join(projectRoot, ...job.file.split("/")), job.preAi, "utf8");
      job.status = "reverted";
      needRetry.push(job);
    }
  }

  // 5. Round 2: retry reverted files with hvigor error feedback.
  for (const job of needRetry) {
    try {
      const out = await aiReplaceFile(
        { file: job.file, findings: job.findings, map, projectRoot },
        aiOpts,
        fileErrors1.get(job.file),
      );
      job.applied = out.applied;
      if (out.changed) {
        writeFileSync(join(projectRoot, ...job.file.split("/")), out.content, "utf8");
        job.status = "applied"; // provisional — pending final hvigor
      } else {
        job.status = "failed"; // still nothing applicable → stays pre-AI
      }
    } catch {
      job.status = "failed";
    }
  }

  // 6. Final hvigor (run 2); revert any file still broken after retry.
  if (needRetry.length > 0) {
    const hv2 = runHvigor({ projectRoot });
    if (hv2.ran) {
      const fileErrors2 = groupRawByFile(hv2.raw, projectRoot);
      for (const job of needRetry) {
        if (job.status === "applied" && fileErrors2.has(job.file)) {
          writeFileSync(join(projectRoot, ...job.file.split("/")), job.preAi, "utf8");
          job.status = "failed";
        }
      }
    }
  }

  const appliedFiles = jobs.filter((j) => j.status === "applied").length;
  const retriedFiles = needRetry.length;
  const stillFailedFiles = jobs.filter((j) => j.status === "failed").length;
  return {
    appliedFiles,
    retriedFiles,
    stillFailedFiles,
    perFile: jobs.map((j) => ({ file: j.file, applied: j.applied, status: j.status })),
    hvigorRan: true,
  };
}

/**
 * Group the raw hvigor output into per-relFile error text. The `At File:`
 * marker follows the error message it describes, so we accumulate lines and
 * flush them to the file named by the next `At File:` marker.
 */
export function groupRawByFile(raw: string, projectRoot: string): Map<string, string> {
  const out = new Map<string, string[]>();
  let buf: string[] = [];
  const re = /At File: (\S+):(\d+):(\d+)/;
  const lines = raw.split("\n");
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      const rel = relFile(m[1], projectRoot);
      if (rel) {
        const arr = out.get(rel) ?? [];
        arr.push(`${buf.join(" ").trim()} [line ${m[2]}]`.trim());
        out.set(rel, arr);
      }
      buf = [];
    } else if (line.includes("ERROR") || line.startsWith(" ") || line.includes("ArkTS")) {
      buf.push(line.trim());
    }
  }
  const joined = new Map<string, string>();
  for (const [f, msgs] of out) joined.set(f, msgs.slice(0, 10).join("\n"));
  return joined;
}

function relFile(absOrRel: string, projectRoot: string): string | undefined {  let rel = absOrRel;
  if (absOrRel.startsWith("/")) {
    rel = relative(projectRoot, absOrRel).split(sep).join("/");
    if (rel.startsWith("..") || rel === "") return undefined;
  }
  return rel;
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const cap = Math.max(1, concurrency);
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, () => worker()));
}
