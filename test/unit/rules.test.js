const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyFindingsToContent, dedupeOverlapping, classifyHit,
  isSameKitRename, isWholeKitSwap, filterObviousSubset,
} = require('../../src/rules');
const { buildIndex, lookupEntry } = require('../../src/deprecation-map');
const { createBindingAllocator } = require('../../src/binding-allocator');

// ---- applyFindingsToContent ----

test('applyFindingsToContent: bottom-up splice 两处不漂移', () => {
  const text = 'aaa old bbb old ccc';
  const fs = [
    { matchStart: 4, matchEnd: 7, replacement: 'NEW1' },   // 第一个 old
    { matchStart: 12, matchEnd: 15, replacement: 'NEW2' }, // 第二个 old
  ];
  const r = applyFindingsToContent(text, fs);
  assert.equal(r.content, 'aaa NEW1 bbb NEW2 ccc');
  assert.equal(r.edits.length, 2);
});

test('applyFindingsToContent: overlap dedupe 保留最长 span', () => {
  const text = 'xxx old yyy';
  const fs = [
    { matchStart: 4, matchEnd: 7, replacement: 'A' },        // 'old' → A
    { matchStart: 4, matchEnd: 7, replacement: 'A-dup' },   // 同 span 去重
  ];
  const r = applyFindingsToContent(text, fs);
  assert.equal(r.edits.length, 1);
  assert.equal(r.content, 'xxx A yyy');
});

test('applyFindingsToContent: 零长 inject 不被丢', () => {
  const text = 'import * as a from "@ohos.a";\na.foo();';
  const fs = [
    { matchStart: 29, matchEnd: 29, replacement: '\nimport * as b from "@ohos.b";' },
    { matchStart: 32, matchEnd: 35, replacement: 'bar' },
  ];
  const r = applyFindingsToContent(text, fs);
  assert.equal(r.edits.length, 2);
  assert.ok(r.content.includes('import * as b from "@ohos.b"'));
  assert.ok(r.content.includes('a.bar'));
});

test('applyFindingsToContent: rewrite-import specifier 精确 splice', () => {
  const text = 'import * as x from "@ohos.old";';
  const fs = [{ matchStart: 19, matchEnd: 30, replacement: '"@ohos.new"' }];
  const r = applyFindingsToContent(text, fs);
  assert.equal(r.content, 'import * as x from "@ohos.new";');
});

test('dedupeOverlapping: 部分重叠丢短的', () => {
  const edits = [
    { matchStart: 0, matchEnd: 10, replacement: 'LONG' },
    { matchStart: 5, matchEnd: 8, replacement: 'SHORT' },
  ];
  // SHORT 实占字符进 LONG 区间 → 丢 SHORT，保留 LONG
  const kept = dedupeOverlapping(edits);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].replacement, 'LONG');
});

// ---- classifyHit ----

function makeIndex(entries, kitIndex = {}, kitExports = {}, kitDefaultExport = {}) {
  return buildIndex({ entries, kitIndex, kitExports, kitDefaultExport });
}
function makeAllocator(content) {
  return createBindingAllocator(content, new Set());
}

test('classifyHit: instanceSafe 同 kit 改名 → rename-member', () => {
  const entries = [{ dep: { kit: '@ohos.util', exportName: 'util', members: ['oldM'] }, repl: { kit: '@ohos.util', members: ['newM'] }, instanceSafe: true }];
  const idx = makeIndex(entries);
  const alloc = makeAllocator('import * as util from "@ohos.util";');
  const hit = { kit: '@ohos.util', exportName: 'util', members: ['oldM'], callee: 'util.oldM', start: 4, line: 1 };
  const f = classifyHit(hit, idx, alloc);
  assert.equal(f.rule, 'rename-member');
  assert.equal(f.replacement, 'util.newM');
  assert.equal(f.matchStart, 4);
  assert.equal(f.matchEnd, 13);
});

test('classifyHit: crossKitMemberDropin → rename-member 换 binding + 触发 inject', () => {
  const entries = [{ dep: { kit: '@ohos.a', exportName: 'a', members: ['oldM'] }, repl: { kit: '@ohos.b', members: ['newM'] }, crossKitMemberDropin: true }];
  const idx = makeIndex(entries);
  const alloc = makeAllocator('import * as a from "@ohos.a";');
  const hit = { kit: '@ohos.a', exportName: 'a', members: ['oldM'], callee: 'a.oldM', start: 0, line: 1 };
  const f = classifyHit(hit, idx, alloc);
  assert.equal(f.rule, 'rename-member');
  assert.equal(f.replacement.startsWith('b.'), true); // 新 binding 'b'（@ohos.b 末段）
  assert.equal(f.replacement, 'b.newM');
  // inject 已记一条
  const inj = alloc.injectImports('import * as a from "@ohos.a";');
  assert.equal(inj.length, 1);
  assert.ok(inj[0].replacement.includes('@ohos.b'));
});

