/**
 * 扫描鸿蒙 SDK .d.ts，提取所有 @deprecated 声明，生成结构化清单。
 * 用法: node scan-deprecated.mjs <sdk-ets-root> <out.json>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TS_PATH = 'C:/Program Files/Huawei/DevEco Studio/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript/lib/typescript.js';
const ts = require(TS_PATH);

const root = process.argv[2];
const out = process.argv[3];
if (!root || !out) {
  console.error('Usage: node scan-deprecated.mjs <sdk-ets-root> <out.json>');
  process.exit(1);
}

// 递归收集 .d.ts，排除 build-tools / node_modules 等非鸿蒙API
function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'build-tools' || e.name === 'bin') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile() && e.name.endsWith('.d.ts')) acc.push(p);
  }
}

const files = [];
walk(root, files);

const kindName = (k) => ts.SyntaxKind[k] || String(k);

// 取节点上“直接附加”（非继承）的 JSDoc，避免一个注释被多个节点重复归因
function getJsDocs(node) {
  const docs = [];
  if (node.jsDoc) {
    const arr = Array.isArray(node.jsDoc) ? node.jsDoc : [node.jsDoc];
    docs.push(...arr);
  }
  return docs;
}

// 是否为“有意义的声明”节点
const DECL_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration, ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.EnumMember, ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.PropertyDeclaration, ts.SyntaxKind.PropertySignature, ts.SyntaxKind.PropertyAccessExpression,
  ts.SyntaxKind.VariableStatement, ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.ModuleDeclaration, ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.Constructor, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.CallSignature, ts.SyntaxKind.ConstructSignature, ts.SyntaxKind.IndexSignature,
  ts.SyntaxKind.ExportAssignment, ts.SyntaxKind.FunctionType,
]);

// 若节点不是声明，向上找最近的声明祖先
function climbToDecl(node) {
  let n = node;
  while (n) {
    if (DECL_KINDS.has(n.kind)) return n;
    n = n.parent;
  }
  return node;
}

function tagText(tag) {
  // tag.comment 可能是 string | Node[] | undefined
  const c = tag.comment;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => typeof x === 'string' ? x : x.getText?.() ?? '').join('');
  return '';
}

function getContext(node, sf) {
  // 找最近的命名上下文：所属 class/interface/enum/namespace/module 名
  const ctx = [];
  let p = node.parent;
  while (p) {
    const k = p.kind;
    if (k === ts.SyntaxKind.ClassDeclaration || k === ts.SyntaxKind.InterfaceDeclaration ||
        k === ts.SyntaxKind.EnumDeclaration || k === ts.SyntaxKind.ModuleDeclaration ||
        k === ts.SyntaxKind.FunctionDeclaration) {
      const nm = p.name?.escapedText;
      if (nm) ctx.unshift(nm);
      if (k === ts.SyntaxKind.FunctionDeclaration) break;
    }
    p = p.parent;
  }
  return ctx.join('.');
}

const records = [];
let filesWithDeprecated = 0;
const seenDocPos = new Set(); // 全局去重：同一 JSDoc 只记一次

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  ts.bindSourceFile?.(sf, {}); // 建立 parent 关联

  let fileHasDep = false;
  const rel = path.relative(root, file).replace(/\\/g, '/');

  function visit(node) {
    const docs = getJsDocs(node);
    for (const doc of docs) {
      if (!doc.tags) continue;
      let deprecated = null, useinstead = null, syscap = null, since = null;
      for (const t of doc.tags) {
        const nm = t.tagName?.escapedText;
        if (nm === 'deprecated') deprecated = t;
        else if (nm === 'useinstead') useinstead = t;
        else if (nm === 'syscap') syscap = t;
        else if (nm === 'since') since = t;
      }
      if (!deprecated) continue;
      // 按废弃 tag 的位置去重（同一 JSDoc 可能被附加到多个相邻节点）
      const key = doc.pos ?? deprecated.pos ?? (file + ':' + (node.getStart?.() ?? 0));
      if (seenDocPos.has(key)) continue;
      seenDocPos.add(key);

      fileHasDep = true;
      const depText = tagText(deprecated).trim();
      const sinceVer = (depText.match(/since\s+([0-9]+)/)?.[1]) ?? null;
      const useinsteadText = useinstead ? tagText(useinstead).trim() : null;

      // 归因到最近的声明节点
      const target = climbToDecl(node);
      let finalName = target.name?.escapedText ?? null;
      let kind = kindName(target.kind);
      if (target.kind === ts.SyntaxKind.VariableStatement) {
        const d = target.declarationList?.declarations?.[0];
        finalName = d?.name?.escapedText ?? finalName;
        kind = 'Variable';
      } else if (target.kind === ts.SyntaxKind.VariableDeclaration) {
        kind = 'Variable';
      }

      let sig = '';
      try { sig = target.getText(sf); } catch {}
      if (sig && sig.length > 300) sig = sig.slice(0, 300) + '…';

      records.push({
        file: rel,
        subsystem: rel.split('/')[0] + '/' + (rel.split('/')[1] ?? ''),
        kind,
        name: finalName,
        context: getContext(target, sf),
        since: sinceVer,
        sinceTag: since ? tagText(since).trim() : null,
        deprecatedText: depText || null,
        useinstead: useinsteadText,
        syscap: syscap ? tagText(syscap).trim() : null,
        signature: sig.split('\n')[0].trim(),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (fileHasDep) filesWithDeprecated++;
}

// 汇总输出
const summary = {
  totalFiles: files.length,
  filesWithDeprecated,
  totalDeprecated: records.length,
  withUseinstead: records.filter(r => r.useinstead).length,
  withoutUseinstead: records.filter(r => !r.useinstead).length,
  byKind: {},
  bySince: {},
  bySubsystem: {},
  withoutUseinsteadByFile: {},
};
for (const r of records) {
  summary.byKind[r.kind] = (summary.byKind[r.kind] || 0) + 1;
  summary.bySince[r.since || 'unknown'] = (summary.bySince[r.since || 'unknown'] || 0) + 1;
  summary.bySubsystem[r.subsystem] = (summary.bySubsystem[r.subsystem] || 0) + 1;
  if (!r.useinstead) {
    summary.withoutUseinsteadByFile[r.file] = (summary.withoutUseinsteadByFile[r.file] || 0) + 1;
  }
}

fs.writeFileSync(out, JSON.stringify({ summary, records }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log('\nWrote', records.length, 'records to', out);
