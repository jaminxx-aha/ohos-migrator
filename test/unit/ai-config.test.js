const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseDotenv, sanitizeLogFile, defaultLogFile, firstEnv, envNum } = require('../../src/ai-config');

test('parseDotenv: 基本键值、引号、export 前缀、注释/空行', () => {
  const text = [
    '# comment line',
    '',
    'export FOO=bar',
    'BAZ=qux',
    'QUOTED="hello world"',
    "SINGLE='spaced value'",
    'EMPTY=',
  ].join('\n');
  const env = parseDotenv(text);
  assert.equal(env.FOO, 'bar');
  assert.equal(env.BAZ, 'qux');
  assert.equal(env.QUOTED, 'hello world');
  assert.equal(env.SINGLE, 'spaced value');
  assert.equal(env.EMPTY, '');
  assert.equal(Object.keys(env).length, 5);
});

test('parseDotenv: 非键值行（如纯注释）被忽略', () => {
  const env = parseDotenv('// not a kv\n   \nKEY=1');
  assert.equal(env.KEY, '1');
  assert.equal(Object.keys(env).length, 1);
});

test('sanitizeLogFile: 禁用哨兵 → undefined（静默）', () => {
  for (const s of ['', '/dev/null', 'nul', 'off', 'none']) {
    assert.equal(sanitizeLogFile(s), undefined, `sentinel "${s}"`);
  }
});

test('sanitizeLogFile: 非 .log 结尾 → 回落默认（防写 rc/dotfile→RCE）', () => {
  // .zshrc / .bashrc / 无后缀 一律不放过——防 attacker 控 .env 把对话写进 shell 启动文件
  assert.equal(sanitizeLogFile('.zshrc'), defaultLogFile());
  assert.equal(sanitizeLogFile('/etc/rc.local'), defaultLogFile());
  assert.equal(sanitizeLogFile('output.txt'), defaultLogFile());
});

test('sanitizeLogFile: .log 结尾 → 原样放行', () => {
  assert.equal(sanitizeLogFile('ai.log'), 'ai.log');
  assert.equal(sanitizeLogFile('/var/log/migrate.log'), '/var/log/migrate.log');
  // 大写后缀也放行（校验按小写，返回原值）
  assert.equal(sanitizeLogFile('AI.LOG'), 'AI.LOG');
});

test('defaultLogFile: 指向 cwd/log/ai-conversation.log', () => {
  assert.equal(defaultLogFile(), path.join(process.cwd(), 'log', 'ai-conversation.log'));
});

// ---- firstEnv / envNum（读 process.env，须 save/restore） ----
function withEnv(setter, fn) {
  const backup = {};
  for (const k of Object.keys(setter)) { backup[k] = process.env[k]; process.env[k] = setter[k]; }
  try { return fn(); }
  finally { for (const k of Object.keys(setter)) { if (backup[k] === undefined) delete process.env[k]; else process.env[k] = backup[k]; } }
}

test('firstEnv: 返回首个非空（trim 后）值，否则 undefined', () => {
  withEnv({ A: '', B: '  ', C: 'val' }, () => {
    assert.equal(firstEnv('A', 'B', 'C'), 'val');   // A 空串、B 纯空白 都跳过
  });
  withEnv({}, () => assert.equal(firstEnv('NOPE_X', 'NOPE_Y'), undefined));
});

test('envNum: 正数 → 数值；0/负/NaN/空 → undefined', () => {
  withEnv({ N: '120000' }, () => assert.equal(envNum('N'), 120000));
  withEnv({ N: '0' }, () => assert.equal(envNum('N'), undefined));       // >0 守卫拒 0
  withEnv({ N: '-5' }, () => assert.equal(envNum('N'), undefined));       // 拒负
  withEnv({ N: 'abc' }, () => assert.equal(envNum('N'), undefined));      // 拒 NaN
  withEnv({ N: '' }, () => assert.equal(envNum('N'), undefined));
  withEnv({}, () => assert.equal(envNum('NOPE_Z'), undefined));
});
