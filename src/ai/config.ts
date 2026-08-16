/**
 * AI client config: dotenv-style `.env` file + `process.env`.
 *
 * `--use-ai` needs baseUrl/apiKey/model (+optional concurrency/timeoutMs).
 * This follows the standard dotenv flow: a `.env` file is LOADED into
 * `process.env` at startup via Node's built-in `process.loadEnvFile` (existing
 * env vars are NOT overridden), then we read `process.env`. CLI flags override
 * env. `OPENAI_*` are a fallback alias set.
 *
 * File load order (first existing wins):
 *   1. `--env-file <path>`
 *   2. `<projectRoot>/.env`
 *   3. `./.env` (cwd)
 *   4. `~/.env`
 *
 * Per-field precedence AFTER load:
 *   flag > OHOS_MIGRATOR_AI_* env > OPENAI_* env
 * (the `.env` file has already merged into `process.env`, so it participates as
 *  env; shell-set vars win over the file because `loadEnvFile` never overrides
 *  existing env — which is the desired dotenv semantics.)
 *
 * The live `.env` holds the API key → gitignored. `.env.example` is the
 * committed template.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  concurrency?: number;
  /** Max idle gap (ms) between stream chunks — the primary AI timeout. Env
   *  OHOS_MIGRATOR_AI_TIMEOUT_MS (default 120000). */
  timeoutMs?: number;
  /** Hard total cap (ms) — backstop for a slow-but-progressing stream. Env
   *  OHOS_MIGRATOR_AI_MAX_TOTAL_MS (default 600000). */
  maxTotalMs?: number;
  /** Conversation log path (prompt + streamed response + errors; key redacted).
   *  Defaults to <projectRoot>/logs/ai-conversation.log. Set to /dev/null to
   *  silence. Env OHOS_MIGRATOR_AI_LOG_FILE / flag --ai-log-file. */
  logFile?: string;
}

export interface AiConfigFlags {
  envFile?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  aiLogFile?: string;
}

export const CONFIG_FILENAME = ".env";

/** Node's built-in dotenv loader (Node 20.6+). Typed loosely for portability. */
type LoadEnvFile = (path?: string) => void;
const loadEnvFile: LoadEnvFile | undefined =
  typeof (process as { loadEnvFile?: unknown }).loadEnvFile === "function"
    ? (process as { loadEnvFile: LoadEnvFile }).loadEnvFile
    : undefined;

/**
 * Load the `.env` file into `process.env` (does NOT override existing vars).
 * Returns whether/where it loaded. Malformed or missing files are silently
 * skipped (caller falls through to bare env).
 */
export function loadAiEnv(
  explicit?: string,
  projectRoot?: string,
): { loaded: boolean; path?: string } {
  if (!loadEnvFile) return { loaded: false };
  const candidates = explicit ? [explicit] : discoverEnvPaths(projectRoot);
  for (const p of candidates) {
    if (!p || !existsSync(p)) continue;
    try {
      loadEnvFile(p);
      return { loaded: true, path: p };
    } catch {
      // malformed .env → ignore, fall through to bare env
    }
  }
  return { loaded: false };
}

/** Discovery paths (project-local first, then cwd, then home) when no --env-file. */
export function discoverEnvPaths(projectRoot?: string): string[] {
  const out: string[] = [];
  if (projectRoot) out.push(join(projectRoot, CONFIG_FILENAME));
  out.push(join(process.cwd(), CONFIG_FILENAME));
  out.push(join(homedir(), CONFIG_FILENAME));
  return out;
}

/**
 * Resolve the full AI config. Returns undefined when any of baseUrl/apiKey/model
 * is missing across all sources (caller warns + skips AI). Loads the `.env` file
 * first so its values appear in `process.env`.
 */
export function resolveAiConfig(
  flags: AiConfigFlags,
  projectRoot?: string,
): AiConfig | undefined {
  loadAiEnv(flags.envFile, projectRoot);

  const baseUrl = first(
    flags.aiBaseUrl,
    process.env.OHOS_MIGRATOR_AI_BASE_URL,
    process.env.OPENAI_BASE_URL,
    process.env.OPENAI_API_BASE,
  );
  const apiKey = first(
    flags.aiApiKey,
    process.env.OHOS_MIGRATOR_AI_API_KEY,
    process.env.OPENAI_API_KEY,
  );
  const model = first(
    flags.aiModel,
    process.env.OHOS_MIGRATOR_AI_MODEL,
    process.env.OPENAI_MODEL,
  );
  if (!baseUrl || !apiKey || !model) return undefined;
  const rawLogFile = first(flags.aiLogFile, process.env.OHOS_MIGRATOR_AI_LOG_FILE) ?? defaultLogFile(projectRoot);
  const logFile = sanitizeLogFile(rawLogFile, projectRoot);
  return {
    baseUrl,
    apiKey,
    model,
    concurrency: envNum("OHOS_MIGRATOR_AI_CONCURRENCY"),
    timeoutMs: envNum("OHOS_MIGRATOR_AI_TIMEOUT_MS"),
    maxTotalMs: envNum("OHOS_MIGRATOR_AI_MAX_TOTAL_MS"),
    logFile,
  };
}

/** Default conversation-log path: <projectRoot>/logs/ai-conversation.log
 *  (falls back to cwd when projectRoot is unknown). The file is gitignored via
 *  the repo's `*.log` rule, so the conversation is never committed. */
