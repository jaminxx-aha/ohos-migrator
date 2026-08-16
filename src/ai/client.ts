/**
 * OpenAI-compatible chat client (one thin wrapper around the `openai` SDK).
 *
 * Designed for ANY OpenAI-compatible endpoint — Anthropic-via-proxy, GLM
 * (智谱), Qwen (通义), DeepSeek, Moonshot, local oLLama — so the tool is not
 * locked to one provider. We request `response_format: { type: "json_object" }`
 * (plain JSON mode) rather than `json_schema` strict mode: Chinese providers'
 * OpenAI-compatible APIs broadly support JSON mode but have uneven
 * strict-schema support, so the portable choice wins. The model is prompted to
 * emit `{"edits":[{oldText,newText,reason}]}` and we parse defensively.
 *
 * Transport: the response is consumed as a STREAM (`stream: true`). The PRIMARY
 * timeout is an idle-gap watchdog — if no chunk arrives within `timeoutMs`
 * (env `OHOS_MIGRATOR_AI_TIMEOUT_MS`, default 120s) the stream is aborted,
 * because the model has stalled. This replaces a total wall-clock timeout: a
 * slow-but-steady stream (chunks keep coming) completes in one attempt rather
 * than tripping a blunt 120s cap and retrying; a true stall dies in idleMs. A
 * generous hard total cap (`maxTotalMs`, default 10min) is a backstop so a
 * pathologically slow stream can't run forever, and a 2-attempt client loop
 * self-heals a transient mid-stream stall before surfacing the failure.
 *
 * Logging: every conversation (system+user prompt, streamed response, any
 * error) is appended to `logFile` (default <projectRoot>/logs/ai-conversation.log,
 * gitignored via *.log) so a failed migration can be diagnosed post hoc. The
 * API key is redacted from the block before it is written.
 */

import OpenAI from "openai";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AiEdit } from "./apply-edits.js";

export interface AiClientOpts {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Max idle gap (ms) between stream chunks — the PRIMARY timeout. If no
   *  chunk arrives within this window the stream is aborted (model stalled).
   *  Default 120s. Env OHOS_MIGRATOR_AI_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Hard total cap (ms) — backstop so a slow-but-progressing stream can't
   *  run forever. Default 600s (10min). Env OHOS_MIGRATOR_AI_MAX_TOTAL_MS. */
  maxTotalMs?: number;
  /** Max concurrent file replacements (default 4). */
  concurrency?: number;
  /** Append every AI conversation (prompt + streamed response + any error) to
   *  this file. The API key is redacted. Default
   *  <projectRoot>/logs/ai-conversation.log (gitignored via *.log). */
  logFile?: string;
  /** Sink for each streamed token (delta), so the CLI can echo the model's
   *  reply to the terminal in real time as it arrives — the response is
   *  streamed visibly, not just accumulated silently. Defaults to
   *  `process.stdout.write`; the full response is still accumulated for
   *  parsing + the conversation log regardless. Pass a no-op to silence
   *  (e.g. in tests). */
  onDelta?: (delta: string) => void;
}

export interface RequestEditsResult {
  edits: AiEdit[];
  raw: string;
}

const SYSTEM_PROMPT = `You are a HarmonyOS (OpenHarmony) ArkTS migration engineer. You are given a source file that uses deprecated @ohos / @system APIs, a list of the deprecated call sites (with the SDK's suggested replacement target where known), and SDK .d.ts declaration slices for the deprecated and replacement symbols.

Produce the minimal set of edits that replace each deprecated usage with its non-deprecated equivalent, following the SDK declaration signatures EXACTLY (argument names, types, arity, async vs callback). Do not rewrite unrelated code. Do not add imports unless required for the replacement and they are missing.

Return STRICT JSON only, of the shape:
{"edits": [{ "oldText": "<exact substring copied from the file, long enough to be unique>", "newText": "<replacement substring>", "reason": "<short>" }]}

Rules:
- oldText MUST be an exact substring that appears exactly once in the file. Copy enough surrounding context (e.g. the whole statement) to make it unique.
- newText is the text that replaces that exact substring.
- If you cannot safely fix a finding, omit an edit for it (do not guess).
- Output ONLY the JSON object, no prose, no markdown fences.`;

