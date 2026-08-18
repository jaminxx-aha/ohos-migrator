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

const ENCLOSING_KINDS = new Set([
  189 /* ModuleDeclaration */, 226 /* InterfaceDeclaration */,
  218 /* ClassDeclaration */, 220 /* EnumDeclaration */,
]);
/**
 * 从废弃声明节点走 getParent() 收集容器名，产出与 deprecation-map 同形状的
 * { exportName, members[] } 查表键。移植自参考工程 sdk-indexer.ts computeIdentity。
 * namespace 级声明（declare namespace X）→ exportName=X；否则 enclosing[0] 为
 * exportName、余段 + 自身名作 members。VariableStatement（const）名取首个 declaration。
 *
 * 注意：用 ts.isModuleDeclaration 等谓词而非硬编码 SyntaxKind 数字——OH 版 TS 编译器
 * 是 fork，SyntaxKind 枚举值与标准 tsc 不同（如 ModuleDeclaration=264 vs 标准 189），
 * 硬编码会全部漏匹配。谓词随加载的 ts 版本走，稳。
 */
function isEnclosing(ts, node) {
  return ts.isModuleDeclaration(node) || ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node) || ts.isEnumDeclaration(node);
}
function nameOf(node) {
  if (!node) return '';
  if (node.name && typeof node.name.text === 'string') return node.name.text;
  if (node.kind === 210 /* VariableStatement */) {
    const dl = node.declarationList;
    if (dl && dl.declarations && dl.declarations[0] && dl.declarations[0].name) {
      const nm = dl.declarations[0].name;
      return typeof nm.text === 'string' ? nm.text : '';
    }
  }
  return '';
}
function computeIdentity(ts, decl) {
  const enclosing = [];
  let p = decl && decl.parent;
  while (p) {
    if (isEnclosing(ts, p)) {
      const n = nameOf(p);
      if (n) enclosing.unshift(n);
    }
    p = p.parent;
  }
  const ownName = nameOf(decl);
  const isNamespaceLevel = decl && ts.isModuleDeclaration(decl);
  const id = {};
  if (isNamespaceLevel) {
    if (ownName) id.exportName = ownName;
  } else if (enclosing.length > 0) {
    id.exportName = enclosing[0];
    id.members = enclosing.slice(1);
    if (ownName) id.members.push(ownName);
  } else if (ownName) {
    id.exportName = ownName;
  }
  return id;
}

// 把 SDK 声明文件名归一成 import 模块名，如 .../api/@ohos.accessibility.d.ts -> @ohos.accessibility
function declFileToModule(ts, decl) {
  if (!decl) return '';
  let fn = '';
  try { fn = decl.getSourceFile().fileName; } catch (_) { return ''; }
  const base = path.basename(fn).replace(/\.d\.ts$/i, '');
  return base.startsWith('@') ? base : '';
}

/**
 * 从 JSDoc 节点 getText() 串里剥出主描述（不含 @tag 行）。
 * 纯字符串处理，便于单测。OH 版 TS 删了 ts.getJSDocComment，主描述只能从
 * getJSDocCommentsAndTags 返回的 JSDoc 节点（getText() 是整块 JSDoc 文本）里解析。
 * 流程：去 JSDoc 头尾标记 → 按行去星号前缀 → 剔除以 @ 开头的 tag 行 → 剩余非空行 join。
 */
