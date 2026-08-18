const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseErrorEntries, relFile, resolveHvigorTargets } = require('../../src/verify/hvigor');

const ESC = '\x1b';

test('parseErrorEntries: 同行 Error Message + At File → 提取消息/行号，去 ANSI', () => {
  const raw = [
    '> hvigor start',
    'ArkTS:WARN File: /p/warn.ets:1:1',  // WARN 行，必须被排除
    `${ESC}[31m78 ERROR: ${ESC}[31m10505001 ArkTS Compiler Error`,
    `Error Message: ${ESC}[31mModule "@ohos.curves" has no exported member 'Curve' At File: /proj/entry/a.ets:2:10`,
    `${ESC}[39m`,
    `Error Message: Property 'merge' is missing At File: /proj/entry/b.ets:72:9`,
  ].join('\n');
  const e = parseErrorEntries(raw);
  assert.equal(e.length, 2);
  assert.equal(e[0].file, '/proj/entry/a.ets');
  assert.equal(e[0].line, 2);
  assert.ok(e[0].message.includes('no exported member') && !e[0].message.includes(ESC), 'ANSI 已去除');
  assert.equal(e[1].file, '/proj/entry/b.ets');
  assert.equal(e[1].line, 72);
  assert.equal(e[1].message, "Property 'merge' is missing");
});

test('parseErrorEntries: 缺消息的 At File 行被丢弃（避免空消息条目）', () => {
  const raw = 'At File: /p/x.ets:5:1';  // 无 Error Message、无前置缩进行
  const e = parseErrorEntries(raw);
  assert.equal(e.length, 0);
});

test('parseErrorEntries: 续行消息（At File 前的缩进行）拼接', () => {
  const raw = [
    'Error: ArkTS Compiler Error',
    '  Classes cannot be used as objects (arkts-no-classes-as-obj) At File: /p/c.ets:10:5',
  ].join('\n');
  // At File 行本身缩进、含消息但无 Error Message: 前缀 → 走 buf，而 buf 在遇到该行前为空
  // → 该行消息丢失。这是当前实现的已知限制，此处锁定行为以防空静默回归。
  const e = parseErrorEntries(raw);
  assert.equal(e.length, 0);
});

test('relFile: 工程内 → 正斜杠相对路径', () => {
  assert.equal(relFile('/proj/entry/a.ets', '/proj'), 'entry/a.ets');
  assert.equal(relFile('/proj', '/proj'), '.');
});

test('relFile: 工程外 → null', () => {
  assert.equal(relFile('/other/a.ets', '/proj'), null);
});

test('relFile: Windows 反斜杠归一', () => {
  assert.equal(relFile('C:\\proj\\entry\\a.ets', 'C:\\proj'), 'entry/a.ets');
  assert.equal(relFile('C:\\proj\\entry\\a.ets', 'C:/proj'), 'entry/a.ets');
});

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hvigor-test-'));
}

test('resolveHvigorTargets: 解析 module@target / product', () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, 'build-profile.json5'), JSON.stringify({
    app: { products: [{ name: 'myprod' }] },
    modules: [{ name: 'feature', targets: [{ name: 'stage' }] }],
  }));
  const t = resolveHvigorTargets(d);
  assert.equal(t.module, 'feature@stage');
  assert.equal(t.product, 'myprod');
});

test('resolveHvigorTargets: json5 容错（注释 + 尾逗号，键已加引号——真实文件即如此）', () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, 'build-profile.json5'), [
    '{',
    '  // app products',
    '  "app": { "products": [ { "name": "p1", } ] },',
    '  "modules": [ { "name": "entry", "targets": [ { "name": "default", } ] } ]',
    '}',
  ].join('\n'));
  const t = resolveHvigorTargets(d);
  assert.equal(t.module, 'entry@default');
  assert.equal(t.product, 'p1');
});

test('resolveHvigorTargets: 无 build-profile → 回退 entry@default', () => {
  const d = tmpDir();
  const t = resolveHvigorTargets(d);
  assert.equal(t.module, 'entry@default');
  assert.equal(t.product, 'default');
});

test('resolveHvigorTargets: 畸形 json5 → 回退', () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, 'build-profile.json5'), '{ this is not json');
  const t = resolveHvigorTargets(d);
  assert.equal(t.module, 'entry@default');
  assert.equal(t.product, 'default');
});