const DEFAULT_IDLE_MS = 120_000;
const DEFAULT_TOTAL_MS = 600_000;
/** Self-heal a mid-stream stall once before surfacing the failure. */
const STREAM_ATTEMPTS = 2;
/** Default per-token sink: write to stdout so a run shows the model's reply
 *  streaming in real time. (Tests pass a no-op `onDelta` to stay quiet.) */
const defaultStdoutWriter = (s: string): void => {
  process.stdout.write(s);
};

export async function requestEdits(
  client: AiClientOpts,
  user: string,
  retryErrors?: string,
): Promise<RequestEditsResult> {
  const openai = new OpenAI({
    baseURL: client.baseUrl,
    apiKey: client.apiKey,
    maxRetries: 2, // SDK-level retry on connection-setup / 5xx only (NOT mid-stream)
    // No SDK `timeout`: the primary timeout is the streaming idle-gap watchdog
    // below, so a steady-but-slow stream completes while a stall aborts fast.
  });
  const userPayload = retryErrors
    ? `${user}\n\n## Previous attempt failed hvigor compilation with these errors in this file:\n${retryErrors}\nFix the edits so the file compiles.`
    : user;
  const idleMs = client.timeoutMs ?? DEFAULT_IDLE_MS;
  const totalMs = client.maxTotalMs ?? DEFAULT_TOTAL_MS;
  const onDelta = client.onDelta ?? defaultStdoutWriter;

  let raw = "";
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= STREAM_ATTEMPTS; attempt++) {
    try {
      raw = await streamCompletion(openai, {
        model: client.model,
        system: SYSTEM_PROMPT,
        user: userPayload,
        idleMs,
        totalMs,
        onDelta,
      });
      logConversation(client, SYSTEM_PROMPT, userPayload, raw, undefined, attempt);
      return { edits: parseEdits(raw), raw };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      // Retry once on a mid-stream stall / abort (self-heal). The final
      // attempt's error is logged + surfaced below.
    }
  }
  logConversation(client, SYSTEM_PROMPT, userPayload, raw, lastError, STREAM_ATTEMPTS);
  // Surface the failure so the pipeline reverts this file to pre-AI (its
  // catch handles "API failure → leave file at pre-AI"). Previously this
  // returned {edits:[],raw:""} — but that read as "model returned no edits"
  // in the report; throwing makes the network failure explicit.
  throw new Error(`AI request failed after ${STREAM_ATTEMPTS} attempt(s): ${lastError ?? "unknown"}`);
}

/**
 * Stream a chat completion, aborting if no chunk arrives for `idleMs` (stall)
 * or after `totalMs` elapsed (runaway backstop). Returns the concatenated
 * content. Uses an AbortController wired to both timers; a chunk resets the
 * idle window, so only a genuine lack of progress triggers the abort.
 */
async function streamCompletion(
  openai: OpenAI,
  params: {
    model: string;
    system: string;
    user: string;
    idleMs: number;
    totalMs: number;
    onDelta: (delta: string) => void;
  },
): Promise<string> {
  const controller = new AbortController();
  let abortReason: "idle" | "total" | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortReason = "idle";
      controller.abort();
    }, params.idleMs);
  };
  const totalTimer = setTimeout(() => {
    abortReason = "total";
    controller.abort();
  }, params.totalMs);

  let acc = "";
  try {
    // Arm the idle watchdog BEFORE create() so a hung connection-setup (the
    // server accepts the socket but never sends a response) dies in idleMs,
    // not only in the 600s totalTimer. controller.signal is wired into
    // create(), so an idle abort here rejects create() into the catch with
    // abortReason="idle".
    armIdle();
    const stream = await openai.chat.completions.create(
      {
        model: params.model,
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        stream: true,
      },
      { signal: controller.signal },
    );
    armIdle(); // headers arrived (progress) — reset the idle window
    for await (const chunk of stream) {
      armIdle(); // a chunk arrived — reset the idle window
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        acc += delta;
        // Echo each token to the terminal as it arrives so the reply streams
        // visibly (the full text is still accumulated for parsing + the log).
        params.onDelta(delta);
      }
      // A length/content_filter truncation ends the stream normally (no throw)
      // — detect it so the truncated payload enters the retry path instead of
      // being silently recovered as [] by parseEdits (which would bypass the
      // 2-attempt loop and drop every edit the model had already emitted).
      const fr = chunk.choices[0]?.finish_reason;
      if (fr === "length" || fr === "content_filter") {
        throw new Error(`stream truncated by finish_reason=${fr} after ${acc.length} chars`);
      }
    }
    return acc;
  } catch (e) {
    if (abortReason) {
      throw new Error(
        `stream ${abortReason}-timeout (idle=${params.idleMs}ms total=${params.totalMs}ms) after receiving ${acc.length} chars`,
      );
    }
    throw e; // SDK error (connection, 4xx/5xx) — let the client loop retry
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  }
}

