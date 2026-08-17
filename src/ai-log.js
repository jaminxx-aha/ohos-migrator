/**
 * ai-log.js — AI 对话实时日志：header(流式前) + 逐 delta 追加 + footer；API key 脱敏。
 * 日志路径必须 .log 结尾（由 ai-config.sanitizeLogFile 保证，防写 rc/dotfile→RCE）。
 */
const path = require('path');
const fs = require('fs');

function tsStamp() { return new Date().toISOString(); }

/** 把 secret 从 text 中抹成 [REDACTED]（全量匹配 + 服务端回显的掩码形式）。短于 8 位跳过。 */
function redactSecret(text, secret) {
  if (!secret || secret.length < 8) return text;
  let out = text.split(secret).join('[REDACTED]');
  out = out.replace(/sk-[A-Za-z0-9_-]{1,20}\.{2,4}[A-Za-z0-9_-]{1,20}/g, '[REDACTED]');
  return out;
}

const _seenLogDirs = new Set();
function logAppend(logFile, text) {
  if (!logFile) return;
  try {
    if (!_seenLogDirs.has(logFile)) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      _seenLogDirs.add(logFile);
    }
    fs.appendFileSync(logFile, text, 'utf8');
  } catch (_) { /* best-effort：日志失败不得中断迁移 */ }
}
function logHeader(cfg, system, user, attempt) {
  if (!cfg.logFile) return;
  const sep = '─'.repeat(72);
  const header = `[${tsStamp()}] attempt=${attempt} model=${cfg.model} base=${cfg.baseURL} status=STREAMING`;
  const block = [sep, header, '### system', system, '### user', user, '### response (streamed live)'].join('\n');
  logAppend(cfg.logFile, redactSecret(block, cfg.apiKey) + '\n');
}
function logDelta(cfg, text) { if (cfg.logFile) logAppend(cfg.logFile, text); }

module.exports = { tsStamp, redactSecret, logAppend, logHeader, logDelta };
