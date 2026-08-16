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
import { createLsVerifier, readFileText } from "../verify/ts-ls-verify.js";
import type { AiClientOpts } from "./client.js";
import type { Finding, DeprecationMap } from "../rules/types.js";

export interface AiRewriteResult {
  appliedFiles: number;
  retriedFiles: number;
  stillFailedFiles: number;
  perFile: { file: string; applied: number; status: "applied" | "reverted" | "failed" }[];
  hvigorRan: boolean;
  /** Which verifier grounded the edits: whole-project hvigor, or (for `--file`)
   *  the TS-LS single-file diagnostics delta. */
  verifyMode?: "hvigor" | "ts-ls";
  reason?: string;
  /** True iff the model was actually invoked for at least one file (residuals
   *  existed after the deterministic pass). False when every finding was
   *  auto-fixable and the deterministic splice did all the work. */
  aiInvoked?: boolean;
}

interface FileJob {
  file: string;
  findings: Finding[];
  preAi: string;
  applied: number;
  status: "applied" | "reverted" | "failed";
  /** Whether the model was invoked for this file (residuals > 0). */
  aiInvoked: boolean;
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
  /** When set (the `--file` path), verify with the TS-LS single-file delta
   *  instead of a whole-project hvigor compile. */
  scopedFile?: string,
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
    jobs.push({ file, findings, preAi, applied: 0, status: "reverted", aiInvoked: false });
  }

  // For `--file`, verify with the TS LanguageService (single-file diagnostics
  // delta) PLUS an hvigor fallback. Snapshot the TS-LS baseline (pre-edit
  // diagnostics) now — the file on disk is still the pre-AI content. TS-LS
  // alone misses arkts-* spec rules; lsVerifyRoundWithHvigorFallback below adds
  // an hvigor fallback for files TS-LS clears.
  const useLs = scopedFile !== undefined;
  const lsVer = useLs ? createLsVerifier(projectRoot, scopedFile!, map) : undefined;
  if (lsVer) lsVer.baseline();

  // 2. Round 1: AI-edit each file, write to disk.
  await mapPool(jobs, concurrency, async (job) => {
    try {
      const out = await aiReplaceFile(
        { file: job.file, findings: job.findings, map, projectRoot },
        aiOpts,
      );
      job.applied = out.applied;
      job.aiInvoked = out.aiInvoked;
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

  // 3. Ground-truth verify (run 1). `--file` uses the TS-LS single-file delta;
  //    otherwise the whole-project hvigor compile. Both produce a relFile ->
  //    error-text map consumed by the same revert/retry logic below.
  let verifyRan: boolean;
  let verifyReason: string | undefined;
  let fileErrors1: Map<string, string>;
  if (useLs) {
    const r = lsVerifyRoundWithHvigorFallback(lsVer, jobs, projectRoot);
    verifyRan = r.ran;
    verifyReason = r.reason;
    fileErrors1 = r.fileErrors;
  } else {
    const hv1 = runHvigor({ projectRoot });
    verifyRan = hv1.ran;
    verifyReason = hv1.reason;
    fileErrors1 = hv1.ran ? groupRawByFile(hv1.raw, projectRoot) : new Map();
  }
  if (!verifyRan) {
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
      verifyMode: useLs ? "ts-ls" : "hvigor",
      reason: verifyReason ?? "verifier unavailable",
      aiInvoked: jobs.some((j) => j.aiInvoked),
    };
  }

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
      job.aiInvoked = out.aiInvoked;
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

  // 6. Final verify (run 2); revert any file still broken after retry.
  if (needRetry.length > 0) {
    let fileErrors2: Map<string, string>;
    if (useLs) {
      fileErrors2 = lsVerifyRoundWithHvigorFallback(lsVer, needRetry, projectRoot).fileErrors;
    } else {
      const hv2 = runHvigor({ projectRoot });
      fileErrors2 = hv2.ran ? groupRawByFile(hv2.raw, projectRoot) : new Map();
    }
    for (const job of needRetry) {
      if (job.status === "applied" && fileErrors2.has(job.file)) {
        writeFileSync(join(projectRoot, ...job.file.split("/")), job.preAi, "utf8");
        job.status = "failed";
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
    verifyMode: useLs ? "ts-ls" : "hvigor",
    aiInvoked: jobs.some((j) => j.aiInvoked),
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
    } else if (line.startsWith(" ") && !line.includes("WARN")) {
      // Accumulate error-message lines (they lead with a space, e.g.
      // " Classes cannot be used as objects (arkts-no-classes-as-obj)") to
      // flush at the next "At File:" marker. Exclude ArkTS:WARN lines —
      // those are deprecation warnings (the expected scanner signal), not
      // build-breaking errors, and letting them into the buffer would drown
      // the real error text fed back to the AI retry.
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

/** TS-LS verify round: for each applied job, check its on-disk edited content
 *  against the pre-edit baseline; collect files that introduced new errors. */
function lsVerifyRound(
  lsVer: ReturnType<typeof createLsVerifier>,
  jobs: FileJob[],
  projectRoot: string,
): { ran: boolean; reason?: string; fileErrors: Map<string, string> } {
  if (!lsVer) {
    return {
      ran: false,
      reason: "TS-LS verifier unavailable (SDK absent)",
      fileErrors: new Map(),
    };
  }
  const fileErrors = new Map<string, string>();
  for (const job of jobs) {
    if (job.status !== "applied") continue;
    const edited = readFileText(projectRoot, job.file);
    if (!edited) continue;
    const newErrors = lsVer.check(edited);
    if (newErrors.length > 0) fileErrors.set(job.file, newErrors.join("\n"));
  }
  return { ran: true, fileErrors };
}

/**
 * TS-LS verify round with an hvigor fallback for ArkTS spec rules.
 *
 * TS-LS only emits syntactic + semantic (type) diagnostics — it does NOT
 * enforce ArkTS specification rules (arkts-no-misplaced-imports,
 * arkts-no-any, arkts-no-as, …), which are an extra lint layer only hvigor
 * CompileArkTS runs. So a TS-LS "clean" file can still be arkts-broken (e.g.
 * the AI placed a new import after a `declare` statement, which type-checks
 * fine but violates arkts-no-misplaced-imports). For every file TS-LS cleared,
 * fall back to hvigor to catch arkts-* regressions the delta missed. Files
 * TS-LS failed are kept as-is: faster feedback for type errors, and hvigor
 * would surface the same type errors anyway.
 *
 * hvigor is whole-project, but errors are only attributed to AI-touched files
 * TS-LS cleared (via groupRawByFile's per-file grouping) — pre-existing errors
 * elsewhere don't interfere. Assumes the pre-edit baseline compiled (no ERROR);
 * for `--file` that holds because the corpus/real file is compilable before the
 * AI edit, so any ERROR hvigor reports on a touched file was introduced by AI.
 */
function lsVerifyRoundWithHvigorFallback(
  lsVer: ReturnType<typeof createLsVerifier>,
  jobs: FileJob[],
  projectRoot: string,
): { ran: boolean; reason?: string; fileErrors: Map<string, string> } {
  const r = lsVerifyRound(lsVer, jobs, projectRoot);
  if (!r.ran) return r;
  const tsClean = jobs.filter((j) => j.status === "applied" && !r.fileErrors.has(j.file));
  if (tsClean.length === 0) return r; // TS-LS already flagged every applied file
  const hv = runHvigor({ projectRoot });
  if (!hv.ran) return r; // hvigor unavailable — keep TS-LS verdict (may miss arkts-*)
  const hvErrs = groupRawByFile(hv.raw, projectRoot);
  const merged = new Map(r.fileErrors);
  for (const j of tsClean) {
    const e = hvErrs.get(j.file);
    if (e) merged.set(j.file, e);
  }
  return { ran: true, reason: r.reason, fileErrors: merged };
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
