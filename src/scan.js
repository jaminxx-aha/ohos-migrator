/**
 * scan.js — 扫描核心：用 OH 版 TS 编译器（createProgram + getSymbolAtLocation + getJsDocTags）检测废弃调用，返回结构化 hits。
 * 每条 hit 额外带 start 偏移、callee、member 段、memberOffset、depModule
 * （废弃声明所在 SDK 模块，如 @ohos.accessibility），供 rewrite 精确定位与同模块判定。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadTs, resolveTargets } = require('./common');

function tagName(t) {
  if (t.tagName && t.tagName.text) return t.tagName.text;
  if (typeof t.name === 'string') return t.name;
  return '';
}
function tagText(tag) {
  let s;
  if (tag.comment != null) s = String(tag.comment);
  else if (tag.text == null) s = '';
  else if (typeof tag.text === 'string') s = tag.text;
  else s = tag.text.map((p) => p.text).join('');
  return s.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}
function getContainingClass(decl) {
  if (!decl) return '';
  const parent = decl.parent;
  if (parent && parent.name) return parent.name.getText();
  return '';
}

// 把 SDK 声明文件名归一成 import 模块名，如 .../api/@ohos.accessibility.d.ts -> @ohos.accessibility
function declFileToModule(ts, decl) {
  if (!decl) return '';
  let fn = '';
  try { fn = decl.getSourceFile().fileName; } catch (_) { return ''; }
  const base = path.basename(fn).replace(/\.d\.ts$/i, '');
  return base.startsWith('@') ? base : '';
}

// 解析 useinstead。返回 { module, member, hasSlash }
//   ohos.accessibility#isOpenAccessibilitySync  -> @ohos.accessibility / isOpenAccessibilitySync / false
//   ohos.app.ability.dataUriUtils/dataUriUtils#getId -> @ohos.app.ability.dataUriUtils / getId / true
//   成员缺省（无 #）时 member 为空。
function parseUseinstead(str) {
  if (!str) return null;
  const s = str.trim();
  const hashIdx = s.indexOf('#');
  if (hashIdx < 0) return { module: normMod(s), member: '', hasSlash: s.includes('/') };
  const left = s.slice(0, hashIdx);
  const right = s.slice(hashIdx + 1).trim();
  // module 取 left 中 `/` 之前的部分（useinstead 形如 `ohos.app.ability.dataUriUtils/dataUriUtils#getId`
  // 的 `/ns` 段是命名空间、非模块名）。hasSlash 仍按 left 是否含 `/` 判定，供 simple 模式跳过。
  const slash = left.indexOf('/');
  const mod = slash < 0 ? normMod(left) : normMod(left.slice(0, slash));
  // 事件限定格式 `module.path.member#event:<name>`：`#` 右是事件名而非成员名，真正的
  // member 是 left 末段（如 ...A2dpSourceProfile.off#event:connectionStateChange → off）。
  // 常规格式 `module#member`：member 即 `#` 右。按 right 是否 event: 前缀区分。
  // 事件格式当前因 hasSlash 在 simple 模式被跳过、AI 模式传原始串，member 修正仅为语义正确。
  if (right.startsWith('event:')) {
    const lastDot = left.lastIndexOf('.');
    return { module: mod, member: lastDot >= 0 ? left.slice(lastDot + 1) : left, hasSlash: left.includes('/'), event: right.slice(6) };
  }
  return { module: mod, member: right, hasSlash: left.includes('/') };
}
function normMod(left) {
  let m = left.trim();
  if (m.startsWith('@')) return m;
  if (m.startsWith('ohos.')) return '@' + m;
  if (m.startsWith('system.')) return '@' + m;
  return m;
}

/**
 * 扫描单个文件，返回 { file, deprecatedCount, hits }。
 * hit 字段：file,line,col,callee,qualifiedName,useinstead,depModule,start,member,memberOffset
 */
function scanFile(file, ts, sdkPath, ohTsPath) {
  // 临时 .ts 落盘 + try/finally 清理：原 .ets 被 OH 版 TS 拒收，复制成 .ts 作 rootName。
  // 任何早退（!sf）/异常（visit 中 getSymbolAtLocation 等抛错）都走 finally 删临时文件，
  // 避免源码残留在 os.tmpdir()（多用户机可读）。
  const isEts = file.toLowerCase().endsWith('.ets');
  const rootName = isEts
    ? path.join(os.tmpdir(), `_scan_${path.basename(file).replace(/\.ets$/, '')}.ts`)
    : file;
  const srcText = fs.readFileSync(file, 'utf8');
  if (isEts) fs.writeFileSync(rootName, srcText, 'utf8');
  try {
    return scanInner(file, ts, sdkPath, ohTsPath, rootName, srcText);
  } finally {
    if (isEts) { try { fs.unlinkSync(rootName); } catch (_) {} }
  }
}

