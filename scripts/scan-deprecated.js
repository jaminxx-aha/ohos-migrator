#!/usr/bin/env node
/**
 * scan-deprecated.js — 用 DevEco 自带的 OH 版 TypeScript 编译器扫描单个 .ets/.ts 文件，
 * 提取每个被使用的废弃 API 的完整信息（即 IDE hover 上显示的那一整套字段）。
 *
 * 原理：用编译器 createProgram 解析文件（编译器自己读 SDK .d.ts，本脚本不解析），
 *   checker.getSymbolAtLocation() 解析到 SDK 符号，symbol.getJsDocTags() 拿全部 JSDoc 标签，
 *   用 @deprecated 标签判定废弃。这正是 IDE 语言服务渲染 hover 的方式。
 *
 * 用法:
 *   node scripts/scan-deprecated.js <file.ets> [--sdk <path>] [--oh-ts <path>] [--json]
 *
 * 依赖（均为 DevEco 自带，无需安装）:
 *   --oh-ts  OH 版 typescript 模块路径
 *            默认: 探测 DevEco 安装根后取 <root>/tools/hvigor/hvigor-ohos-plugin/node_modules/typescript
 *   --sdk    OpenHarmony SDK 的 ets/api 目录（.d.ts 所在）
 *            默认: 探测 DevEco SDK home 后取 <sdkHome>/default/openharmony/ets/api
 *            （探测逻辑见 src/common.js 的 findDevEcoSdkHome：DEVECO_SDK_HOME > Win/mac 标准安装）
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { DEFAULT_OH_TS, DEFAULT_SDK } = require('../src/common');

// ---- parse args ----
const args = process.argv.slice(2);
let file = null, sdkPath = DEFAULT_SDK, ohTsPath = DEFAULT_OH_TS, asJson = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--sdk') sdkPath = args[++i];
  else if (a === '--oh-ts') ohTsPath = args[++i];
  else if (a === '--json') asJson = true;
  else if (!a.startsWith('--')) file = a;
}
if (!file) {
  console.error('Usage: node scripts/scan-deprecated.js <file.ets> [--sdk <path>] [--oh-ts <path>] [--json]');
  process.exit(2);
}
file = path.resolve(file);
if (!fs.existsSync(file)) { console.error('file not found:', file); process.exit(2); }

const ts = require(ohTsPath);
const norm = (p) => p.replace(/[\\]/g, '/');

// stock tsc 拒绝 .ets 根文件（6054），且 .ets 里可能有 ArkTS 专有语法。
// 这里把内容作为虚拟 .ts 喂给编译器；行号与原文件一致（逐行相同）。
const isEts = file.toLowerCase().endsWith('.ets');
const rootName = isEts
  ? path.join(os.tmpdir(), `_scan_${path.basename(file).replace(/\.ets$/, '')}.ts`)
  : file;
const srcText = fs.readFileSync(file, 'utf8');
if (isEts) fs.writeFileSync(rootName, srcText, 'utf8');

const host = ts.createCompilerHost({});
const realGetSF = host.getSourceFile.bind(host);
const realFileExists = ts.sys.fileExists ? ts.sys.fileExists.bind(ts.sys) : host.fileExists;

// 让编译器把裸 `@ohos.*` / `@system.*` import 直接解析到 SDK 的 .d.ts
host.fileExists = (fn) => {
  const n = norm(fn);
  if (n.startsWith('@ohos.') || n.startsWith('@system.')) {
    return fs.existsSync(`${sdkPath}/${n}.d.ts`);
  }
  return realFileExists(fn);
};
host.getSourceFile = (fn, lang, onErr, ...rest) => {
  if (norm(fn) === norm(rootName)) return ts.createSourceFile(rootName, srcText, lang, true);
  return realGetSF(fn, lang, onErr, ...rest);
};

const program = ts.createProgram({
  rootNames: [rootName],
  options: {
    target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    noEmit: true, strict: false, skipLibCheck: false, types: [],
    baseUrl: sdkPath,
    paths: {
      '@ohos.*': [`${sdkPath}/@ohos.*.d.ts`],
      '@system.*': [`${sdkPath}/@system.*.d.ts`],
    },
  },
  host,
});

const checker = program.getTypeChecker();
const sf = program.getSourceFile(rootName);
if (!sf) { console.error('failed to parse', file); process.exit(1); }

// ---- helpers ----
// 节点级 JSDocTag 的名字：t.tagName.text；文本：t.comment（string）。
// 符号级 JSDocTag（sym.getJsDocTags）的名字：t.name；文本：t.text（displayParts 数组或 string）。
// 两种来源都兼容。
function tagName(t) {
  if (t.tagName && t.tagName.text) return t.tagName.text;   // 节点级
  if (typeof t.name === 'string') return t.name;            // 符号级
  return '';
}
function tagText(tag) {
  let s;
  if (tag.comment != null) s = String(tag.comment);              // 节点级
  else if (tag.text == null) s = '';
  else if (typeof tag.text === 'string') s = tag.text;          // 符号级 string
  else s = tag.text.map((p) => p.text).join('');                // 符号级 displayParts
  // 折叠换行/多余空白，避免 throws 的多行文本在输出里被截成多段
  return s.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function getContainingClass(decl) {
  if (!decl) return '';
  const parent = decl.parent;
  if (parent && parent.name) return parent.name.getText();
  return '';
}

function descOfDecl(decl) {
  if (!decl) return '';
  try {
    const doc = ts.getJSDocTags(decl).find((t) => !t.tagName); // 无 tagName 的即主描述？不一定有
  } catch (_) {}
  return '';
}

// ---- 遍历 AST，找“对废弃符号的使用” ----
const seen = new Set(); // key: symbolName|line  去重
const hits = [];

function record(node, sym, _preferDecl, calleeText) {
  if (!sym) return;
  // 1) 先用符号合并标签判定是否废弃（任一重载带 @deprecated 即命中）
  const symTags = sym.getJsDocTags ? sym.getJsDocTags() : [];
  if (!symTags.some((t) => tagName(t) === 'deprecated')) return;

  const start = node.getStart(sf);
  const lc = ts.getLineAndCharacterOfPosition(sf, start);
  const line = lc.line + 1, col = lc.character + 1;

  // 2) 在符号的多条重载声明里，挑出带 @deprecated 的那条，取它自己的 JSDoc（精确到该重载，不混入其它重载的 @param）
  let depDecl = null;
  for (const d of sym.declarations || []) {
    const tg = ts.getJSDocTags ? ts.getJSDocTags(d) : [];
    if (tg.some((t) => tagName(t) === 'deprecated')) { depDecl = d; break; }
  }
  const decl = depDecl || _preferDecl || (sym.declarations && sym.declarations[0]);
  const nodeTags = depDecl && ts.getJSDocTags ? ts.getJSDocTags(depDecl) : [];
  const tags = (nodeTags && nodeTags.length) ? nodeTags : symTags; // 优先用节点级（干净），否则符号级（合并）

  const symName = checker.symbolToString(sym);
  const key = `${symName}|${line}`;
  if (seen.has(key)) return;
  seen.add(key);

  const cls = getContainingClass(decl);
  const fields = {};
  for (const t of tags) {
    const n = tagName(t);
    const v = tagText(t);
    if (n === 'param') {
      // 节点级 @param：参数名在 t.name.text，描述在 t.comment
      const pn = (t.name && t.name.text) ? t.name.text : '';
      const body = tagText(t).replace(/^[-\s]+/, '').trim();
      (fields.params ||= []).push(pn ? `${pn} - ${body}` : body);
    }
    else if (n === 'returns') fields.returns = v;
    else if (n === 'throws') (fields.throws ||= []).push(v);
    else if (n === 'syscap') fields.syscap = v;
    else if (n === 'since') fields.since = v;
    else if (n === 'deprecated') fields.deprecated = v; // "since 9"
    else if (n === 'useinstead') fields.useinstead = v;
    else if (n === 'stagemodelonly') fields.stagemodelonly = true;
    else if (n === 'crossplatform') fields.crossplatform = true;
    else if (n === 'atomicservice') fields.atomicservice = true;
  }
  // 描述：符号级 getDocumentationComment 给主描述文本
  let description = '';
  try {
    const parts = sym.getDocumentationComment ? sym.getDocumentationComment(checker) : null;
    if (parts && parts.length) {
      let s = parts.map((p) => p.text).join('').trim();
      const cut = s.search(/<p>|<br>|NOTE/i);
      if (cut > 0) s = s.slice(0, cut).trim();
      description = s;
    }
  } catch (_) {}

  hits.push({
    file,
    line, col,
    callee: calleeText,                       // 源码里的调用写法，如 _v1.createModuleContext
    qualifiedName: cls ? `${cls}.${symName}` : symName, // SDK 里的全限定，如 Context.createModuleContext
    signature: decl ? decl.getText().replace(/;\s*$/, '').trim() : '',
    description,
    deprecated: fields.deprecated || '',      // "since 9"
    useinstead: fields.useinstead || '',
    since: fields.since || '',
    syscap: fields.syscap || '',
    params: fields.params || [],
    returns: fields.returns || '',
    throws: fields.throws || [],
    stagemodelonly: !!fields.stagemodelonly,
    crossplatform: !!fields.crossplatform,
    atomicservice: !!fields.atomicservice,
  });
}

function visit(node) {
  // 在三种节点上尝试解析“被使用的符号”：
  //   - CallExpression        (a.b(...))      → 取 callee 的符号
  //   - PropertyAccessExpr   (a.b)            → 取属性访问整体的符号
  //   - Identifier           (裸名字，如 verifyAccessToken) → 取该名字的符号
  // 任一解析到的符号若带 @deprecated 即记录。dedup 防止同一处重复输出。
  let probeNode = null, calleeText = null;
  if (ts.isCallExpression(node)) {
    probeNode = node.expression;          // 如 _v0.verifyAccessToken
    calleeText = node.expression.getText();
  } else if (ts.isPropertyAccessExpression(node)) {
    probeNode = node;                     // 整体 _v0.verifyAccessToken
    calleeText = node.getText();
  } else if (ts.isIdentifier(node)) {
    probeNode = node;
    calleeText = node.getText();
  }
  if (probeNode) {
    const sym = checker.getSymbolAtLocation(probeNode);
    if (sym) {
      // 对调用，优先用实际命中重载的声明；否则用符号的默认声明
      let decl = sym.valueDeclaration || (sym.declarations && sym.declarations[0]);
      if (ts.isCallExpression(node)) {
        try { const sig = checker.getResolvedSignature(node); if (sig && sig.declaration) decl = sig.declaration; } catch (_) {}
      }
      record(node, sym, decl, calleeText);
    }
  }
  ts.forEachChild(node, visit);
}
visit(sf);

if (isEts) { try { fs.unlinkSync(rootName); } catch (_) {} }

// ---- 输出 ----
if (asJson) {
  console.log(JSON.stringify({ file, deprecatedCount: hits.length, hits }, null, 2));
} else {
  if (!hits.length) { console.log(`[no deprecated usage] ${file}`); process.exit(0); }
  console.log(`${file}  — ${hits.length} deprecated usage(s)\n`);
  for (const h of hits) {
    console.log(`■ ${h.qualifiedName}  (use: ${h.callee})  at ${h.line}:${h.col}`);
    console.log(`  signature:  ${h.signature}`);
    if (h.description) console.log(`  desc:       ${h.description}`);
    console.log(`  since:      ${h.since}`);
    console.log(`  deprecated: ${h.deprecated}`);
    console.log(`  useinstead: ${h.useinstead}`);
    console.log(`  syscap:     ${h.syscap}`);
    for (const p of h.params) console.log(`  param:      ${p}`);
    if (h.returns) console.log(`  returns:    ${h.returns}`);
    for (const t of h.throws) console.log(`  throws:     ${t}`);
    const flags = [];
    if (h.stagemodelonly) flags.push('stagemodelonly');
    if (h.crossplatform) flags.push('crossplatform');
    if (h.atomicservice) flags.push('atomicservice');
    if (flags.length) console.log(`  flags:      ${flags.join(', ')}`);
    console.log('');
  }
}