test('classifyHit: kit 迁移且 chain 相同（aligned covered）→ null', () => {
  const entries = [{ dep: { kit: '@ohos.old', exportName: 'x', members: ['m'] }, repl: { kit: '@ohos.new', members: ['m'] } }];
  const kitIndex = { '@ohos.old': { newKit: '@ohos.new' } };
  const idx = makeIndex(entries, kitIndex);
  const alloc = makeAllocator('import * as x from "@ohos.old";');
  const hit = { kit: '@ohos.old', exportName: 'x', members: ['m'], callee: 'x.m', start: 0, line: 1 };
  const f = classifyHit(hit, idx, alloc);
  assert.equal(f, null); // suppressed — covered by rewrite-import
});

test('classifyHit: 无 entry → null', () => {
  const idx = makeIndex([]);
  const alloc = makeAllocator('');
  const hit = { kit: '@ohos.none', exportName: 'x', members: ['m'], callee: 'x.m', start: 0, line: 1 };
  assert.equal(classifyHit(hit, idx, alloc), null);
});

test('lookupEntry: 命中与未命中', () => {
  const entries = [{ dep: { kit: '@ohos.util', exportName: 'util', members: ['a', 'b'] }, repl: null }];
  const idx = makeIndex(entries);
  assert.ok(lookupEntry(idx, '@ohos.util', 'util', ['a', 'b']));
  assert.equal(lookupEntry(idx, '@ohos.util', 'util', ['a']), null);
  assert.equal(lookupEntry(idx, '@ohos.x', 'y', ['z']), null);
});

// ---- filterObviousSubset / gate ----

test('isSameKitRename: 同 binding + kit 未迁 + 新叶是真实导出 → true', () => {
  const f = { rule: 'rename-member', from: 'util.oldM', replacement: 'util.newM', matchStart: 0, needsManual: false };
  const bindingMap = new Map([['util', '@ohos.util']]);
  const kitExports = { '@ohos.util': ['newM'] };
  const kitIndex = {};
  assert.equal(isSameKitRename(f, bindingMap, kitExports, kitIndex), true);
});

test('isSameKitRename: kit 已迁移 → false（aligned 依赖 import 换，非独立正确）', () => {
  const f = { rule: 'rename-member', from: 'util.oldM', replacement: 'util.newM', matchStart: 0, needsManual: false };
  const bindingMap = new Map([['util', '@ohos.util']]);
  const kitExports = { '@ohos.util': ['newM'] };
  const kitIndex = { '@ohos.util': { newKit: '@ohos.util2' } };
  assert.equal(isSameKitRename(f, bindingMap, kitExports, kitIndex), false);
});

test('isSameKitRename: 跨 binding（cross-kit dropin）→ false', () => {
  const f = { rule: 'rename-member', from: 'a.oldM', replacement: 'b.newM', matchStart: 0, needsManual: false };
  const bindingMap = new Map([['a', '@ohos.a']]);
  assert.equal(isSameKitRename(f, bindingMap, { '@ohos.a': ['newM'] }, {}), false);
});

test('isWholeKitSwap: 单 namespace binding + 全成员在新 kit → true', () => {
  const content = 'import * as x from "@ohos.old";\nx.foo();\nx.bar();';
  const f = { rule: 'rewrite-import', from: '@ohos.old', to: '@ohos.new', line: 1 };
  const imports = [{ specifier: '@ohos.old', line: 1, bindings: [{ imported: '*', local: 'x' }] }];
  const kitExports = { '@ohos.new': ['foo', 'bar'] };
  const kitIndex = { '@ohos.old': { newKit: '@ohos.new' } };
  assert.equal(isWholeKitSwap(f, imports, content, kitExports, kitIndex), true);
});

test('isWholeKitSwap: 有成员在新 kit 不存在 → false', () => {
  const content = 'import * as x from "@ohos.old";\nx.foo();\nx.missing();';
  const f = { rule: 'rewrite-import', from: '@ohos.old', to: '@ohos.new', line: 1 };
  const imports = [{ specifier: '@ohos.old', line: 1, bindings: [{ imported: '*', local: 'x' }] }];
  const kitExports = { '@ohos.new': ['foo'] };
  const kitIndex = { '@ohos.old': { newKit: '@ohos.new' } };
  assert.equal(isWholeKitSwap(f, imports, content, kitExports, kitIndex), false);
});
