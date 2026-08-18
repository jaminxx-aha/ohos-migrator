/**
 * ai-log.js — AI 对话日志：主日志只留状态行（success/revert/hvigor/audit），
 * 与 AI 的对话内容（system/user prompt、流式 delta、step/assistant/tool transcript）
 * 单独写到 per-file 对话文件 log/<源文件名>.log，由 convFileFor 按目标废弃文件名推路径。
 * API key 脱敏。所有日志路径必须 .log 结尾（防写 dotfile → RCE）。
 */
const path = require('path');
const fs = require('fs');

/** 本地时间戳，格式 年-月-日 时:分:秒（原 toISOString 是 UTC，与本地差 8h 易误读）。 */
function tsStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

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

/**
 * 由目标废弃文件名推 per-file 对话日志路径：与主日志同目录，文件名 = 源文件 basename + .log。
 * 如 .../ohos-bluetooth.ets → <logDir>/ohos-bluetooth.ets.log。无主日志路径或目标文件返回 null。
 */
function convFileFor(cfg, targetFile) {
  if (!cfg || !cfg.logFile || !targetFile) return null;
  const base = path.basename(targetFile);
  return path.join(path.dirname(cfg.logFile), base + '.log');
}

/** per-attempt 对话 header（system/user prompt）→ 写 per-file 对话文件，不进主日志。 */
function logHeader(cfg, system, user, attempt) {
  const f = cfg.convFile;
  if (!f) return;
  const sep = '─'.repeat(72);
  const header = `[${tsStamp()}] attempt=${attempt} model=${cfg.model} status=STREAMING`;
  const block = [sep, header, '### system', system, '### user', user, '### response (streamed live)'].join('\n');
  logAppend(f, redactSecret(block, cfg.apiKey) + '\n');
}
/** 流式 delta → 写 per-file 对话文件。 */
function logDelta(cfg, text) {
  if (cfg.convFile) logAppend(cfg.convFile, redactSecret(text, cfg.apiKey));
}
/** 对话循环 transcript（step / assistant / tool / ended）→ 写 per-file 对话文件。 */
function logConv(cfg, text) {
  if (cfg.convFile) logAppend(cfg.convFile, text);
}

module.exports = { tsStamp, redactSecret, logAppend, logHeader, logDelta, logConv, convFileFor };
