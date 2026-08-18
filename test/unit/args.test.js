const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgv, ArgError, usage } = require('../../src/args');
const { DEFAULT_OH_TS, DEFAULT_SDK } = require('../../src/common');

test('parseArgv: scan --file → 正确 opts + 默认 sdk/oh-ts', () => {
  const o = parseArgv(['scan', '--file', 'a.ets']);
  assert.equal(o.cmd, 'scan');
  assert.equal(o.file, 'a.ets');
  assert.equal(o.project, null);
  assert.equal(o.useAi, false);
  assert.equal(o.sdkPath, DEFAULT_SDK);
  assert.equal(o.ohTsPath, DEFAULT_OH_TS);
  assert.equal(o.help, false);
});

test('parseArgv: rewrite --project --use-ai → useAi=true', () => {
  const o = parseArgv(['rewrite', '--project', 'p', '--use-ai']);
  assert.equal(o.cmd, 'rewrite');
  assert.equal(o.project, 'p');
  assert.equal(o.useAi, true);
});

test('parseArgv: --sdk / --oh-ts 覆盖默认', () => {
  const o = parseArgv(['scan', '--file', 'a', '--sdk', '/s', '--oh-ts', '/t']);
  assert.equal(o.sdkPath, '/s');
  assert.equal(o.ohTsPath, '/t');
});

test('parseArgv: --help / -h → help=true 且短路（不再校验 file/project）', () => {
  // 即便没给 --file/--project，--help 也应短路返回，不抛 required 错误
  assert.equal(parseArgv(['scan', '--help']).help, true);
  assert.equal(parseArgv(['rewrite', '-h']).help, true);
});

test('parseArgv: 非法子命令 → ArgError', () => {
  assert.throws(() => parseArgv(['foo', '--file', 'a']), (e) => e instanceof ArgError && /subcommand/.test(e.message));
  assert.throws(() => parseArgv([]), (e) => e instanceof ArgError);
});

test('parseArgv: 未知参数 → ArgError', () => {
  assert.throws(() => parseArgv(['scan', '--file', 'a', '--bogus']), (e) => e instanceof ArgError && /unknown arg/.test(e.message));
});

test('parseArgv: 取值参数缺值 → ArgError（--file 在末尾）', () => {
  assert.throws(() => parseArgv(['scan', '--file']), (e) => e instanceof ArgError && /requires a value/.test(e.message));
  assert.throws(() => parseArgv(['scan', '--project']), (e) => e instanceof ArgError && /requires a value/.test(e.message));
});

test('parseArgv: 缺 --file/--project → ArgError', () => {
  assert.throws(() => parseArgv(['scan']), (e) => e instanceof ArgError && /is required/.test(e.message));
});

test('parseArgv: --file 与 --project 互斥 → ArgError', () => {
  assert.throws(() => parseArgv(['scan', '--file', 'a', '--project', 'p']), (e) => e instanceof ArgError && /mutually exclusive/.test(e.message));
});

test('usage: 是函数且打印含 scan/rewrite 文本', () => {
  // 不验证 stdout 细节，只确保可调用且不抛
  assert.doesNotThrow(() => usage());
});
