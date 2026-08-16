/**
 * Tests for AI config resolution (`config.ts`).
 *
 * Precedence is per-field, first-truthy-wins:
 *   flag > config file > OHOS_MIGRATOR_AI_* env > OPENAI_* env
 * These tests mutate `process.env`, so each test snapshots and restores the
 * AI-related keys.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  resolveAiConfig,
  loadConfigFile,
  discoverPaths,
  writeConfigTemplate,
  CONFIG_FILENAME,
} from "./config.js";

const ENV_KEYS = [
  "OHOS_MIGRATOR_AI_BASE_URL",
  "OHOS_MIGRATOR_AI_API_KEY",
  "OHOS_MIGRATOR_AI_MODEL",
  "OHOS_MIGRATOR_AI_CONCURRENCY",
  "OHOS_MIGRATOR_AI_TIMEOUT_MS",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

function clearAiEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "ohos-ai-config-"));
}

test("resolveAiConfig returns undefined when nothing is configured", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  try {
    assert.equal(resolveAiConfig({}), undefined);
  } finally {
    restoreEnv(snap);
  }
});

test("resolveAiConfig returns undefined when a field is missing", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  try {
    // baseUrl + model set, apiKey missing → incomplete.
    process.env.OHOS_MIGRATOR_AI_BASE_URL = "https://x";
    process.env.OHOS_MIGRATOR_AI_MODEL = "m";
    assert.equal(resolveAiConfig({}), undefined);
  } finally {
    restoreEnv(snap);
  }
});

test("resolveAiConfig resolves from OHOS_MIGRATOR_AI_* env", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  try {
    process.env.OHOS_MIGRATOR_AI_BASE_URL = "https://glm";
    process.env.OHOS_MIGRATOR_AI_API_KEY = "k";
    process.env.OHOS_MIGRATOR_AI_MODEL = "glm-4";
    const cfg = resolveAiConfig({});
    assert.equal(cfg?.baseUrl, "https://glm");
    assert.equal(cfg?.apiKey, "k");
    assert.equal(cfg?.model, "glm-4");
  } finally {
    restoreEnv(snap);
  }
});

test("resolveAiConfig falls back to OPENAI_* env", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  try {
    process.env.OPENAI_BASE_URL = "https://oai";
    process.env.OPENAI_API_KEY = "ok";
    process.env.OPENAI_MODEL = "gpt-4o";
    const cfg = resolveAiConfig({});
    assert.equal(cfg?.baseUrl, "https://oai");
    assert.equal(cfg?.apiKey, "ok");
    assert.equal(cfg?.model, "gpt-4o");
  } finally {
    restoreEnv(snap);
  }
});

test("resolveAiConfig: flag wins over file and env", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  const root = tmp();
  try {
    writeFileSync(
      join(root, CONFIG_FILENAME),
      JSON.stringify({ baseUrl: "fromfile", apiKey: "fk", model: "fm" }),
    );
    process.env.OHOS_MIGRATOR_AI_BASE_URL = "fromenv";
    const cfg = resolveAiConfig(
      { aiBaseUrl: "fromflag", aiApiKey: "flagk", aiModel: "flagm" },
      root,
    );
    assert.equal(cfg?.baseUrl, "fromflag");
    assert.equal(cfg?.apiKey, "flagk");
    assert.equal(cfg?.model, "flagm");
  } finally {
    restoreEnv(snap);
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveAiConfig: file wins over env", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  const root = tmp();
  try {
    writeFileSync(
      join(root, CONFIG_FILENAME),
      JSON.stringify({ baseUrl: "fileurl", apiKey: "filek", model: "filem", concurrency: 8 }),
    );
    process.env.OHOS_MIGRATOR_AI_BASE_URL = "envurl";
    const cfg = resolveAiConfig({}, root);
    assert.equal(cfg?.baseUrl, "fileurl");
    assert.equal(cfg?.apiKey, "filek");
    assert.equal(cfg?.model, "filem");
    assert.equal(cfg?.concurrency, 8);
  } finally {
    restoreEnv(snap);
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveAiConfig: per-field mix across sources", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  const root = tmp();
  try {
    // baseUrl from flag, apiKey from file, model from env.
    writeFileSync(join(root, CONFIG_FILENAME), JSON.stringify({ apiKey: "filek" }));
    process.env.OHOS_MIGRATOR_AI_MODEL = "envm";
    const cfg = resolveAiConfig({ aiBaseUrl: "flagurl" }, root);
    assert.equal(cfg?.baseUrl, "flagurl");
    assert.equal(cfg?.apiKey, "filek");
    assert.equal(cfg?.model, "envm");
  } finally {
    restoreEnv(snap);
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveAiConfig treats whitespace-only env values as missing", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  try {
    process.env.OHOS_MIGRATOR_AI_BASE_URL = "   ";
    process.env.OHOS_MIGRATOR_AI_API_KEY = "k";
    process.env.OHOS_MIGRATOR_AI_MODEL = "m";
    assert.equal(resolveAiConfig({}), undefined);
  } finally {
    restoreEnv(snap);
  }
});

test("loadConfigFile reads an explicit path", () => {
  const root = tmp();
  try {
    const p = join(root, "custom.json");
    writeFileSync(p, JSON.stringify({ baseUrl: "b", apiKey: "a", model: "m" }));
    const cfg = loadConfigFile(p);
    assert.equal(cfg?.baseUrl, "b");
    assert.equal(cfg?.apiKey, "a");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadConfigFile returns undefined for a missing explicit path", () => {
  assert.equal(loadConfigFile(join(tmpdir(), "nope-xyz.json")), undefined);
});

test("loadConfigFile returns undefined on malformed JSON (falls through to env)", () => {
  const root = tmp();
  try {
    const p = join(root, CONFIG_FILENAME);
    writeFileSync(p, "{ not json");
    assert.equal(loadConfigFile(undefined, root), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadConfigFile discovers the projectRoot file when no explicit path", () => {
  const root = tmp();
  try {
    writeFileSync(join(root, CONFIG_FILENAME), JSON.stringify({ model: "discovered" }));
    const cfg = loadConfigFile(undefined, root);
    assert.equal(cfg?.model, "discovered");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discoverPaths is project-local → cwd → home ordered", () => {
  const root = "/some/project";
  const paths = discoverPaths(root);
  assert.equal(paths[0], join(root, CONFIG_FILENAME));
  assert.equal(paths[1], join(process.cwd(), CONFIG_FILENAME));
  assert.equal(paths[2], join(homedir(), CONFIG_FILENAME));
});

test("writeConfigTemplate fromEnv populates from environment", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  const root = tmp();
  try {
    process.env.OHOS_MIGRATOR_AI_BASE_URL = "https://env";
    process.env.OHOS_MIGRATOR_AI_API_KEY = "envk";
    process.env.OHOS_MIGRATOR_AI_MODEL = "envm";
    const out = join(root, "gen.json");
    const written = writeConfigTemplate(out, true);
    assert.equal(written.baseUrl, "https://env");
    assert.equal(written.apiKey, "envk");
    assert.equal(written.model, "envm");
    assert.equal(written.concurrency, 4);
    assert.equal(written.timeoutMs, 120_000);
    // File actually written to disk.
    const onDisk = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(onDisk.apiKey, "envk");
  } finally {
    restoreEnv(snap);
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeConfigTemplate blank writes empty placeholders (no env read)", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  const root = tmp();
  try {
    // Env is set but blank mode must ignore it.
    process.env.OHOS_MIGRATOR_AI_API_KEY = "should-not-appear";
    const out = join(root, "blank.json");
    const written = writeConfigTemplate(out, false);
    assert.equal(written.baseUrl, "");
    assert.equal(written.apiKey, "");
    assert.equal(written.model, "");
  } finally {
    restoreEnv(snap);
    rmSync(root, { recursive: true, force: true });
  }
});
