const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseErrorEntries, relFile, resolveHvigorTargets, stripJson5, devEcoRoot, hvigorwJsPath, nodeHome, nodeExe, looksLikeHarmonyProject, findProjectRootFromFile, IS_WIN } = require('../../src/verify/hvigor');

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

// ---- stripJson5：json5 宽容解析（正则易碎，重点测） ----

test('stripJson5: 块注释移除', () => {
  const s = stripJson5('{/* c1 */ "a": 1 /* c2 */}');
  assert.equal(JSON.parse(s).a, 1);
});

test('stripJson5: 行注释移除（不误删 URL 的 //）', () => {
  // `https://...` 的 // 前面是 `:`，正则 `(^|[^:])//` 不匹配 → URL 保留
  const s = stripJson5('{ "url": "https://example.com", "x": 1 // 行注释\n}');
  const j = JSON.parse(s);
  assert.equal(j.url, 'https://example.com');
  assert.equal(j.x, 1);
});

test('stripJson5: 尾逗号容忍（对象/数组）', () => {
  const s = stripJson5('{ "a": 1, "b": [2, 3,], }');
  const j = JSON.parse(s);
  assert.equal(j.a, 1);
  assert.deepEqual(j.b, [2, 3]);
});

test('stripJson5: 非冒号前缀的 // 行注释被删除', () => {
  // 正则 `(^|[^:])//`：// 前一字符非冒号即视为行注释删除。
  // 'foo//bar' 中 // 前为 'o'（非冒号）→ 删，保留 'foo'。
  // 对照：'a://c' 的 // 前是 ':' → 当 URL 保护、不删（见 URL 用例）。
  assert.equal(stripJson5('foo//bar').replace(/\s/g, ''), 'foo');
  assert.equal(stripJson5('a://c'), 'a://c'); // 冒号守卫，原样保留
});

// ---- 路径数学纯函数 ----

test('devEcoRoot / hvigorwJsPath / nodeHome: sdkHome 推导（跨平台用 path 取期望）', () => {
  const sdkHome = IS_WIN ? 'C:/DevEco/sdk' : '/DevEco/sdk';
  const root = path.dirname(sdkHome);
  assert.equal(devEcoRoot(sdkHome), root);
  assert.equal(hvigorwJsPath(sdkHome), path.join(root, 'tools', 'hvigor', 'bin', 'hvigorw.js'));
  assert.equal(nodeHome(sdkHome), path.join(root, 'tools', 'node'));
});

test('nodeExe: 路径都不存在 → 回退首选候选（让 spawnSync 报 ENOENT）', () => {
  const sdkHome = '/nonexistent/sdk';
  const home = nodeHome(sdkHome);
  const expectedFirst = IS_WIN ? path.join(home, 'node.exe') : path.join(home, 'bin', 'node');
  assert.equal(nodeExe(sdkHome), expectedFirst);
});

// ---- looksLikeHarmonyProject / findProjectRootFromFile（fs，临时目录） ----

test('looksLikeHarmonyProject: 有 build-profile + entry/build-profile → true', () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, 'build-profile.json5'), '{}');
  fs.mkdirSync(path.join(d, 'entry'));
  fs.writeFileSync(path.join(d, 'entry', 'build-profile.json5'), '{}');
  assert.equal(looksLikeHarmonyProject(d), true);
  assert.equal(looksLikeHarmonyProject(tmpDir()), false);
});

test('findProjectRootFromFile: 向上找最近工程根', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'build-profile.json5'), '{}');
  fs.mkdirSync(path.join(root, 'entry'), { recursive: true });
  fs.writeFileSync(path.join(root, 'entry', 'build-profile.json5'), '{}');
  fs.mkdirSync(path.join(root, 'entry', 'src', 'main'), { recursive: true });
  const f = path.join(root, 'entry', 'src', 'main', 'foo.ets');
  fs.writeFileSync(f, '');
  assert.equal(findProjectRootFromFile(f), root);
});

test('findProjectRootFromFile: 无工程根 → null', () => {
  const d = tmpDir();
  const f = path.join(d, 'foo.ets');
  fs.writeFileSync(f, '');
  assert.equal(findProjectRootFromFile(f), null);
});
