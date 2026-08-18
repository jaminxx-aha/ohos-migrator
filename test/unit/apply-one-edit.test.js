const test = require('node:test');
const assert = require('node:assert/strict');
const { applyOneEdit } = require('../../src/ai-agent');

test('applyOneEdit: 唯一出现 → 替换成功，返回新内容与偏移', () => {
  const r = applyOneEdit('foo bar baz', 'bar', 'BAR');
  assert.equal(r.ok, true);
  assert.equal(r.occurrences, 1);
  assert.equal(r.offset, 4);
  assert.equal(r.content, 'foo BAR baz');
});

test('applyOneEdit: 不存在 → notFound', () => {
  const r = applyOneEdit('foo bar', 'xxx', 'y');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'notFound');
  assert.equal(r.occurrences, 0);
});

test('applyOneEdit: 多次出现 → ambiguous，不改', () => {
  const r = applyOneEdit('foo foo foo', 'foo', 'bar');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ambiguous');
  assert.equal(r.occurrences, 3);
  assert.equal(r.content, undefined);
});

test('applyOneEdit: 空 oldText → empty oldText，不改', () => {
  const r = applyOneEdit('foo bar', '', 'x');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'empty oldText');
});

test('applyOneEdit: oldText===newText 仍按唯一性放行（幂等）', () => {
  // 调用方语义：唯一即应用。是否真改由调用方把关，这里只验机制。
  const r = applyOneEdit('foo bar', 'bar', 'bar');
  assert.equal(r.ok, true);
  assert.equal(r.content, 'foo bar');
});

test('applyOneEdit: 重叠子串按非重叠计数（命中后 i+=len 前进）', () => {
  // 'aaa' 中找 'aa'：index0 命中后 i+=2，从 index2 起仅剩 1 字符不再命中 → 计 1 次（非 2 次）
  // → 视为唯一，替换为 'ba'。这锁定了 indexOf 递增步进的非重叠语义。
  const r = applyOneEdit('aaa', 'aa', 'b');
  assert.equal(r.ok, true);
  assert.equal(r.occurrences, 1);
  assert.equal(r.content, 'ba');
});
