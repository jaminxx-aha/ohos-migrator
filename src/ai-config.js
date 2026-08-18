/**
 * ai-config.js — AI 客户端配置：dotenv 语义加载 .env + process.env 读取。
 * 变量名统一为 OHOS_MIGRATOR_AI_*（无 OPENAI_* 别名回退）。discovery：<root>/.env → cwd/.env → ~/.env。
 * 日志路径必须 .log 结尾，否则回落默认（防 attacker 控制的 .env 把对话写进 .zshrc→RCE）。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

function parseDotenv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const g = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!g) continue;
    let v = g[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[g[1]] = v;
  }
  return env;
}

/** 把 .env 装载进 process.env（不覆盖已有变量）。Node 20.6+ 用内置 loadEnvFile，否则手工解析。 */
function loadAiEnv(root) {
  const candidates = [];
  if (root) candidates.push(path.join(root, '.env'));
  candidates.push(path.join(process.cwd(), '.env'));
  candidates.push(path.join(os.homedir(), '.env'));
  const loadEnvFile = (typeof process.loadEnvFile === 'function') ? process.loadEnvFile.bind(process) : null;
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    if (loadEnvFile) {
      try { loadEnvFile(p); return p; } catch (_) { /* 畸形 → 试下一个 */ }
    } else {
      try {
        const env = parseDotenv(fs.readFileSync(p, 'utf8'));
        for (const k of Object.keys(env)) if (process.env[k] === undefined) process.env[k] = env[k];
        return p;
      } catch (_) {}
    }
  }
  return null;
}

function firstEnv(...names) {
  for (const n of names) { const v = process.env[n]; if (v && String(v).trim() !== '') return v; }
  return undefined;
}
function envNum(name) {
  const v = process.env[name];
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 默认日志路径：当前工程目录（运行 ohos-migrator 时的 cwd）下 log/ai-conversation.log。
 * 与被扫描的 HarmonyOS 工程目录解耦——否则 --file 模式会把日志写到源文件所在目录。
 */
function defaultLogFile() {
  return path.join(process.cwd(), 'log', 'ai-conversation.log');
}
function sanitizeLogFile(raw) {
  const lf = String(raw || '').trim().toLowerCase();
  if (lf === '' || lf === '/dev/null' || lf === 'nul' || lf === 'off' || lf === 'none') return undefined;
  if (!lf.endsWith('.log')) return defaultLogFile();
  return raw;
}

/** 解析完整 AI 配置。缺 baseURL/apiKey/model 任一即抛错。 */
function resolveAiConfig(root) {
  const envPath = loadAiEnv(root);
  const baseURL = (firstEnv('OHOS_MIGRATOR_AI_BASE_URL') || '').replace(/\/$/, '');
  const apiKey = firstEnv('OHOS_MIGRATOR_AI_API_KEY') || '';
  const model = firstEnv('OHOS_MIGRATOR_AI_MODEL') || '';
  if (!baseURL || !apiKey || !model) {
    throw new Error(
      `.env 配置缺失：需 OHOS_MIGRATOR_AI_BASE_URL / OHOS_MIGRATOR_AI_API_KEY / OHOS_MIGRATOR_AI_MODEL` +
      `${envPath ? '（来源 ' + envPath + '）' : '（未找到 .env）'}`,
    );
  }
  const rawLog = (process.env.OHOS_MIGRATOR_AI_LOG_FILE || '').trim();
  const logFile = rawLog === '' ? defaultLogFile() : sanitizeLogFile(rawLog);
  return {
    baseURL, apiKey, model,
    idleMs: envNum('OHOS_MIGRATOR_AI_TIMEOUT_MS') || 300000,
    totalMs: envNum('OHOS_MIGRATOR_AI_MAX_TOTAL_MS') || 1200000,
    logFile, envPath,
  };
}

module.exports = { parseDotenv, loadAiEnv, firstEnv, envNum, defaultLogFile, sanitizeLogFile, resolveAiConfig };
