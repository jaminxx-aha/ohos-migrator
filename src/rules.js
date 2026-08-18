/**
 * rules.js — 确定性重写规则引擎（MVP 三条规则）。消费 scan.js 的 hits +
 * deprecation-map 的预建条目，产出 Finding 并 bottom-up splice。
 *
 * 三条规则（移植自参考 rewriter.ts + member-scanner.ts 的 MVP 子集）：
 *  - rewrite-import：kit 整体迁移，换 import specifier（29 个 kit；连带把
 *    aligned 的 instanceSafe/crossKitMemberDropin 成员带走，无需成员级 splice）。
 *  - rename-member：同 kit 成员改名（sameKit && sameLength && chain 变），
 *    splice `binding.<depChain>` → `binding.<replChain>`。
 *  - rename-member（crossKitMemberDropin）：成员迁到另一 kit，注入新 import +
 *    rebind receiver `oldBinding.<chain>` → `newBinding.<replChain>`。
 *  - inject-import：跨 kit rebind 时每文件一条零长注入，由 binding-allocator 产出。
 *
 * 残料（map 查不到 / manual / cross-kit 需 wiring / 命名导入子句级 export 改名）
 * 一律 classifyHit 返回 null，交 AI。nestedContainerInsert（8 条）顺手覆盖。
 */
const fs = require('fs');
const path = require('path');
const { loadMap, buildIndex, lookupEntry } = require('./deprecation-map');
const { scanFile } = require('./scan');
const { extractImports, extractBindingMap } = require('./import-extractor');
const { createBindingAllocator } = require('./binding-allocator');

/** callee 减去尾部 `.<depMembers.join('.')>` 得 binding 前缀；无前缀返回 ''。 */
function calleePrefix(callee, depMembers) {
  const depChain = (depMembers || []).join('.');
  const cut = callee.length - depChain.length - 1;
  return cut >= 0 ? callee.slice(0, cut) : '';
}

/**
 * 结构化成员替换分类（移植自参考 describeMemberReplacement）。
 * 返回 { rule, replacement?, note, suppressed? } 或 null。suppressed=true 表示
 * 被 rewrite-import 覆盖或自指，classifyHit 据此返回 null。
 */
function describeMemberReplacement(binding, depKit, depMembers, repl, kitMove) {
  if (!repl || !repl.members || repl.members.length === 0) {
    return { rule: 'manual', note: 'no @useinstead replacement' };
  }
  const rMembers = repl.members;
  const aligned = !!(repl.kit && kitMove && kitMove(depKit) === repl.kit);
  const sameKit = !repl.kit || repl.kit === depKit || aligned;
  const trustworthy = repl.kit ? true : rMembers.length === 1;
  const sameLength = depMembers.length > 0 && depMembers.length === rMembers.length;
  const chainEqual = sameLength && depMembers.every((x, i) => x === rMembers[i]);
  if (sameKit && chainEqual) {
    return {
      rule: 'manual', suppressed: true,
      note: aligned ? 'covered by kit move (rewrite-import re-points the binding)'
        : 'replacement identical to deprecated symbol (self-referential)',
    };
  }
  if (sameKit && trustworthy && sameLength) {
    const chain = rMembers.join('.');
    return { rule: 'rename-member', replacement: `${binding}.${chain}`, note: `rename member -> ${chain}` + (aligned ? ' (after kit move re-points the binding)' : '') };
  }
  if (repl.kit) {
    return { rule: 'manual', note: `cross-kit replacement -> ${repl.kit} (requires wiring changes)` };
  }
  return { rule: 'manual', note: 'unresolved replacement chain (kit not resolved)' };
}

/**
 * hit → Finding 或 null（残料交 AI）。移植自参考 classifyMemberCallSite 的 MVP 子集。
 * Finding：{ rule, matchStart, matchEnd, replacement, note }。rule ∈ rename-member。
 * rewrite-import/inject-import 不由此产出（rewrite-import 在 rewriteFileDeterministic
 * 由 extractImports 产出；inject-import 由 allocator.injectImports 产出）。
 */