/**
 * Append this request/response to the conversation log file. Best-effort — a
 * failing log must never abort the migration. The API key is redacted from the
 * block so a shared/log-leaked file cannot expose it.
 */
function logConversation(
  client: AiClientOpts,
  system: string,
  user: string,
  response: string,
  error: string | undefined,
  attempt: number,
): void {
  if (!client.logFile) return;
  const block = formatLogBlock({
    ts: new Date().toISOString(),
    model: client.model,
    baseUrl: client.baseUrl,
    attempt,
    system,
    user,
    response,
    error,
  });
  const safe = redactSecret(block, client.apiKey);
  try {
    mkdirSync(dirname(client.logFile), { recursive: true });
    appendFileSync(client.logFile, safe + "\n", "utf8");
  } catch {
    // best-effort: swallow fs errors so logging never breaks a migration
  }
}

/** Pure formatter for the conversation-log block (exported for tests). */
export function formatLogBlock(o: {
  ts: string;
  model: string;
  baseUrl: string;
  attempt: number;
  system: string;
  user: string;
  response: string;
  error?: string;
}): string {
  const sep = "─".repeat(72);
  const header =
    `[${o.ts}] attempt=${o.attempt} model=${o.model} base=${o.baseUrl}` +
    `${o.error ? " status=ERROR" : " status=OK"}`;
  return [
    sep,
    header,
    "### system",
    o.system,
    "### user",
    o.user,
    "### response",
    o.response || "(empty)",
    ...(o.error ? ["### error", o.error] : []),
    sep,
  ].join("\n");
}

/**
 * Replace every occurrence of `secret` in `text` with `[REDACTED]`. No-op when
 * the secret is missing/short (<8 chars) so a tiny or empty value can't
 * accidentally clobber a common substring. Also scrubs server-masked echoes
 * (e.g. a 401 body that prints "sk-abcd…wxyz") that share only the key's
 * prefix/suffix and so escape the full-key match. Exported for tests.
 */
export function redactSecret(text: string, secret?: string): string {
  if (!secret || secret.length < 8) return text;
  // Exact full key:
  let out = text.split(secret).join("[REDACTED]");
  // Masked form (prefix…suffix, 2-4 dots) echoed in provider error bodies:
  out = out.replace(/sk-[A-Za-z0-9_-]{1,20}\.{2,4}[A-Za-z0-9_-]{1,20}/g, "[REDACTED]");
  return out;
}

/** Defensively parse `{"edits":[...]}` from model output. */
export function parseEdits(raw: string): AiEdit[] {
  if (!raw) return [];
  let text = raw.trim();
  // Strip accidental markdown fences.
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    // Some models wrap JSON in prose; try to slice the first {...} block.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(text.slice(start, end + 1));
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }
  const edits = (obj as { edits?: unknown })?.edits;
  if (!Array.isArray(edits)) return [];
  const out: AiEdit[] = [];
  for (const e of edits) {
    if (typeof e !== "object" || e === null) continue;
    const oldText = (e as { oldText?: unknown }).oldText;
    const newText = (e as { newText?: unknown }).newText;
    if (typeof oldText === "string" && typeof newText === "string") {
      out.push({
        oldText,
        newText,
        reason: typeof (e as { reason?: unknown }).reason === "string" ? (e as { reason: string }).reason : undefined,
      });
    }
  }
  return out;
}
