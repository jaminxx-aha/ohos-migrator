const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildIndex, lookupEntry, shippedVersions, DATA_DIR } = require('../../src/deprecation-map');

test('shippedVersions: 含 apiVersion=24 的 shipped map（随仓库）', () => {
  const vs = shippedVersions();
  assert.ok(Array.isArray(vs));
  assert.ok(vs.includes(24));
});

test('shippedVersions: 升序', () => {
  const vs = shippedVersions();
  for (let i = 1; i < vs.length; i++) assert.ok(vs[i] >= vs[i - 1]);
});

test('buildIndex: 结构正确——byKEM 嵌套 Map', () => {
  const entries = [{ dep: { kit: '@ohos.util', exportName: 'util', members: ['a', 'b'] }, repl: null }];
  const idx = buildIndex({ entries, kitIndex: {}, kitExports: {}, kitDefaultExport: {} });
  assert.ok(idx.byKEM instanceof Map);
  assert.ok(idx.byKEM.get('@ohos.util') instanceof Map);
  assert.ok(idx.byKEM.get('@ohos.util').get('util') instanceof Map);
});

test('buildIndex: 无 members 的 entry 不进成员查表', () => {
  const entries = [{ dep: { kit: '@ohos.x', exportName: 'x', members: [] }, repl: null }];
  const idx = buildIndex({ entries, kitIndex: {}, kitExports: {}, kitDefaultExport: {} });
  assert.equal(idx.byKEM.size, 0);
});

test('buildIndex: 透出 kitIndex/kitExports/kitDefaultExport 视图', () => {
  const idx = buildIndex({ entries: [], kitIndex: { '@ohos.a': { newKit: '@ohos.b' } }, kitExports: { '@ohos.b': ['x'] }, kitDefaultExport: { '@ohos.d': true } });
  assert.deepEqual(idx.kitIndex, { '@ohos.a': { newKit: '@ohos.b' } });
  assert.deepEqual(idx.kitExports['@ohos.b'], ['x']);
  assert.ok(idx.kitDefaultExport['@ohos.d']);
});

test('lookupEntry: 命中 + members 顺序敏感', () => {
  const entries = [{ dep: { kit: '@ohos.util', exportName: 'util', members: ['a', 'b'] }, repl: { members: ['c', 'd'] } }];
  const idx = buildIndex({ entries });
  assert.ok(lookupEntry(idx, '@ohos.util', 'util', ['a', 'b']));
  assert.equal(lookupEntry(idx, '@ohos.util', 'util', ['b', 'a']), null); // 顺序不一致不命中
});

test('lookupEntry: 未命中 kit / export / chain 各返回 null', () => {
  const entries = [{ dep: { kit: '@ohos.util', exportName: 'util', members: ['a'] }, repl: null }];
  const idx = buildIndex({ entries });
  assert.equal(lookupEntry(idx, '@ohos.x', 'util', ['a']), null);
  assert.equal(lookupEntry(idx, '@ohos.util', 'y', ['a']), null);
  assert.equal(lookupEntry(idx, '@ohos.util', 'util', ['z']), null);
});

test('loadMap: 显式 mapPath 覆盖（读真实 shipped map）', () => {
  const { loadMap } = require('../../src/deprecation-map');
  const p = path.join(DATA_DIR, 'deprecation-map.24.json');
  const m = loadMap({ mapPath: p });
  assert.ok(m);
  assert.ok(Array.isArray(m.entries));
  assert.ok(m.entries.length > 1000);
});

test('loadMap: 无显式路径 + 无 SDK → 回退最高版本 shipped map', () => {
  const { loadMap } = require('../../src/deprecation-map');
  const m = loadMap({}); // sdkPath undefined, mapPath undefined
  assert.ok(m, '应回退到最高版本 shipped map');
  const top = shippedVersions()[shippedVersions().length - 1];
  assert.equal(m.apiVersion, top);
});

test('loadMap: apiVersion=24 shipped map 含 kitIndex/kitExports', () => {
  const { loadMap } = require('../../src/deprecation-map');
  const p = path.join(DATA_DIR, 'deprecation-map.24.json');
  const m = loadMap({ mapPath: p });
  assert.ok(m.kitIndex);
  assert.ok(m.kitExports);
  assert.equal(m.apiVersion, 24);
});
