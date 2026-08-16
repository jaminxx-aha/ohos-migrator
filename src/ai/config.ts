/**
 * AI client config resolution + config-file (de)serialization.
 *
 * The `--use-ai` path needs three secrets (base URL, API key, model). They are
 * resolved per-field, first-truthy-wins, in this order:
 *
 *   1. explicit CLI flags  (`--ai-base-url` / `--ai-api-key` / `--ai-model`)
 *   2. a config file       (`--ai-config <path>`, else discovered below)
 *   3. tool env vars       (`OHOS_MIGRATOR_AI_BASE_URL` / `_API_KEY` / `_MODEL`)
 *   4. common OpenAI env   (`OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL`)
 *
 * Per-field resolution lets you mix sources (e.g. model from a file, key from
 * the env). If any of the three is missing after all sources, `--use-ai`
 * degrades to a warning and skips AI replacement (never crashes).
 *
 * Config file discovery (when `--ai-config` is not given): the first existing
 * of `<projectRoot>/.ohos-migrator-ai.json`, `./.ohos-migrator-ai.json` (cwd),
 * `~/.ohos-migrator-ai.json`. The file holds `{ baseUrl, apiKey, model,
 * concurrency?, timeoutMs? }`. The real file is gitignored (it carries the key);
 * `.ohos-migrator-ai.example.json` is the committed template.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  concurrency?: number;
  timeoutMs?: number;
}

export interface AiConfigFlags {
  aiConfig?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
}

/** JSON shape stored on disk. */
export interface AiConfigFile {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  concurrency?: number;
  timeoutMs?: number;
}

export const CONFIG_FILENAME = ".ohos-migrator-ai.json";

/**
 * Resolve the full AI config. Returns undefined when any of baseUrl/apiKey/model
 * is missing across all sources (caller warns + skips AI).
 */
export function resolveAiConfig(flags: AiConfigFlags, projectRoot?: string): AiConfig | undefined {
  const file = loadConfigFile(flags.aiConfig, projectRoot);

  const baseUrl = first(
    flags.aiBaseUrl,
    file?.baseUrl,
    process.env.OHOS_MIGRATOR_AI_BASE_URL,
    process.env.OPENAI_BASE_URL,
    process.env.OPENAI_API_BASE,
  );
  const apiKey = first(
    flags.aiApiKey,
    file?.apiKey,
    process.env.OHOS_MIGRATOR_AI_API_KEY,
    process.env.OPENAI_API_KEY,
  );
  const model = first(
    flags.aiModel,
    file?.model,
    process.env.OHOS_MIGRATOR_AI_MODEL,
    process.env.OPENAI_MODEL,
  );
  if (!baseUrl || !apiKey || !model) return undefined;

  const concurrency = firstNum(file?.concurrency, envNum("OHOS_MIGRATOR_AI_CONCURRENCY"));
  const timeoutMs = firstNum(file?.timeoutMs, envNum("OHOS_MIGRATOR_AI_TIMEOUT_MS"));
  return { baseUrl, apiKey, model, concurrency, timeoutMs };
}

/**
 * Load and parse the config file. When `explicit` is given, read exactly that
 * path (returns undefined if absent — caller falls back to env). Otherwise
 * search the discovery paths.
 */
export function loadConfigFile(explicit?: string, projectRoot?: string): AiConfigFile | undefined {
  const candidates = explicit
    ? [explicit]
    : discoverPaths(projectRoot);
  for (const p of candidates) {
    if (!p) continue;
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf8");
      const obj = JSON.parse(raw) as unknown;
      if (obj && typeof obj === "object") return obj as AiConfigFile;
    } catch {
      // malformed config file → ignore, fall through to env
    }
  }
  return undefined;
}

/** Discovery paths (project-local first, then cwd, then home) when no --ai-config. */
export function discoverPaths(projectRoot?: string): string[] {
  const out: string[] = [];
  if (projectRoot) out.push(join(projectRoot, CONFIG_FILENAME));
  out.push(join(process.cwd(), CONFIG_FILENAME));
  out.push(join(homedir(), CONFIG_FILENAME));
  return out;
}

/**
 * Write a config file at `outPath`. When `fromEnv` is true (default), populate
 * fields from the current environment (so `OHOS_MIGRATOR_AI_*` / `OPENAI_*`
 * already set on your machine are captured into a persistent file); missing
 * fields are written as empty placeholders. Returns the written object.
 */
export function writeConfigTemplate(outPath: string, fromEnv = true): AiConfigFile {
  const tmpl: AiConfigFile = fromEnv
    ? {
        baseUrl: process.env.OHOS_MIGRATOR_AI_BASE_URL
          ?? process.env.OPENAI_BASE_URL
          ?? process.env.OPENAI_API_BASE
          ?? "",
        apiKey: process.env.OHOS_MIGRATOR_AI_API_KEY
          ?? process.env.OPENAI_API_KEY
          ?? "",
        model: process.env.OHOS_MIGRATOR_AI_MODEL
          ?? process.env.OPENAI_MODEL
          ?? "",
        concurrency: envNum("OHOS_MIGRATOR_AI_CONCURRENCY") ?? 4,
        timeoutMs: envNum("OHOS_MIGRATOR_AI_TIMEOUT_MS") ?? 120_000,
      }
    : { baseUrl: "", apiKey: "", model: "", concurrency: 4, timeoutMs: 120_000 };
  writeFileSync(outPath, JSON.stringify(tmpl, null, 2) + "\n", "utf8");
  return tmpl;
}

/* ---- small utils ---- */

function first(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) {
    if (v && String(v).trim() !== "") return v;
  }
  return undefined;
}

function firstNum(...vals: (number | undefined)[]): number | undefined {
  for (const v of vals) {
    if (v !== undefined && Number.isFinite(v) && v > 0) return v;
  }
  return undefined;
}

function envNum(name: string): number | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