function defaultLogFile(projectRoot?: string): string {
  const base = projectRoot ?? process.cwd();
  return join(base, "logs", "ai-conversation.log");
}

/**
 * Validate + normalize the conversation-log path. Two defenses:
 *
 *   1. Cross-platform disable sentinels (/dev/null, nul, off, none) →
 *      undefined, silencing logging on ALL platforms. (/dev/null only discards
 *      on POSIX; on Windows it would create a stray <drive>:\dev\null file.)
 *
 *   2. Containment: the path MUST end in .log. This blocks rc/dotfile targets
 *      (.zshrc / .bashrc / .profile / .env / …) — if the migrator appended
 *      attacker-controlled migrated source (the file content is logged
 *      verbatim) to such a file, the shell would source + execute it on next
 *      start → RCE. A .log file is never auto-sourced by any shell. A path
 *      that doesn't end in .log falls back to the safe default rather than
 *      being honored, regardless of source (flag, env, or discovered .env) —
 *      this closes the supply-chain vector where a cloned repo's .env sets
 *      OHOS_MIGRATOR_AI_LOG_FILE=.zshrc.
 */
export function sanitizeLogFile(raw: string, projectRoot?: string): string | undefined {
  const lf = raw.trim().toLowerCase();
  if (lf === "" || lf === "/dev/null" || lf === "nul" || lf === "off" || lf === "none") {
    return undefined;
  }
  if (!lf.endsWith(".log")) return defaultLogFile(projectRoot);
  return raw;
}

export interface EnvTemplateField {
  name: string;
  label: string;
  /** Whether the value was populated (from env when fromEnv, else always false). */
  filled: boolean;
}

export interface EnvTemplateResult {
  path: string;
  content: string;
  fields: EnvTemplateField[];
}

/**
 * Write a dotenv `.env` template at `outPath`. When `fromEnv` is true
 * (default), populate values from the current environment; missing values are
 * written as empty single-quoted placeholders. Single quotes are used so `$`
 * in values is treated literally (no var expansion). Returns what was written.
 */
export function writeEnvTemplate(outPath: string, fromEnv = true): EnvTemplateResult {
  const pick = (names: string[], placeholder = ""): string => {
    if (!fromEnv) return placeholder;
    for (const n of names) {
      const v = process.env[n];
      if (v && v.trim() !== "") return v;
    }
    return placeholder;
  };

  const baseUrl = pick(["OHOS_MIGRATOR_AI_BASE_URL", "OPENAI_BASE_URL", "OPENAI_API_BASE"]);
  const apiKey = pick(["OHOS_MIGRATOR_AI_API_KEY", "OPENAI_API_KEY"]);
  const model = pick(["OHOS_MIGRATOR_AI_MODEL", "OPENAI_MODEL"]);
  const concurrency = pick(["OHOS_MIGRATOR_AI_CONCURRENCY"], "4");
  const timeoutMs = pick(["OHOS_MIGRATOR_AI_TIMEOUT_MS"], "120000");
  const maxTotalMs = pick(["OHOS_MIGRATOR_AI_MAX_TOTAL_MS"], "600000");
  const logFile = pick(["OHOS_MIGRATOR_AI_LOG_FILE"], "");

  const lines = [
    "# ohos-migrator AI client config (dotenv format).",
    "# Load order: --env-file < <projectRoot>/.env < ./.env < ~/.env.",
    "# Existing env vars are NOT overridden by the file.",
    "# Fill the placeholders, then run:",
    "#   harmony-deprecate rewrite --project <path> --write --use-ai",
    `OHOS_MIGRATOR_AI_BASE_URL=${quoteVal(baseUrl)}`,
    `OHOS_MIGRATOR_AI_API_KEY=${quoteVal(apiKey)}`,
    `OHOS_MIGRATOR_AI_MODEL=${quoteVal(model)}`,
    `OHOS_MIGRATOR_AI_CONCURRENCY=${quoteVal(concurrency)}`,
    "# timeoutMs = max idle gap (ms) between stream chunks before abort.",
    `OHOS_MIGRATOR_AI_TIMEOUT_MS=${quoteVal(timeoutMs)}`,
    "# maxTotalMs = hard total cap (ms) — backstop for a slow stream.",
    `OHOS_MIGRATOR_AI_MAX_TOTAL_MS=${quoteVal(maxTotalMs)}`,
    "# logFile = where to append the AI conversation (key redacted).",
    "# Empty = default (<projectRoot>/logs/ai-conversation.log); /dev/null = silence.",
    `OHOS_MIGRATOR_AI_LOG_FILE=${quoteVal(logFile)}`,
  ];
  const content = lines.join("\n") + "\n";
  writeFileSync(outPath, content, "utf8");

  const fields: EnvTemplateField[] = [
    { name: "baseUrl", label: "baseUrl", filled: !!baseUrl },
    { name: "apiKey", label: "apiKey", filled: !!apiKey },
    { name: "model", label: "model", filled: !!model },
  ];
  return { path: outPath, content, fields };
}

/* ---- small utils ---- */

/** dotenv single-quote a value: literal, no $ expansion; escape inner `'`. */
function quoteVal(s: string): string {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function first(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) {
    if (v && String(v).trim() !== "") return v;
  }
  return undefined;
}

function envNum(name: string): number | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
