/**
 * Tests for `parseEdits` — the defensive JSON parser for model output.
 * Models occasionally wrap JSON in prose or fences; the parser must recover
 * the `{edits:[...]}` payload or return [] rather than throw.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEdits } from "./client.js";

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
