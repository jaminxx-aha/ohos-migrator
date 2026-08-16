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
 */

import OpenAI from "openai";
import type { AiEdit } from "./apply-edits.js";

export interface AiClientOpts {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Per-request timeout ms (default 120s). */
  timeoutMs?: number;
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

export async function requestEdits(
  client: AiClientOpts,
  user: string,
  retryErrors?: string,
): Promise<RequestEditsResult> {
  const openai = new OpenAI({
    baseURL: client.baseUrl,
    apiKey: client.apiKey,
    timeout: client.timeoutMs ?? 120_000,
    maxRetries: 2,
  });

  const userPayload = retryErrors
    ? `${user}\n\n## Previous attempt failed hvigor compilation with these errors in this file:\n${retryErrors}\nFix the edits so the file compiles.`
    : user;

  const completion = await openai.chat.completions.create({
    model: client.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPayload },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  return { edits: parseEdits(raw), raw };
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
