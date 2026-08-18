const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUseinstead, normMod } = require('../../src/scan');

test('parseUseinstead: 同模块成员改名（无 /、有 #）', () => {
  const u = parseUseinstead('ohos.accessibility#isOpenAccessibilitySync');
  assert.deepEqual(u, { module: '@ohos.accessibility', member: 'isOpenAccessibilitySync', hasSlash: false });
});

test('parseUseinstead: 跨模块带命名空间链（有 /）', () => {
  const u = parseUseinstead('ohos.app.ability.dataUriUtils/dataUriUtils#getId');
  assert.deepEqual(u, { module: '@ohos.app.ability.dataUriUtils', member: 'getId', hasSlash: true });
});

test('parseUseinstead: 无 # → member 空', () => {
  const u = parseUseinstead('ohos.accessibility');
  assert.deepEqual(u, { module: '@ohos.accessibility', member: '', hasSlash: false });
});

test('parseUseinstead: event 限定格式 → member 取 left 末段、event 单列', () => {
  // 真实样本：off 是成员，# 右是事件名而非成员名
  const u = parseUseinstead('ohos.bluetooth.A2dpSourceProfile.off#event:connectionStateChange');
  assert.equal(u.module, '@ohos.bluetooth.A2dpSourceProfile.off');
  assert.equal(u.member, 'off');            // left 末段，非 # 右
  assert.equal(u.hasSlash, false);
  assert.equal(u.event, 'connectionStateChange');
});

test('parseUseinstead: event 且 hasSlash', () => {
  const u = parseUseinstead('ohos.bluetooth/a2dp.A2dpSourceProfile.off#event:connectionStateChange');
  assert.equal(u.member, 'off');
  assert.equal(u.hasSlash, true);
  assert.equal(u.event, 'connectionStateChange');
});

test('parseUseinstead: null/空串 → null', () => {
  assert.equal(parseUseinstead(''), null);
  assert.equal(parseUseinstead(null), null);
});

test('parseUseinstead: system.* 前缀归一', () => {
  const u = parseUseinstead('system.app.widget#foo');
  assert.equal(u.module, '@system.app.widget');
});

test('normMod: @ 前缀补全', () => {
  assert.equal(normMod('@ohos.x'), '@ohos.x');
  assert.equal(normMod('ohos.x'), '@ohos.x');
  assert.equal(normMod('system.x'), '@system.x');
  assert.equal(normMod('other'), 'other');
});
