const test = require('node:test');
const assert = require('node:assert/strict');
const { jsDocMainComment } = require('../../src/scan');

test('jsDocMainComment: isAfter 真实样本 → 主描述（剔 @tag 行、join 多行）', () => {
  const jsdoc = `/**
 * Requires the target UiComponent which is after another UiComponent that specified by the given {@link By}
 * object,used to locate UiComponent relatively.
 *
 * @param { By } by Describes the attribute requirements of UiComponent which the target one is in back of.
 * @returns { By } this {@link By} object.
 * @syscap SystemCapability.Test.UiTest
 * @since 8
 * @deprecated since 9
 * @useinstead ohos.UiTest.On#isAfter
 * @test
 */`;
  const out = jsDocMainComment(jsdoc);
  assert.equal(out,
    'Requires the target UiComponent which is after another UiComponent that specified by the given {@link By} object,used to locate UiComponent relatively.');
});

test('jsDocMainComment: 纯描述无 tag → 原文 join', () => {
  const jsdoc = `/**
 * Appends a specified key/value pair as a new search parameter.
 */`;
  assert.equal(jsDocMainComment(jsdoc),
    'Appends a specified key/value pair as a new search parameter.');
});

test('jsDocMainComment: 描述在前 tag 在后、多段空行 → 压成一句', () => {
  const jsdoc = `/**
 * 第一段。
 *
 * 第二段。
 * @since 7
 */`;
  assert.equal(jsDocMainComment(jsdoc), '第一段。 第二段。');
});

test('jsDocMainComment: 单行描述', () => {
  assert.equal(jsDocMainComment('/** only desc */'), 'only desc');
});

test('jsDocMainComment: 只有 @tag 无描述 → 空串', () => {
  const jsdoc = `/**
 * @since 8
 * @deprecated since 9
 */`;
  assert.equal(jsDocMainComment(jsdoc), '');
});

test('jsDocMainComment: 空串 / null / 无 /** 头 → 容错', () => {
  assert.equal(jsDocMainComment(''), '');
  assert.equal(jsDocMainComment(null), '');
  assert.equal(jsDocMainComment(undefined), '');
  // 无 /** 头的普通文本：逐行去 * 前缀、剔 @ 行、join（不报错）
  assert.equal(jsDocMainComment('一行\n第二行'), '一行 第二行');
});
