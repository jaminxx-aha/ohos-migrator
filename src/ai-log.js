/**
 * ai-log.js — AI 对话实时日志：header(流式前) + 逐 delta 追加 + footer；API key 脱敏。
 * 日志路径必须 .log 结尾（由 ai-config.sanitizeLogFile 保证，防写 rc/dotfile→RCE）。
 */
const path = require('path');
const fs = require('fs');

function tsStamp() { return new Date().toISOString(); }

/** 把 secret 从 text 中抹成 [REDACTED]（全量匹配 + 服务端回显的掩码形式）。短于 8 位跳过精确匹配。 */
function redactSecret(text, secret) {
  // 精确匹配：仅当 secret 足够长（>=8）才替换，避免短串误 redact 正常文本。
  let out = (secret && secret.length >= 8) ? text.split(secret).join('[REDACTED]') : text;
  // 服务端掩码回显（sk-xxx...yyy）独立于 secret 是否提供——API 报错常含此形式，
  // 不能因调用方未传 secret 或 secret 偏短就放过。
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
function logDelta(cfg, text) {
  if (cfg.logFile) logAppend(cfg.logFile, redactSecret(text, cfg.apiKey));
}

module.exports = { tsStamp, redactSecret, logAppend, logHeader, logDelta };