function scanInner(file, ts, sdkPath, ohTsPath, rootName, srcText) {
  const norm = (p) => p.replace(/[\\]/g, '/');

  const host = ts.createCompilerHost({});
  const realGetSF = host.getSourceFile.bind(host);
  const realFileExists = ts.sys.fileExists ? ts.sys.fileExists.bind(ts.sys) : host.fileExists;

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
      noEmit: true, strict: false, skipLibCheck: true, types: [],
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
  if (!sf) return { file, deprecatedCount: 0, hits: [] };

  const seen = new Set();
  const hits = [];

  function record(node, sym, preferDecl, calleeText) {
    if (!sym) return;
    const symTags = sym.getJsDocTags ? sym.getJsDocTags() : [];
    if (!symTags.some((t) => tagName(t) === 'deprecated')) return;

    const start = node.getStart(sf);
    const lc = ts.getLineAndCharacterOfPosition(sf, start);
    const line = lc.line + 1, col = lc.character + 1;

    let depDecl = null;
    for (const d of sym.declarations || []) {
      const tg = ts.getJSDocTags ? ts.getJSDocTags(d) : [];
      if (tg.some((t) => tagName(t) === 'deprecated')) { depDecl = d; break; }
    }
    const decl = depDecl || preferDecl || (sym.declarations && sym.declarations[0]);
    const nodeTags = depDecl && ts.getJSDocTags ? ts.getJSDocTags(depDecl) : [];
    const tags = (nodeTags && nodeTags.length) ? nodeTags : symTags;

    const symName = checker.symbolToString(sym);
    // 去重键 symName|line：visit 递归时 CallExpression、其子 PropertyAccess、以及 PA.name
    // identifier 会探到同一调用点（同 sym 同行），需折叠避免重复计数。注意——键不能改用
    // start 偏移：PA.name identifier 的 start（成员名位置）与调用点最左标识符不同，会逃过
    // 折叠；而 PA 节点对"容器符号"（deprecated enum/namespace 经成员访问引用，如
    // huks.HuksErrorCode.MEMBER 里的 HuksErrorCode）常解析不到 symbol，仅靠 name identifier
    // 命中，跳过 name 会漏报。symName|line 折叠重复、保留独立命中，是经验证的正确粒度。
    // 唯一理论边缘：同一行两处调用同一废弃符号会并成一条——真实代码罕见，语料不触发。
    const key = `${symName}|${line}`;
    if (seen.has(key)) return;
    seen.add(key);

    let useinstead = '';
    let deprecated = '';
    for (const t of tags) {
      const n = tagName(t);
      if (n === 'useinstead') useinstead = tagText(t);
      else if (n === 'deprecated') deprecated = tagText(t);
    }

    const cls = getContainingClass(decl);
    // callee 的成员段（最后一个 `.` 之后，或整段）及其在文件中的偏移
    const lastDotAt = calleeText.lastIndexOf('.');
    const member = lastDotAt >= 0 ? calleeText.slice(lastDotAt + 1) : calleeText;
    const memberOffset = lastDotAt >= 0 ? start + lastDotAt + 1 : start;

    hits.push({
      file, line, col,
      callee: calleeText,
      qualifiedName: cls ? `${cls}.${symName}` : symName,
      deprecated,
      useinstead,
      depModule: declFileToModule(ts, decl),
      start,
      member,
      memberOffset,
    });
  }

  function visit(node) {
    let probeNode = null, calleeText = null;
    if (ts.isCallExpression(node)) {
      probeNode = node.expression;
      calleeText = node.expression.getText();
    } else if (ts.isPropertyAccessExpression(node)) {
      probeNode = node;
      calleeText = node.getText();
    } else if (ts.isIdentifier(node)) {
      probeNode = node;
      calleeText = node.getText();
    }
    if (probeNode) {
      const sym = checker.getSymbolAtLocation(probeNode);
      if (sym) {
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

  return { file, deprecatedCount: hits.length, hits };
}

// ============================================================================
// scan 子命令
// ============================================================================
function cmdScan(opts) {
  const ts = loadTs(opts.ohTsPath);
  const { root, files } = resolveTargets(opts);
  let totalDeprecated = 0;
  let filesWithDeprecated = 0;
  const allHits = [];
  for (const f of files) {
    let res;
    try { res = scanFile(f, ts, opts.sdkPath, opts.ohTsPath); }
    catch (e) { console.error(`[scan error] ${f}: ${e.message}`); continue; }
    if (res.deprecatedCount > 0) {
      filesWithDeprecated++;
      totalDeprecated += res.deprecatedCount;
      allHits.push(res);
      console.log(`\n${f}  — ${res.deprecatedCount} deprecated usage(s)`);
      for (const h of res.hits) {
        console.log(`  ■ ${h.qualifiedName}  (use: ${h.callee})  at ${h.line}:${h.col}`);
        console.log(`        deprecated: ${h.deprecated}   useinstead: ${h.useinstead || '(none)'}`);
      }
    }
  }
  console.log(`\n==== scan done: ${files.length} file(s), ${filesWithDeprecated} with deprecated, ${totalDeprecated} usage(s) ====`);
}

module.exports = { scanFile, parseUseinstead, normMod, declFileToModule, cmdScan };
