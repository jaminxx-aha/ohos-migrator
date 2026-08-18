/**
 * rewrite-simple.js — 简单模式（无 --use-ai）：仅"同模块纯成员改名"。
 * 只处理 useinstead 形如 `ohos.<mod>#<member>`（无 `/` 命名空间链）且
 * 模块===废弃声明所在 SDK 模块、成员名不同的情况。跨模块/带命名空间链一律跳过，
 * 提示改用 --use-ai。按偏移倒序替换避免位置漂移。
 */
const fs = require('fs');
const { loadTs, resolveTargets } = require('./common');
const { scanFile, parseUseinstead } = require('./scan');

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * 纯函数：给定原文与 scanFile 产出的 hits，按"同模块纯成员改名"规则选出 eligible 并
 * 按偏移倒序替换，返回新文本与统计。不碰 fs，便于单测。
 * - eligible 条件：useinstead 存在、无 `/` 命名空间链、模块===废弃声明所在 SDK 模块、成员名不同。
 * - 倒序替换避免位置漂移（前一处替换后其后偏移不变）。
 */
function applySimpleRewrites(text, hits) {
  if (hits.length === 0) return { changed: false, reason: 'no deprecated usage', applied: 0, skipped: 0, text };
  const eligible = [];
  let skipped = 0;
  for (const h of hits) {
    if (!h.useinstead) { skipped++; continue; }
    const u = parseUseinstead(h.useinstead);
    if (!u || !u.member) { skipped++; continue; }
    if (u.hasSlash) { skipped++; continue; }                 // 带命名空间链，复杂，跳过
    if (!h.depModule || u.module !== h.depModule) { skipped++; continue; } // 跨模块，跳过
    if (u.member === h.member) { skipped++; continue; }       // 成员名未变，跳过
    eligible.push({ h, u });
  }
  if (eligible.length === 0) {
    return { changed: false, reason: 'no eligible same-module rename (rest skipped, try --use-ai)', applied: 0, skipped, text };
  }
  // 按偏移倒序替换，避免位置漂移
  eligible.sort((a, b) => b.h.memberOffset - a.h.memberOffset);
  let out = text;
  for (const { h, u } of eligible) {
    const before = out.slice(0, h.memberOffset);
    const after = out.slice(h.memberOffset + h.member.length);
    out = before + u.member + after;
  }
  return {
    changed: true, reason: `applied ${eligible.length} same-module rename(s)`, applied: eligible.length, skipped, text: out,
    details: eligible.map(({ h, u }) => ({
      line: h.line, from: `${h.callee}`, to: h.callee.replace(new RegExp(`${escapeRe(h.member)}$`), u.member),
    })),
  };
}

function simpleRewriteFile(file, ts, sdkPath, ohTsPath) {
  const res = scanFile(file, ts, sdkPath, ohTsPath);
  const text = fs.readFileSync(file, 'utf8');
  const r = applySimpleRewrites(text, res.hits);
  if (r.changed) fs.writeFileSync(file, r.text, 'utf8');
  return { changed: r.changed, reason: r.reason, applied: r.applied, skipped: r.skipped, details: r.details };
}

function cmdRewriteSimple(opts) {
  const ts = loadTs(opts.ohTsPath);
  const { root, files } = resolveTargets(opts);
  let changedFiles = 0, totalApplied = 0, totalSkipped = 0;
  for (const f of files) {
    const r = simpleRewriteFile(f, ts, opts.sdkPath, opts.ohTsPath);
    if (r.changed) {
      changedFiles++;
      totalApplied += r.applied;
      console.log(`[rewrite] ${f}  ✓ ${r.reason}`);
      for (const d of r.details) console.log(`        ${d.line}: ${d.from}  ->  ${d.to}`);
    } else if (r.skipped > 0 || r.reason.includes('skipped')) {
      totalSkipped += r.skipped;
      console.log(`[rewrite] ${f}  — ${r.reason} (skipped ${r.skipped})`);
    } else {
      console.log(`[rewrite] ${f}  — ${r.reason}`);
    }
  }
  console.log(`\n==== rewrite(simple) done: ${files.length} file(s), ${changedFiles} changed, ${totalApplied} applied, ${totalSkipped} skipped ====`);
  console.log(totalSkipped > 0 ? 'note: skipped cases are cross-module/namespace-chain — retry with --use-ai.' : '');
}

module.exports = { simpleRewriteFile, applySimpleRewrites, escapeRe, cmdRewriteSimple };
