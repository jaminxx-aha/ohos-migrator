const test = require('node:test');
const assert = require('node:assert/strict');
const { extractImports, extractBindingMap, parseBindings, lineAt } = require('../../src/import-extractor');

test('extractImports: namespace import 的 specStart/specEnd 含引号', () => {
  const src = `import * as util from '@ohos.util';\nutil.foo();\n`;
  const imps = extractImports(src);
  assert.equal(imps.length, 1);
  const i = imps[0];
  assert.equal(i.specifier, '@ohos.util');
  assert.equal(src.slice(i.specStart, i.specEnd), "'@ohos.util'");
  assert.equal(i.line, 1);
  assert.equal(i.bindings.length, 1);
  assert.equal(i.bindings[0].imported, '*');
  assert.equal(i.bindings[0].local, 'util');
});

test('extractImports: default import → imported=default', () => {
  const src = `import prompt from '@ohos.prompt';\n`;
  const i = extractImports(src)[0];
  assert.equal(i.bindings.length, 1);
  assert.equal(i.bindings[0].imported, 'default');
  assert.equal(i.bindings[0].local, 'prompt');
});

test('extractImports: named 子句解析 imported/local + nameStart/nameEnd 指向 token', () => {
  const src = `import { a, b as c } from '@ohos.x';\n`;
  const i = extractImports(src)[0];
  assert.equal(i.bindings.length, 2);
  assert.equal(i.bindings[0].imported, 'a');
  assert.equal(i.bindings[0].local, 'a');
  assert.equal(i.bindings[1].imported, 'b');
  assert.equal(i.bindings[1].local, 'c');
  // nameStart/nameEnd 切出 imported 名 token
  assert.equal(src.slice(i.bindings[1].nameStart, i.bindings[1].nameEnd), 'b');
});

test('extractImports: require 与 dynamic import 各解析', () => {
  const src = `const x = require('@ohos.r');\nconst y = import('@ohos.d');\n`;
  const imps = extractImports(src);
  assert.equal(imps.length, 2);
  assert.equal(imps[0].specifier, '@ohos.r');
  assert.equal(imps[1].specifier, '@ohos.d');
});

test('extractImports: 多 import 行号正确', () => {
  const src = `import a from '@ohos.a';\nimport b from '@ohos.b';\n`;
  const imps = extractImports(src);
  assert.equal(imps[0].line, 1);
  assert.equal(imps[1].line, 2);
});

test('extractImports: 无 import 返回空数组', () => {
  assert.deepEqual(extractImports('let x = 1;'), []);
});

test('extractBindingMap: namespace/default/named-alias → kit', () => {
  const src = [
    `import * as util from '@ohos.util';`,
    `import prompt from '@ohos.prompt';`,
    `import { a as aa, b } from '@ohos.x';`,
  ].join('\n');
  const m = extractBindingMap(src);
  assert.equal(m.get('util'), '@ohos.util');
  assert.equal(m.get('prompt'), '@ohos.prompt');
  assert.equal(m.get('aa'), '@ohos.x');
  assert.equal(m.get('b'), '@ohos.x');
});

test('parseBindings: 纯 named 子句', () => {
  const bs = parseBindings('{ foo, bar as baz }', 0);
  assert.equal(bs.length, 2);
  assert.equal(bs[0].imported, 'foo');
  assert.equal(bs[1].local, 'baz');
});

test('parseBindings: namespace 子句', () => {
  const bs = parseBindings('* as ns', 0);
  assert.equal(bs.length, 1);
  assert.equal(bs[0].imported, '*');
  assert.equal(bs[0].local, 'ns');
});

test('lineAt: 偏移 → 1-based 行号', () => {
  const src = `aaa\nbbb\nccc`;
  assert.equal(lineAt(src, 0), 1);
  assert.equal(lineAt(src, 4), 2); // b 行首
  assert.equal(lineAt(src, 8), 3); // c 行首
});