function classifyHit(hit, index, allocator) {
  const e = lookupEntry(index, hit.kit, hit.exportName, hit.members);
  if (!e) return null;
  const kitMove = (k) => (index.kitIndex[k] && index.kitIndex[k].newKit) || undefined;
  const callee = hit.callee;
  const depMembers = e.dep.members || [];
  const repl = e.repl;

  // Branch A: cross-kit 成员 drop-in（注入 import + rebind receiver）
  if (e.crossKitMemberDropin && repl && repl.kit && repl.members && repl.members.length) {
    const { binding: newBinding } = allocator.pickBinding(repl.kit);
    const replChain = repl.members.join('.');
    const replacement = `${newBinding}.${replChain}`;
    return { rule: 'rename-member', matchStart: hit.start, matchEnd: hit.start + callee.length, replacement, note: `cross-kit rebind -> ${repl.kit}.${replChain} (injected import)` };
  }
  // Branch B: same-kit 嵌套容器插入（复用 binding）
  if (e.nestedContainerInsert && repl && repl.members && repl.members.length > 1) {
    const prefix = calleePrefix(callee, depMembers);
    if (!prefix) return null;
    const replChain = repl.members.join('.');
    return { rule: 'rename-member', matchStart: hit.start, matchEnd: hit.start + callee.length, replacement: `${prefix}.${replChain}`, note: `nested container insert -> ${prefix}.${replChain}` };
  }
  // Branch C: 结构化分类
  const prefix = calleePrefix(callee, depMembers);
  if (!prefix) return null; // 裸标识符调用（rename-export 领域，本工具第二期）
  const desc = describeMemberReplacement(prefix, e.dep.kit, depMembers, repl, kitMove);
  if (!desc || desc.suppressed) return null;
  if (desc.rule === 'rename-member' && desc.replacement) {
    return { rule: 'rename-member', matchStart: hit.start, matchEnd: hit.start + callee.length, replacement: desc.replacement, note: desc.note };
  }
  return null; // manual → AI
}

/**
 * bottom-up splice + overlap dedupe（移植自参考 rewriter.ts applyFindingsToContent
 * + dedupeOverlapping）。finding：{ matchStart, matchEnd, replacement }。
 * 排序 start desc、end desc（让 replacement 先于零长 inject 在同 offset 落地）；
 * overlap dedupe 保留最长 span，零长 inject（start===end）永不被丢。
 */
function dedupeOverlapping(edits) {
  const sorted = [...edits].sort((a, b) => a.matchStart - b.matchStart || b.matchEnd - a.matchEnd);
  const kept = [];
  const seen = new Set();
  for (const e of sorted) {
    const key = `${e.matchStart}\0${e.matchEnd}`;
    if (seen.has(key)) continue;
    if (kept.length) {
      const prev = kept[kept.length - 1];
      // 重叠需 e 起 < prev 止 且 e 实占字符进 prev（e.matchEnd > prev.matchStart）；
      // 零长 inject（e.matchStart===e.matchEnd）不满足第二子句 → 保留。
      if (e.matchStart < prev.matchEnd && e.matchEnd > prev.matchStart) continue;
    }
    seen.add(key);
    kept.push(e);
  }
  return kept;
}

