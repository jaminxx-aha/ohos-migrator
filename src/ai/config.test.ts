/**
 * Tests for AI config (`config.ts`) — dotenv semantics.
 *
 * `.env` is loaded into `process.env` via Node's `process.loadEnvFile`
 * (existing vars NOT overridden), then resolved per-field:
 *   flag > OHOS_MIGRATOR_AI_* env > OPENAI_* env
 * These tests mutate `process.env` (and loadAiEnv mutates it too), so each
 * test snapshots + restores the AI/OPENAI env keys.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  resolveAiConfig,
  loadAiEnv,
  discoverEnvPaths,
  writeEnvTemplate,
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

const NOPE = join(tmpdir(), "does-not-exist.env");

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
    assert.equal(resolveAiConfig({ envFile: NOPE }), undefined);
  } finally {
    restoreEnv(snap);
  }
});

test("resolveAiConfig returns undefined when a field is missing", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  try {
    process.env.OHOS_MIGRATOR_AI_BASE_URL = "https://x";
    process.env.OHOS_MIGRATOR_AI_MODEL = "m";
    // apiKey missing → incomplete
    assert.equal(resolveAiConfig({ envFile: NOPE }), undefined);
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
    const cfg = resolveAiConfig({ envFile: NOPE });
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
    const cfg = resolveAiConfig({ envFile: NOPE });
    assert.equal(cfg?.baseUrl, "https://oai");
    assert.equal(cfg?.apiKey, "ok");
    assert.equal(cfg?.model, "gpt-4o");
  } finally {
    restoreEnv(snap);
  }
});

test("resolveAiConfig: flag wins over env", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  try {
    process.env.OHOS_MIGRATOR_AI_BASE_URL = "envurl";
    process.env.OHOS_MIGRATOR_AI_API_KEY = "envk";
    process.env.OHOS_MIGRATOR_AI_MODEL = "envm";
    const cfg = resolveAiConfig(
      { aiBaseUrl: "flagurl", aiApiKey: "flagk", aiModel: "flagm", envFile: NOPE },
    );
    assert.equal(cfg?.baseUrl, "flagurl");
    assert.equal(cfg?.apiKey, "flagk");
    assert.equal(cfg?.model, "flagm");
  } finally {
    restoreEnv(snap);
  }
});

test("resolveAiConfig treats whitespace-only env values as missing", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  try {
    process.env.OHOS_MIGRATOR_AI_BASE_URL = "   ";
    process.env.OHOS_MIGRATOR_AI_API_KEY = "k";
    process.env.OHOS_MIGRATOR_AI_MODEL = "m";
    assert.equal(resolveAiConfig({ envFile: NOPE }), undefined);
  } finally {
    restoreEnv(snap);
  }
});

test("resolveAiConfig loads .env then lets flag override per-field", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  const root = tmp();
  try {
    writeFileSync(
      join(root, CONFIG_FILENAME),
      [
        "OHOS_MIGRATOR_AI_BASE_URL='fileurl'",
        "OHOS_MIGRATOR_AI_API_KEY='filek'",
        "OHOS_MIGRATOR_AI_MODEL='filem'",
      ].join("\n") + "\n",
    );
    // No explicit envFile → discovery finds <root>/.env first.
    const cfg = resolveAiConfig({ aiBaseUrl: "flagurl" }, root);
    assert.equal(cfg?.baseUrl, "flagurl"); // flag overrode file
    assert.equal(cfg?.apiKey, "filek"); // from .env
    assert.equal(cfg?.model, "filem"); // from .env
  } finally {
    restoreEnv(snap);
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadAiEnv loads a .env into process.env", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  const root = tmp();
  try {
    writeFileSync(
      join(root, CONFIG_FILENAME),
      "OHOS_MIGRATOR_AI_BASE_URL='fromfile'\nOHOS_MIGRATOR_AI_API_KEY='filek'\n",
    );
    const r = loadAiEnv(undefined, root);
    assert.equal(r.loaded, true);
    assert.equal(r.path, join(root, CONFIG_FILENAME));
    assert.equal(process.env.OHOS_MIGRATOR_AI_BASE_URL, "fromfile");
    assert.equal(process.env.OHOS_MIGRATOR_AI_API_KEY, "filek");
  } finally {
    restoreEnv(snap);
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadAiEnv does NOT override existing env (dotenv semantics)", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  const root = tmp();
  try {
    writeFileSync(join(root, CONFIG_FILENAME), "OHOS_MIGRATOR_AI_API_KEY='filek'\n");
    process.env.OHOS_MIGRATOR_AI_API_KEY = "shell-set";
    loadAiEnv(undefined, root);
    assert.equal(process.env.OHOS_MIGRATOR_AI_API_KEY, "shell-set");
  } finally {
    restoreEnv(snap);
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadAiEnv loads an explicit path", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  const root = tmp();
  try {
    const p = join(root, "custom.env");
    writeFileSync(p, "OHOS_MIGRATOR_AI_MODEL='customm'\n");
    const r = loadAiEnv(p);
    assert.equal(r.loaded, true);
    assert.equal(r.path, p);
    assert.equal(process.env.OHOS_MIGRATOR_AI_MODEL, "customm");
  } finally {
    restoreEnv(snap);
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadAiEnv returns loaded:false for a missing explicit path", () => {
  assert.equal(loadAiEnv(NOPE).loaded, false);
});

test("loadAiEnv returns loaded:false on an unloadable path (no throw)", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  // A directory path: existsSync is true but loadEnvFile throws
  // ERR_INVALID_ARG_TYPE — exercising the swallow branch.
  const dir = mkdtempSync(join(tmpdir(), "ohos-ai-dir-"));
  try {
    assert.doesNotThrow(() => {
      const r = loadAiEnv(dir);
      assert.equal(r.loaded, false);
    });
    assert.equal(process.env.OHOS_MIGRATOR_AI_API_KEY, undefined);
  } finally {
    restoreEnv(snap);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverEnvPaths is project-local → cwd → home ordered", () => {
  const root = "/some/project";
  const paths = discoverEnvPaths(root);
  assert.equal(paths[0], join(root, CONFIG_FILENAME));
  assert.equal(paths[1], join(process.cwd(), CONFIG_FILENAME));
  assert.equal(paths[2], join(homedir(), CONFIG_FILENAME));
});

test("writeEnvTemplate fromEnv populates from environment", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  const root = tmp();
  try {
    process.env.OHOS_MIGRATOR_AI_BASE_URL = "https://env";
    process.env.OHOS_MIGRATOR_AI_API_KEY = "envk";
    process.env.OHOS_MIGRATOR_AI_MODEL = "envm";
    const out = join(root, "gen.env");
    const res = writeEnvTemplate(out, true);
    assert.ok(existsSync(out));
    const onDisk = readFileSync(out, "utf8");
    assert.match(onDisk, /OHOS_MIGRATOR_AI_API_KEY='envk'/);
    assert.match(onDisk, /OHOS_MIGRATOR_AI_MODEL='envm'/);
    assert.equal(res.fields.filter((f) => f.filled).length, 3);
  } finally {
    restoreEnv(snap);
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeEnvTemplate blank writes empty placeholders (ignores env)", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  const root = tmp();
  try {
    process.env.OHOS_MIGRATOR_AI_API_KEY = "should-not-appear";
    const out = join(root, "blank.env");
    const res = writeEnvTemplate(out, false);
    const onDisk = readFileSync(out, "utf8");
    assert.match(onDisk, /OHOS_MIGRATOR_AI_API_KEY=''/);
    assert.doesNotMatch(onDisk, /should-not-appear/);
    assert.equal(res.fields.filter((f) => f.filled).length, 0);
  } finally {
    restoreEnv(snap);
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeEnvTemplate single-quotes $ values literally (no expansion)", () => {
  const snap = snapshotEnv();
  clearAiEnv();
  const root = tmp();
  try {
    process.env.OHOS_MIGRATOR_AI_API_KEY = "sk-$abc";
    const out = join(root, "dollar.env");
    writeEnvTemplate(out, true);
    const onDisk = readFileSync(out, "utf8");
    // single-quoted so the $ survives verbatim
    assert.match(onDisk, /OHOS_MIGRATOR_AI_API_KEY='sk-\$abc'/);
  } finally {
    restoreEnv(snap);
    rmSync(root, { recursive: true, force: true });
  }
});