function jsDocMainComment(jsdocText) {
  if (!jsdocText) return '';
  let s = String(jsdocText).replace(/^\/\*\*/, '').replace(/\*\/\s*$/, '');
  const out = [];
  for (const raw of s.split(/\r?\n/)) {
    const l = raw.replace(/^\s*\*\s?/, '');
    if (/^@/.test(l.trim())) continue;   // @param/@syscap/... 整行跳过，由 getJSDocTags 结构化取
    const t = l.trim();
    if (t) out.push(t);
  }
  return out.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * 把一条废弃 hit 展开成发给 AI 的三段式描述：
 *   1. 错误信息行（The signature '(...)' of 'X' is deprecated.）
 *   2. 接口声明行（kit简写.容器链.成员(签名)）
 *   3. 接口描述段（主描述 + Params + Syscap + Since + Deprecated + Useinstead）
 * 任一步骤抛错 → 回退旧单行格式，绝不因描述失败丢掉这条废弃。
 */
function describeDeprecated(ts, decl, checker, hit) {
  const fallback = `- 行 ${hit.line}  调用: \`${hit.callee}\`  废弃(${hit.deprecated})  推荐替换(useinstead): \`${hit.useinstead}\``;
  try {
    const qname = hit.qualifiedName || '';
    const isCallable = ts.isMethodDeclaration(decl) || ts.isMethodSignature(decl) ||
      ts.isFunctionDeclaration(decl) || ts.isCallSignatureDeclaration(decl);
    // 签名：方法/函数用 signatureToString；属性/枚举成员/变量用类型串
    let sig = '';
    if (isCallable) {
      try { const s = checker.getSignatureFromDeclaration(decl); sig = s ? checker.signatureToString(s) : ''; } catch (_) {}
      if (!sig) { try { sig = decl.getText().replace(/;\s*$/, '').replace(/^\s+/, ''); } catch (_) {} }
    } else {
      try { const ty = checker.getTypeAtLocation(decl); sig = ty ? ': ' + checker.typeToString(ty) : ''; } catch (_) {}
    }

    let errLine;
    if (isCallable && sig.startsWith('(')) errLine = `行 ${hit.line} — The signature '${sig}' of '${qname}' is deprecated.`;
    else if (!isCallable) errLine = `行 ${hit.line} — Property '${qname}' is deprecated.`;
    else errLine = `行 ${hit.line} — ${qname} is deprecated.`;

    const kitShort = (hit.kit || '').replace(/^@ohos\./, '').replace(/^@/, '');
    const chain = [hit.exportName, ...(hit.members || [])].filter(Boolean).join('.');
    let declLine = [kitShort, chain].filter(Boolean).join('.');
    if (sig) declLine += sig;

    const parts = [];
    // 主描述：从 JSDoc 节点 getText() 剥 tag 行（OH fork 无 getJSDocComment）
    try {
      const ct = ts.getJSDocCommentsAndTags(decl);
      if (ct) for (const item of ct) {
        if (item && item.getText) {
          const txt = item.getText();
          if (txt.startsWith('/**')) { parts.push(jsDocMainComment(txt)); break; }
        }
      }
    } catch (_) {}
    // 去掉空主描述占位，下面再按序追加
    const desc = parts.filter(Boolean);
    parts.length = 0;
    parts.push(...desc);

    // tags：param（描述丢了名，从 decl.parameters 补）/ syscap / since
    // deprecated / useinstead 复用 record 已提取的 hit 字段，保持一致
    let tags = [];
    try { tags = ts.getJSDocTags(decl) || []; } catch (_) {}
    const paramDescs = [];
    let syscap = '', since = '';
    for (const t of tags) {
      const n = tagName(t);
      if (n === 'param') paramDescs.push(tagText(t));
      else if (n === 'syscap') syscap = tagText(t);
      else if (n === 'since') since = tagText(t);
    }
    if (paramDescs.length) {
      const names = [];
      if (isCallable && decl.parameters) for (const p of decl.parameters)
        names.push(p.name && typeof p.name.text === 'string' ? p.name.text : '');
      const lines = paramDescs.map((d, i) => `  ${names[i] || ('arg' + i)} — ${d || ''}`);
      parts.push('Params:\n' + lines.join('\n'));
    }
    if (syscap) parts.push('Syscap: ' + syscap);
    if (since) parts.push('Since: ' + since);
    if (hit.deprecated) parts.push('Deprecated: ' + hit.deprecated);
    if (hit.useinstead) parts.push('Useinstead: ' + hit.useinstead);

    return `${errLine}\n\n${declLine}\n\n${parts.join('\n')}`;
  } catch (_) {
    return fallback;
  }
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
    // map 查表键：kit=声明文件模块名、exportName/members=容器链（移植参考 computeIdentity）
    const depModule = declFileToModule(ts, decl);
    const id = computeIdentity(ts, decl);

    const hit = {
      file, line, col,
      callee: calleeText,
      qualifiedName: cls ? `${cls}.${symName}` : symName,
      deprecated,
      useinstead,
      depModule,
      kit: depModule,
      exportName: id.exportName,
      members: id.members,
      start,
      member,
      memberOffset,
    };
    hit.desc = describeDeprecated(ts, decl, checker, hit);
    hits.push(hit);
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

module.exports = { scanFile, parseUseinstead, normMod, declFileToModule, computeIdentity, jsDocMainComment, describeDeprecated, cmdScan };