function applyFindingsToContent(content, findings) {
  const edits = findings.filter((f) => f.replacement != null && f.matchStart != null && f.matchEnd != null);
  const deduped = dedupeOverlapping(edits);
  deduped.sort((a, b) => b.matchStart - a.matchStart || b.matchEnd - a.matchEnd);
  let next = content;
  for (const e of deduped) {
    next = next.slice(0, e.matchStart) + e.replacement + next.slice(e.matchEnd);
  }
  return { content: next, edits: deduped };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** 文件里所有 `binding.<ident>` 成员访问（值位），先去注释防 JSDoc 误判。移植自参考 subset.ts。 */
function accessedMembers(content, binding) {
  const out = new Set();
  if (!binding) return out;
  const code = content.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
  const re = new RegExp(`\\b${escapeRe(binding)}\\.([A-Za-z_$][\\w$]*)`, 'g');
  let m;
  while ((m = re.exec(code)) !== null) out.add(m[1]);
  return out;
}

/**
 * 安全门禁（移植自参考 subset.ts filterObviousSubset）：只留「构造上即正确」的编辑。
 *  - A 同 kit 同 binding 改名：rename-member、非 manual、replacement 与 oldSymbol 同
 *    binding 前缀、binding 的 kit 已知且未迁移、新链首段是该 kit 的真实导出。
 *  - B 整 kit import 换：rewrite-import、kitIndex 真迁移、default/namespace 单 binding、
 *    新 kit 导出非空且文件里该 binding 的每个成员访问都在新 kit 导出里。
 * 其余（cross-kit dropin、inject、override、命名导入子句、aligned 改名、manual）
 * 一律丢，交 AI。命名导入子句级（import {A,B}）也丢——per-binding 解析更繁，交 AI。
 */
function isSameKitRename(f, bindingMap, kitExports, kitIndex) {
  if (f.rule !== 'rename-member') return false;
  if (f.needsManual) return false;
  if (f.replacement == null || f.matchStart == null || f.from == null) return false;
  const bOld = f.from.split('.')[0];
  const bNew = f.replacement.split('.')[0];
  if (!bOld || bOld !== bNew) return false;
  const kit = bindingMap.get(bOld);
  if (!kit) return false;
  if (kitIndex[kit] && kitIndex[kit].newKit) return false;
  const newChain = f.replacement.slice(bNew.length + 1);
  const firstSeg = newChain.split('.')[0];
  if (!firstSeg) return false;
  if (!(kitExports[kit] || []).includes(firstSeg)) return false;
  return true;
}

function isWholeKitSwap(f, imports, content, kitExports, kitIndex) {
  if (f.rule !== 'rewrite-import') return false;
  if (!f.to) return false;
  if (!(kitIndex[f.from] && kitIndex[f.from].newKit === f.to)) return false;
  const imp = imports.find((i) => i.line === f.line && i.specifier === f.from);
  if (!imp) return false;
  if (imp.bindings.length !== 1) return false;
  const b = imp.bindings[0];
  if (b.imported !== 'default' && b.imported !== '*') return false;
  const exports = kitExports[f.to] || [];
  if (exports.length === 0) return false;
  const used = accessedMembers(content, b.local);
  if (used.size === 0) return true;
  for (const ident of used) {
    if (!exports.includes(ident)) return false;
  }
  return true;
}

function filterObviousSubset(findings, content, index) {
  const kitExports = index.kitExports;
  const kitIndex = index.kitIndex;
  const bindingMap = extractBindingMap(content);
  const imports = extractImports(content);
  const kept = [];
  for (const f of findings) {
    if (isSameKitRename(f, bindingMap, kitExports, kitIndex)) { kept.push(f); continue; }
    if (isWholeKitSwap(f, imports, content, kitExports, kitIndex)) { kept.push(f); continue; }
  }
  return kept;
}

/**
 * 对单文件跑确定性重写：scan → 提 imports/allocator → 逐 hit classify + 加
 * rewrite-import/inject findings → filterObviousSubset 安全门（只留构造上即正确的）
 * → applyFindingsToContent → 写回。返回 { changed, applied, kept, original, file }。
 * kept（带 file/line/rule）供 cmdRewriteDeterministic 的 verify-revert 按行归因回滚；
 * original 是改前原文，回滚时还原。被 gate 丢的 hit 不在此处理，由 AI pass 重扫接管。
 */
function rewriteFileDeterministic(file, ts, sdkPath, ohTsPath, map, index) {
  const res = scanFile(file, ts, sdkPath, ohTsPath);
  const original = fs.readFileSync(file, 'utf8');
  const content = original;
  const defaultExportKits = new Set(Object.keys(index.kitDefaultExport || {}));
  const allocator = createBindingAllocator(content, defaultExportKits);

  const findings = [];
  for (const h of res.hits) {
    const f = classifyHit(h, index, allocator);
    if (f) findings.push({ ...f, file, line: h.line, from: h.callee, to: f.replacement, needsManual: false });
  }
  // rewrite-import：kit 整体迁移（gate B 会核验每个成员在新 kit 都在，不安全则丢给 AI）
  for (const imp of extractImports(content)) {
    const ki = index.kitIndex[imp.specifier];
    if (ki && ki.newKit) {
      const quote = content[imp.specStart];
      findings.push({
        rule: 'rewrite-import',
        file,
        matchStart: imp.specStart,
        matchEnd: imp.specEnd,
        replacement: `${quote}${ki.newKit}${quote}`,
        line: imp.line,
        from: imp.specifier,
        to: ki.newKit,
        note: `kit moved -> rewrite import specifier to ${ki.newKit}`,
      });
    }
  }
  // 跨 kit rebind 注入的新 import（gate 会丢——cross-kit dropin 不在确定性集，交 AI；但生成无害）
  for (const f of allocator.injectImports(content)) findings.push({ ...f, file });

  const kept = filterObviousSubset(findings, content, index);
  const { content: next, edits } = applyFindingsToContent(content, kept);
  if (edits.length === 0) return { changed: false, applied: 0, kept: [], original, file };
  fs.writeFileSync(file, next, 'utf8');
  return { changed: true, applied: edits.length, kept, original, file };
}

function cmdRewriteDeterministic(opts) {
  const ts = opts._ts || require('./common').loadTs(opts.ohTsPath);
  const map = loadMap({ sdkPath: opts.sdkPath, mapPath: opts.mapPath });
  if (!map) {
    console.warn('[rewrite] 无 deprecation map，降级到 simple 模式（同模块改名）');
    return require('./rewrite-simple').cmdRewriteSimple(opts);
  }
  const index = buildIndex(map);
  const { root, files } = require('./common').resolveTargets(opts);
  const { runHvigor } = require('./verify/hvigor');
  const { revertBrokenEdits } = require('./verify/verify-revert');

  // 基线编译（写前）——基线感知回滚只认「新增」错误，避免 pre-existing 误触。
  const baseline = runHvigor({ projectRoot: root, devecoSdkHome: opts.devecoSdkHome });
  if (!baseline.ran) {
    console.warn(`[verify] 基线 hvigor 未跑：${baseline.reason}（将不做回滚校验，subset 原样落地）`);
  } else {
    console.log(`[verify] 基线 ${baseline.entries.length} 个错误`);
  }

  const originalContents = new Map(); // absPath -> 改前原文（仅改动的文件）
  const applied = [];                 // gate 通过的 findings（带 file/line/rule）
  let changedFiles = 0, totalApplied = 0;
  for (const f of files) {
    let r;
    try { r = rewriteFileDeterministic(f, ts, opts.sdkPath, opts.ohTsPath, map, index); }
    catch (e) { console.error(`[rewrite error] ${f}: ${e.message}`); continue; }
    if (r.changed) {
      changedFiles++;
      totalApplied += r.applied;
      originalContents.set(r.file, r.original);
      for (const k of r.kept) applied.push(k);
      console.log(`[rewrite] ${f}  ✓ ${r.applied} deterministic edit(s)`);
    }
  }

  // 写后编译 + 按行归因回滚肇事编辑（移植参考 verify-revert.ts，加基线感知二轮）。
  // hvigor 不可用时跳过，subset 原样落地——edge case 由后续 --use-ai 兜底。
  let revertedCount = 0, survived = totalApplied;
  const post = runHvigor({ projectRoot: root, devecoSdkHome: opts.devecoSdkHome });
  if (post.ran) {
    const res = revertBrokenEdits(root, originalContents, applied, post, baseline.ran ? baseline : null);
    revertedCount = res.reverted.length;
    survived = res.kept.length;
    console.log(`\n[verify] hvigor ran, reverted ${revertedCount} broken edit(s), ${survived} survived`);
  } else {
    console.log(`\n[verify] hvigor skipped: ${post.reason}`);
  }

  console.log(`\n==== rewrite(deterministic) done: ${files.length} file(s), ${changedFiles} changed, ${survived} survived (of ${totalApplied} applied, ${revertedCount} reverted) ====`);
  console.log('note: cross-kit/member-dropin/manual/namespace-chain cases are NOT touched deterministically — retry with --use-ai.');
}

module.exports = {
  calleePrefix, describeMemberReplacement, classifyHit,
  dedupeOverlapping, applyFindingsToContent,
  escapeRe, accessedMembers, isSameKitRename, isWholeKitSwap, filterObviousSubset,
  rewriteFileDeterministic, cmdRewriteDeterministic,
};
