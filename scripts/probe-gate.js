/**
 * probe-gate.js — 验证 filterObviousSubset 安全门 + verify-revert 回滚。
 * 复制语料 → 基线 hvigor → cmdRewriteDeterministic（gate+写+编译+按行回滚）
 * → 复编 → 比对「新增错误消息」。目标：survived≈参考 640、newErrors=0。
 * 一次性探针，不进单测。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const common = require('../src/common');
const { runHvigor } = require('../src/verify/hvigor');
const { cmdRewriteDeterministic } = require('../src/rules');

const SRC_PROJECT = path.join(__dirname, '..', 'test', 'deprecated');
const TMP = path.join(os.tmpdir(), `dep-probe-gate-${process.pid}`);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
function errMsgSet(entries) { const m = new Set(); for (const e of entries) m.add(e.message); return m; }

function main() {
  if (!fs.existsSync(SRC_PROJECT)) { console.error('no corpus:', SRC_PROJECT); process.exit(1); }
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  copyDir(SRC_PROJECT, TMP);
  console.log('copied to', TMP);

  console.log('\n=== baseline hvigor ===');
  const base = runHvigor({ projectRoot: TMP });
  if (!base.ran) { console.error('baseline hvigor failed:', base.reason); process.exit(1); }
  const baseMsgs = errMsgSet(base.entries);
  console.log(`baseline: ${base.entries.length} entries, ${baseMsgs.size} distinct messages`);

  console.log('\n=== deterministic rewrite (gate + apply + hvigor + revert) ===');
  const origLog = console.log;
  console.log = (...a) => origLog('  ', ...a);
  cmdRewriteDeterministic({
    project: TMP, _ts: common.loadTs(common.DEFAULT_OH_TS),
    sdkPath: common.DEFAULT_SDK, ohTsPath: common.DEFAULT_OH_TS,
  });
  console.log = origLog;

  console.log('\n=== post-rewrite hvigor (final) ===');
  const post = runHvigor({ projectRoot: TMP });
  if (!post.ran) { console.error('post hvigor failed:', post.reason); process.exit(1); }
  const postMsgs = errMsgSet(post.entries);
  console.log(`post: ${post.entries.length} entries, ${postMsgs.size} distinct messages`);

  const newMsgs = [...postMsgs].filter((m) => !baseMsgs.has(m));
  console.log(`\n=== delta ===`);
  console.log(`NEW errors (post not in baseline): ${newMsgs.length}`);
  for (const m of newMsgs.slice(0, 30)) console.log(`  + ${m}`);

  console.log(`\n==== VERDICT ====`);
  console.log(`newErrors=${newMsgs.length} (target 0)`);
  if (newMsgs.length === 0) console.log('PASS: gate+revert yields no new compile errors');
  else console.log('FAIL: new compile errors remain after revert');

  fs.rmSync(TMP, { recursive: true, force: true });
}
main();
