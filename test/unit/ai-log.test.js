const test = require('node:test');
const assert = require('node:assert/strict');
const { redactSecret } = require('../../src/ai-log');

const FULL_KEY = 'sk-proj-abcdef1234567890XYZ'; // 24 chars，>=8 命中精确匹配路径

test('redactSecret: 全量精确 secret 出现 → 全部脱敏', () => {
  const t = `auth: Bearer ${FULL_KEY}`;
  assert.equal(redactSecret(t, FULL_KEY), 'auth: Bearer [REDACTED]');
});

test('redactSecret: 多次出现 → 全部脱敏', () => {
  const t = `${FULL_KEY} and again ${FULL_KEY}`;
  assert.equal(redactSecret(t, FULL_KEY), '[REDACTED] and again [REDACTED]');
});

test('redactSecret: secret 作为更长 token 的子串 → 仍脱敏（保守策略）', () => {
  // 保守：不做词边界限定，宁可误杀也不漏
  const t = `xx${FULL_KEY}yy`;
  assert.equal(redactSecret(t, FULL_KEY), 'xx[REDACTED]yy');
});

test('redactSecret: secret < 8 位 → 精确路径跳过（原样返回）', () => {
  // 防短串误红act 太多正常文本；短 secret 风险低。masked 正则路径仍可能独立命中。
  assert.equal(redactSecret('a short', 'short'), 'a short');
});

test('redactSecret: 服务端掩码回显 sk-xxx...yyy → 脱敏（secret 未字面出现）', () => {
  // API 报错常回显掩码形式，secret 本身不在文本里，靠正则兜底
  const t = 'Incorrect API key provided: sk-abc123...xyz789';
  assert.equal(redactSecret(t, 'sk-not-present-here'), 'Incorrect API key provided: [REDACTED]');
});

test('redactSecret: 掩码 2 点 / 4 点（\\.{2,4} 边界）→ 脱敏', () => {
  assert.equal(redactSecret('sk-ab..cd', null), '[REDACTED]');
  assert.equal(redactSecret('sk-ab....cd', null), '[REDACTED]');
});

test('redactSecret: 无 secret 无掩码 → 原样', () => {
  assert.equal(redactSecret('plain text no secrets', FULL_KEY), 'plain text no secrets');
});

test('redactSecret: 精确 secret + 掩码回显混合 → 两者都脱敏', () => {
  const t = `key=${FULL_KEY} echo=sk-aaa...bbb`;
  assert.equal(redactSecret(t, FULL_KEY), 'key=[REDACTED] echo=[REDACTED]');
});

test('redactSecret: 已知限制——掩码前缀 >20 字符不脱敏（{1,20} 上限）', () => {
  // 正则 sk-[A-Za-z0-9_-]{1,20}\.{2,4}... 要求 `...` 前 ≤20 字符；
  // 25 字符前缀 + 3 点 → 不命中。若放宽 regex 需同步更新此断言。
  const t = 'sk-abcdefghijklmnopqrstuvwxyz123...xyz'; // sk- 后 25 字符
  assert.equal(redactSecret(t, null), t, '当前 regex 不覆盖 >20 前缀，锁定以防静默回归');
});

test('redactSecret: 已知限制——5 个点不脱敏（\\.{2,4} 上限）', () => {
  // 5 点超出 {2,4}，其后接字面点非 word char → 不命中。
  const t = 'sk-ab.....cd';
  assert.equal(redactSecret(t, null), t);
});
