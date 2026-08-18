const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { deriveDevEcoPaths, listArktsFiles, SKIP_DIRS, ARKTS_EXT } = require('../../src/common');

test('deriveDevEcoPaths: sdkHome 推导 root/ohTs/sdk', () => {
  const sdkHome = 'C:/Program Files/Huawei/DevEco Studio/sdk';
  const root = path.dirname(sdkHome);
  const d = deriveDevEcoPaths(sdkHome);
  assert.equal(d.root, root);
  assert.equal(d.ohTs, path.join(root, 'tools/hvigor/hvigor-ohos-plugin/node_modules/typescript'));
  assert.equal(d.sdk, path.join(sdkHome, 'default/openharmony/ets/api'));
});

test('deriveDevEcoPaths: macOS 路径同样推导', () => {
  const sdkHome = '/Applications/DevEco-Studio.app/Contents/sdk';
  const root = path.dirname(sdkHome);
  const d = deriveDevEcoPaths(sdkHome);
  assert.equal(d.root, root);
  assert.equal(d.ohTs, path.join(root, 'tools/hvigor/hvigor-ohos-plugin/node_modules/typescript'));
  assert.equal(d.sdk, path.join(sdkHome, 'default/openharmony/ets/api'));
});

test('deriveDevEcoPaths: 空 sdkHome → 全空串（消费者报错，不猜测）', () => {
  const d = deriveDevEcoPaths('');
  assert.deepEqual(d, { root: '', ohTs: '', sdk: '' });
});

test('deriveDevEcoPaths: 父目录即 root（path.dirname 语义）', () => {
  // sdkHome 必须是 .../sdk，root 是其父；断言用同一 path.dirname 取期望，跨平台一致
  assert.equal(deriveDevEcoPaths('/a/b/sdk').root, path.dirname('/a/b/sdk'));
});

function tmpTree(spec) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'migrator-common-'));
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(d, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return d;
}

test('listArktsFiles: 收 .ets/.ts，跳过 SKIP_DIRS 与 .d.ts，结果排序', () => {
  const root = tmpTree({
    'a.ets': 'x',
    'b.ts': 'y',
    'c.d.ts': 'z',                 // 声明文件，排除
    'readme.txt': 'r',             // 非 ArkTS 扩展，排除
    'node_modules/x.ets': 'x',     // SKIP
    'build/x.ets': 'x',            // SKIP
    '.preview/y.ets': 'y',         // SKIP
    'sub/d.ets': 'd',             // 子目录正常遍历
  });
  const out = listArktsFiles(root);
  const names = out.map((p) => path.relative(root, p).replace(/\\/g, '/'));
  assert.deepEqual(names, ['a.ets', 'b.ts', 'sub/d.ets']);
});

test('listArktsFiles: 大写扩展名归一（.ETS 仍命中）', () => {
  const root = tmpTree({ 'A.ETS': 'x', 'B.TS': 'y' });
  const out = listArktsFiles(root);
  const names = out.map((p) => path.relative(root, p).replace(/\\/g, '/'));
  assert.deepEqual(names.sort(), ['A.ETS', 'B.TS'].sort());
});

test('listArktsFiles: 空目录 → []', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrator-empty-'));
  assert.deepEqual(listArktsFiles(root), []);
});

test('SKIP_DIRS: 含 node_modules/oh_modules/build/.hvigor 等关键项', () => {
  for (const k of ['node_modules', 'oh_modules', 'build', '.hvigor', '.preview', '.cxx']) {
    assert.ok(SKIP_DIRS.has(k), `SKIP_DIRS 应含 ${k}`);
  }
});

test('ARKTS_EXT: 仅 .ets / .ts', () => {
  assert.equal(ARKTS_EXT.size, 2);
  assert.ok(ARKTS_EXT.has('.ets'));
  assert.ok(ARKTS_EXT.has('.ts'));
});
