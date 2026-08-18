/**
 * verify/verify-revert.js — 写后编译 + 按行归因回滚（移植自参考 verify-revert.ts，
 * 加基线感知 + 残留二轮回滚）。
 *
 * filterObviousSubset 只留「构造上即正确」的编辑，但同 kit 成员改名仍可能撞上
 * 签名/类型变更（new leaf 是真实导出，但返回类型变了，使用方在另一行报错）——
 * 这类 slip-through 由 hvigor 兜底：写后整工程编译一次，把「新出现的 ArkTS 错误」
 * 按行归因到编辑，回滚肇事的编辑（从原文重写、只落地幸存编辑），保证磁盘产出
 * 相对基线零新增错误。
 *
 * 归因按行（subset 编辑均零新增行——rename-member 单行 splice 链、rewrite-import
 * 单行换 specifier——故改前改后行号稳定，hvigor 报的 (file,line) 指向同一源行）：
 *  - rename-member：错误落在 f.line → 该编辑 broken。
 *  - rewrite-import：坏换 specifier 表现为「使用行」报错（新 kit 无该成员），不在
 *    import 行。故一文件若有未归因错误且含 import-swap → 回滚该文件的全部 import-swap。
 *  二轮（基线感知）：第一轮后若某文件仍有「新增」未归因错误（非 baseline），
 *  回滚该文件全部幸存编辑——保守（还原原文必编译），保「零新增」铁律。
 *
 * 基线感知：参考不比对基线（假设 subset 编辑行改前干净）。本实现传 baseline 时只把
 * 「post 有、baseline 无」的错误算新增，避免 pre-existing 错误误触回滚。
 */
const { writeFileSync, readFileSync } = require('fs');
const path = require('path');

const norm = (p) => (p || '').replace(/\\/g, '/');
function errKey(e) { return `${norm(e.file)}\0${e.line}\0${e.message}`; }

/**
 * @param {string} projectRoot
 * @param {Map<string,string>} originalContents  absPath -> 改前原文
 * @param {Array} applied  Finding[]（含 file/line/rule）
 * @param {{ran:boolean,entries:Array,reason?:string}} post
 * @param {{entries:Array}|null} [baseline]  基线错误（可选）
 * @returns {{kept,reverted,hvigorRan,reason?}}
 */
function revertBrokenEdits(projectRoot, originalContents, applied, post, baseline) {
  if (!post.ran) {
    return { kept: applied, reverted: [], hvigorRan: false, reason: post.reason || 'hvigor did not run' };
  }
  const baseSet = new Set((baseline && baseline.entries || []).map(errKey));

  // 仅「新增」错误参与归因（基线感知）
  const newErrors = post.entries.filter((e) => !baseSet.has(errKey(e)));
  const errorsByFile = new Map();
  for (const e of newErrors) {
    const f = norm(e.file);
    if (!errorsByFile.has(f)) errorsByFile.set(f, new Map());
    const m = errorsByFile.get(f);
    if (!m.has(e.line)) m.set(e.line, new Set());
    m.get(e.line).add(e.message);
  }

  const broken = new Set();
  const byFile = new Map();
  for (const f of applied) {
    const key = norm(f.file);
    const arr = byFile.get(key) || [];
    arr.push(f);
    byFile.set(key, arr);
  }

  // 第一轮：按行归因
  const filesWithResidual = new Set();
  for (const [file, fileFindings] of byFile) {
    const errMap = errorsByFile.get(file);
    if (!errMap || errMap.size === 0) continue;
    const memberEdits = fileFindings.filter((f) => f.rule === 'rename-member');
    const importEdits = fileFindings.filter((f) => f.rule === 'rewrite-import');
    const memberLines = new Set(memberEdits.map((f) => f.line));
    let unattributed = false;
    for (const line of errMap.keys()) {
      if (memberLines.has(line)) {
        for (const f of memberEdits) if (f.line === line) broken.add(f);
      } else {
        unattributed = true;
      }
    }
    if (unattributed && importEdits.length > 0) {
      for (const f of importEdits) broken.add(f);
    }
    // 记录：仍有未归因错误且 import-swap 回滚后可能不够 → 二轮兜底
    if (unattributed) filesWithResidual.add(file);
  }

  // 第二轮：基线感知下，仍有「新增未归因」错误的文件 → 回滚其全部幸存编辑
  // （保守：还原原文必编译，保零新增铁律；代价是该文件正确编辑也一并退回 AI）
  for (const file of filesWithResidual) {
    const fileFindings = byFile.get(file) || [];
    for (const f of fileFindings) broken.add(f);
  }

  const kept = applied.filter((f) => !broken.has(f));
  const reverted = [...broken];

  // 从原文重写：先全还原，再只落地幸存编辑
  for (const [absPath, content] of originalContents) {
    writeFileSync(absPath, content, 'utf8');
  }
  if (kept.length > 0) {
    const { applyFindingsToContent } = require('../rules');
    const byF = new Map();
    for (const f of kept) {
      const arr = byF.get(f.file) || [];
      arr.push(f);
      byF.set(f.file, arr);
    }
    for (const [absPath, keptFindings] of byF) {
      const content = readFileSync(absPath, 'utf8');
      const { content: next } = applyFindingsToContent(content, keptFindings);
      writeFileSync(absPath, next, 'utf8');
    }
  }
  return { kept, reverted, hvigorRan: true };
}

module.exports = { revertBrokenEdits };
