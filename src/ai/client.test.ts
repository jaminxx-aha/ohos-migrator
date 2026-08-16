/**
 * Tests for `parseEdits` — the defensive JSON parser for model output.
 * Models occasionally wrap JSON in prose or fences; the parser must recover
 * the `{edits:[...]}` payload or return [] rather than throw.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEdits, formatLogBlock, redactSecret } from "./client.js";

test("parses a clean JSON payload", () => {
  const e = parseEdits(`{"edits":[{"oldText":"a","newText":"b","reason":"x"}]}`);
  assert.equal(e.length, 1);
  assert.equal(e[0].oldText, "a");
  assert.equal(e[0].newText, "b");
  assert.equal(e[0].reason, "x");
});

test("strips markdown fences", () => {
  const e = parseEdits("```json\n{\"edits\":[{\"oldText\":\"a\",\"newText\":\"b\"}]}\n```");
  assert.equal(e.length, 1);
});

test("recovers JSON embedded in prose", () => {
  const e = parseEdits('Here are the edits: {"edits":[{"oldText":"a","newText":"b"}]} hope that helps!');
  assert.equal(e.length, 1);
});

test("returns [] for unparseable input", () => {
  assert.deepEqual(parseEdits("totally not json at all"), []);
});

test("returns [] when edits field is missing", () => {
  assert.deepEqual(parseEdits('{"foo":1}'), []);
});

test("returns [] when edits is not an array", () => {
  assert.deepEqual(parseEdits('{"edits":"nope"}'), []);
});

test("skips edits with non-string oldText/newText", () => {
  const e = parseEdits('{"edits":[{"oldText":"a","newText":123},{"oldText":"b","newText":"c"}]}');
  assert.equal(e.length, 1);
  assert.equal(e[0].newText, "c");
});

test("empty edits array yields []", () => {
  assert.deepEqual(parseEdits('{"edits":[]}'), []);
});

test("empty raw yields []", () => {
  assert.deepEqual(parseEdits(""), []);
});

/* ---- redactSecret ---- */

test("redactSecret redacts a long key everywhere it appears", () => {
  const key = "sk-secret-key-1234567890";
  const text = `header base=https://x key=${key} again ${key}`;
  const out = redactSecret(text, key);
  assert.equal(out, "header base=https://x key=[REDACTED] again [REDACTED]");
  assert.ok(!out.includes(key));
});

test("redactSecret is a no-op for a missing/short secret", () => {
  const text = "nothing secret here";
  assert.equal(redactSecret(text, undefined), text);
  assert.equal(redactSecret(text, "short"), text); // <8 chars → no-op
  assert.equal(redactSecret(text, ""), text);
});

test("redactSecret leaves unrelated text intact", () => {
  const key = "sk-very-long-api-key-value-xyz";
  const text = `model glm base https://dashscope ${key} trailing`;
  const out = redactSecret(text, key);
  assert.ok(out.includes("model glm base https://dashscope"));
  assert.ok(out.includes("trailing"));
});

test("redactSecret scrubs server-masked sk-…echo in error bodies", () => {
  // A 401 body echoes the key masked, not in full — the full-key split misses it.
  const key = "sk-abcd1234efgh5678wxyz";
  const text = `Incorrect API key provided: sk-abcd...wxyz. You can find it at ...`;
  const out = redactSecret(text, key);
  assert.ok(!out.includes("sk-abcd...wxyz"), `masked echo survived: ${out}`);
  assert.ok(out.includes("[REDACTED]"));
});

/* ---- formatLogBlock ---- */

test("formatLogBlock includes header + all sections on success", () => {
  const block = formatLogBlock({
    ts: "2026-08-16T00:00:00.000Z",
    model: "glm-5.2",
    baseUrl: "https://dashscope",
    attempt: 1,
    system: "be helpful",
    user: "fix this",
    response: '{"edits":[]}',
  });
  assert.ok(block.includes("status=OK"));
  assert.ok(!block.includes("status=ERROR"));
  assert.ok(block.includes("attempt=1"));
  assert.ok(block.includes("model=glm-5.2"));
  assert.ok(block.includes("base=https://dashscope"));
  assert.ok(block.includes("### system"));
  assert.ok(block.includes("### user"));
  assert.ok(block.includes("### response"));
  assert.ok(block.includes('{"edits":[]}'));
  assert.ok(!block.includes("### error")); // no error section on success
});

test("formatLogBlock marks ERROR + shows error section when error given", () => {
  const block = formatLogBlock({
    ts: "2026-08-16T00:00:00.000Z",
    model: "glm-5.2",
    baseUrl: "https://dashscope",
    attempt: 2,
    system: "s",
    user: "u",
    response: "",
    error: "stream idle-timeout after receiving 0 chars",
  });
  assert.ok(block.includes("status=ERROR"));
  assert.ok(block.includes("attempt=2"));
  assert.ok(block.includes("### error"));
  assert.ok(block.includes("idle-timeout"));
  assert.ok(block.includes("(empty)")); // empty response → placeholder
});

test("formatLogBlock is bounded by separator lines", () => {
  const block = formatLogBlock({
    ts: "t",
    model: "m",
    baseUrl: "b",
    attempt: 1,
    system: "s",
    user: "u",
    response: "r",
  });
  const sep = "─".repeat(72);
  assert.ok(block.startsWith(sep));
  assert.ok(block.endsWith(sep));
});
