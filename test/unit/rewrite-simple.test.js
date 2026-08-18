const test = require('node:test');
const assert = require('node:assert/strict');
const { applySimpleRewrites, escapeRe } = require('../../src/rewrite-simple');

// 合成 hit 的最小字段集：applySimpleRewrites 只读 useinstead/member/memberOffset/depModule/callee/line。
function hit(o) { return o; }

test('applySimpleRewrites: 同模块改名 → 替换成功', () => {
  // callee 'accessibility.isOpenAccessibility'，member 'isOpenAccessibility' 起于 offset 14
  const text = 'accessibility.isOpenAccessibility();';
  const h = hit({
    callee: 'accessibility.isOpenAccessibility',
    member: 'isOpenAccessibility',
    memberOffset: 14,
    depModule: '@ohos.accessibility',
    line: 1,
    useinstead: 'ohos.accessibility#isOpenAccessibilitySync',
  });
  const r = applySimpleRewrites(text, [h]);
  assert.equal(r.changed, true);
  assert.equal(r.applied, 1);
  assert.equal(r.skipped, 0);
  assert.equal(r.text, 'accessibility.isOpenAccessibilitySync();');
  assert.deepEqual(r.details, [{ line: 1, from: 'accessibility.isOpenAccessibility', to: 'accessibility.isOpenAccessibilitySync' }]);
});

test('applySimpleRewrites: 空废弃 → no deprecated usage', () => {
  const r = applySimpleRewrites('let x = 1;', []);
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'no deprecated usage');
  assert.equal(r.applied, 0);
  assert.equal(r.text, 'let x = 1;');
});

test('applySimpleRewrites: 无 useinstead → 全跳过', () => {
  const h = hit({ callee: 'a.foo', member: 'foo', memberOffset: 2, depModule: '@ohos.x', line: 1, useinstead: null });
  const r = applySimpleRewrites('a.foo();', [h]);
  assert.equal(r.changed, false);
  assert.equal(r.skipped, 1);
  assert.equal(r.reason.includes('no eligible'), true);
  assert.equal(r.text, 'a.foo();');
});

test('applySimpleRewrites: 带命名空间链（hasSlash）→ 跳过', () => {
  const h = hit({
    callee: 'dataUriUtils.getId', member: 'getId', memberOffset: 13, depModule: '@ohos.app.ability.dataUriUtils',
    line: 1, useinstead: 'ohos.app.ability.dataUriUtils/dataUriUtils#getId',
  });
  const r = applySimpleRewrites('dataUriUtils.getId();', [h]);
  assert.equal(r.changed, false);
  assert.equal(r.skipped, 1);
  assert.equal(r.text, 'dataUriUtils.getId();');
});

test('applySimpleRewrites: 跨模块（u.module !== depModule）→ 跳过', () => {
  const h = hit({
    callee: 'a.foo', member: 'foo', memberOffset: 2, depModule: '@ohos.y',
    line: 1, useinstead: 'ohos.x#bar',
  });
  const r = applySimpleRewrites('a.foo();', [h]);
  assert.equal(r.changed, false);
  assert.equal(r.skipped, 1);
});

test('applySimpleRewrites: 成员名未变（u.member === h.member）→ 跳过', () => {
  const h = hit({
    callee: 'a.foo', member: 'foo', memberOffset: 2, depModule: '@ohos.x',
    line: 1, useinstead: 'ohos.x#foo',
  });
  const r = applySimpleRewrites('a.foo();', [h]);
  assert.equal(r.changed, false);
  assert.equal(r.skipped, 1);
});

test('applySimpleRewrites: 多处改名按偏移倒序，位置不漂移', () => {
  // 'a.foo(); b.bar();' — foo@2 → foo2，bar@11 → bar2
  // 倒序：先改 bar(11)，再改 foo(2)；foo 在 bar 之前，改 bar 不影响 foo 偏移。
  const text = 'a.foo(); b.bar();';
  const hits = [
    hit({ callee: 'a.foo', member: 'foo', memberOffset: 2, depModule: '@ohos.x', line: 1, useinstead: 'ohos.x#foo2' }),
    hit({ callee: 'b.bar', member: 'bar', memberOffset: 11, depModule: '@ohos.x', line: 1, useinstead: 'ohos.x#bar2' }),
  ];
  const r = applySimpleRewrites(text, hits);
  assert.equal(r.changed, true);
  assert.equal(r.applied, 2);
  assert.equal(r.text, 'a.foo2(); b.bar2();');
});

test('applySimpleRewrites: eligible 与 skipped 混合', () => {
  const text = 'a.foo(); b.bar();';
  const hits = [
    hit({ callee: 'a.foo', member: 'foo', memberOffset: 2, depModule: '@ohos.x', line: 1, useinstead: 'ohos.x#foo2' }), // eligible
    hit({ callee: 'b.bar', member: 'bar', memberOffset: 11, depModule: '@ohos.y', line: 1, useinstead: 'ohos.x#bar2' }), // 跨模块 skip
  ];
  const r = applySimpleRewrites(text, hits);
  assert.equal(r.changed, true);
  assert.equal(r.applied, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.text, 'a.foo2(); b.bar();');
});

test('applySimpleRewrites: depModule 缺省（falsy）→ 跳过', () => {
  const h = hit({ callee: 'a.foo', member: 'foo', memberOffset: 2, depModule: null, line: 1, useinstead: 'ohos.x#foo2' });
  const r = applySimpleRewrites('a.foo();', [h]);
  assert.equal(r.changed, false);
  assert.equal(r.skipped, 1);
});

test('escapeRe: 正则元字符转义', () => {
  assert.equal(escapeRe('foo.bar'), 'foo\\.bar');
  assert.equal(escapeRe('a*b+c?'), 'a\\*b\\+c\\?');
  assert.equal(escapeRe('plain'), 'plain');
});
