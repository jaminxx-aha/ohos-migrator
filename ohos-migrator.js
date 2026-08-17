#!/usr/bin/env node
/**
 * ohos-migrator.js — 鸿蒙废弃接口扫描 / 重写工具。
 *
 * 子命令:
 *   scan     扫描工程或文件的废弃接口（复用 scan-deprecated.js 的编译器原理）
 *   rewrite  重写文件或工程中的废弃接口
 *
 * 通用参数:
 *   --file <path>        单文件路径（与 --project 二选一）
 *   --project <dir>      工程目录（与 --file 二选一）
 *   --sdk <path>         OpenHarmony SDK 的 ets/api 目录，默认取 DevEco 自带
 *   --oh-ts <path>       OH 版 typescript 模块路径，默认取 DevEco 自带
 *
 * rewrite 专属:
 *   --use-ai              使用 AI（OpenAI 兼容接口）分析改写；不加则走"简单同模块成员改名"
 *
 * 简单模式（无 --use-ai）只处理"同模块纯成员改名"的 useinstead（形如
 * `ohos.<mod>#<member>`，无 `/` 命名空间链）；跨模块 / 带命名空间链等复杂情况跳过
 * 并打提示，建议改用 --use-ai。
 *
 * AI 模式：从本地 .env 读取 url/key/model，流式调用，对话实时写入日志；
 * 改完重新扫描校验废弃接口是否清零（编译校验暂未实现，留 TODO 钩子），
 * 多次失败则回退原文件并告警。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const DEVECO = 'C:/Program Files/Huawei/DevEco Studio';
const DEFAULT_OH_TS = `${DEVECO}/tools/hvigor/hvigor-ohos-plugin/node_modules/typescript`;
const DEFAULT_SDK = `${DEVECO}/sdk/default/openharmony/ets/api`;

const MAX_AI_ATTEMPTS = 3;

// ============================================================================
// 参数解析
// ============================================================================
function parseArgs() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd !== 'scan' && cmd !== 'rewrite') {
    usage();
    process.exit(2);
  }
  const opts = {
    cmd,
    file: null,
    project: null,
    useAi: false,
    sdkPath: DEFAULT_SDK,
    ohTsPath: DEFAULT_OH_TS,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') opts.file = argv[++i];
    else if (a === '--project') opts.project = argv[++i];
    else if (a === '--use-ai') opts.useAi = true;
    else if (a === '--sdk') opts.sdkPath = argv[++i];
    else if (a === '--oh-ts') opts.ohTsPath = argv[++i];
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { console.error('unknown arg:', a); usage(); process.exit(2); }
  }
  if (!opts.file && !opts.project) {
    console.error('error: --file or --project is required');
    usage();
    process.exit(2);
  }
  if (opts.file && opts.project) {
    console.error('error: --file and --project are mutually exclusive');
    process.exit(2);
  }
  return opts;
}

function usage() {
  console.log(`Usage:
  ohos-migrator.js scan    --file <path> | --project <dir> [--sdk <p>] [--oh-ts <p>]
  ohos-migrator.js rewrite --file <path> | --project <dir> [--use-ai] [--sdk <p>] [--oh-ts <p>]`);
}

// ============================================================================
// 文件收集
// ============================================================================
const SKIP_DIRS = new Set([
  'node_modules', 'oh_modules', 'build', '.preview', '.cxx', '.hvigor',
  '.idea', '.git', 'libs', 'cxx', 'temporary',
]);
const ARKTS_EXT = new Set(['.ets', '.ts']);

function listArktsFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile() && ARKTS_EXT.has(path.extname(e.name).toLowerCase())) {
        // 跳过 .d.ts 声明文件本身
        if (e.name.endsWith('.d.ts')) continue;
        out.push(path.join(dir, e.name));
      }
    }
  };
  walk(root);
  return out.sort();
}

function resolveTargets(opts) {
  if (opts.file) {
    const f = path.resolve(opts.file);
    if (!fs.existsSync(f)) { console.error('file not found:', f); process.exit(2); }
    return { root: path.dirname(f), files: [f] };
  }
  const root = path.resolve(opts.project);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error('project dir not found:', root); process.exit(2);
  }
  return { root, files: listArktsFiles(root) };
}

// ============================================================================
// 扫描核心（从 scan-deprecated.js 提炼，返回结构化结果）
// 每条 hit 额外带 start 偏移、callee、member 段（供 rewrite 精确定位），
// 以及 depModule（废弃声明所在 SDK 模块，如 @ohos.accessibility）。
// ============================================================================
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
  const member = s.slice(hashIdx + 1).trim();
  return { module: normMod(left), member, hasSlash: left.includes('/') };
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
 * hit 字段：file,line,col,callee,qualifiedName,useinstead,depModule,start,member,lastDotAt
 */
function scanFile(file, ts, sdkPath, ohTsPath) {
  const norm = (p) => p.replace(/[\\]/g, '/');
  const isEts = file.toLowerCase().endsWith('.ets');
  const rootName = isEts
    ? path.join(os.tmpdir(), `_scan_${path.basename(file).replace(/\.ets$/, '')}.ts`)
    : file;
  const srcText = fs.readFileSync(file, 'utf8');
  if (isEts) fs.writeFileSync(rootName, srcText, 'utf8');

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

  if (isEts) { try { fs.unlinkSync(rootName); } catch (_) {} }
  return { file, deprecatedCount: hits.length, hits };
}

function loadTs(ohTsPath) {
  try { return require(ohTsPath); }
  catch (e) { console.error('无法加载 OH 版 typescript:', ohTsPath, '\n', e.message); process.exit(1); }
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

// ============================================================================
// rewrite — 简单模式（同模块纯成员改名）
// ============================================================================
function simpleRewriteFile(file, ts, sdkPath, ohTsPath) {
  const res = scanFile(file, ts, sdkPath, ohTsPath);
  if (res.deprecatedCount === 0) return { changed: false, reason: 'no deprecated usage', applied: 0, skipped: 0 };

  // 选出"可简单替换"的 hit：useinstead 存在、无 `/`、模块与废弃声明同模块、成员名不同
  const eligible = [];
  let skipped = 0;
  for (const h of res.hits) {
    if (!h.useinstead) { skipped++; continue; }
    const u = parseUseinstead(h.useinstead);
    if (!u || !u.member) { skipped++; continue; }
    if (u.hasSlash) { skipped++; continue; }                 // 带命名空间链，复杂，跳过
    if (!h.depModule || u.module !== h.depModule) { skipped++; continue; } // 跨模块，跳过
    if (u.member === h.member) { skipped++; continue; }       // 成员名未变，跳过
    eligible.push({ h, u });
  }
  if (eligible.length === 0) {
    return { changed: false, reason: 'no eligible same-module rename (rest skipped, try --use-ai)', applied: 0, skipped };
  }

  // 按偏移倒序替换，避免位置漂移
  eligible.sort((a, b) => b.h.memberOffset - a.h.memberOffset);
  let text = fs.readFileSync(file, 'utf8');
  for (const { h, u } of eligible) {
    const before = text.slice(0, h.memberOffset);
    const after = text.slice(h.memberOffset + h.member.length);
    text = before + u.member + after;
  }
  fs.writeFileSync(file, text, 'utf8');
  return {
    changed: true, reason: `applied ${eligible.length} same-module rename(s)`, applied: eligible.length, skipped,
    details: eligible.map(({ h, u }) => ({
      line: h.line, from: `${h.callee}`, to: h.callee.replace(new RegExp(`${escapeRe(h.member)}$`), u.member),
    })),
  };
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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

// ============================================================================
// AI 模式（OpenAI 兼容，流式）—— 阶段0：配置/安全/流式超时对齐参考工程
//  - env：OHOS_MIGRATOR_AI_* 优先，回退 OPENAI_*；dotenv 语义（不覆盖已有 env），
//    discovery 顺序 <root>/.env → cwd/.env → ~/.env
//  - 日志：header(before stream) + 逐 delta 追加 + footer；API key 脱敏；
//    日志路径必须 .log 结尾（防写 rc/dotfile 被 shell source → RCE）
//  - 流式：idle-gap 看门狗（chunk 间隔超时，主超时）+ 总量上限（backstop），
//    慢但持续的流不误杀，真 stall 快速失败
// ============================================================================

/** 手工 dotenv 解析（process.loadEnvFile 不可用时的回退）。返回键值对象。 */
function parseDotenv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const g = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!g) continue;
    let v = g[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[g[1]] = v;
  }
  return env;
}

/**
 * 把 .env 装载进 process.env（不覆盖已有变量）。Node 20.6+ 用内置 process.loadEnvFile，
 * 否则手工解析。discovery 顺序：显式 → <root>/.env → cwd/.env → ~/.env。返回首个命中的路径。
 */
function loadAiEnv(root) {
  const candidates = [];
  if (root) candidates.push(path.join(root, '.env'));
  candidates.push(path.join(process.cwd(), '.env'));
  candidates.push(path.join(os.homedir(), '.env'));
  const loadEnvFile = (typeof process.loadEnvFile === 'function') ? process.loadEnvFile.bind(process) : null;
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    if (loadEnvFile) {
      try { loadEnvFile(p); return p; } catch (_) { /* 畸形 → 试下一个 */ }
    } else {
      try {
        const env = parseDotenv(fs.readFileSync(p, 'utf8'));
        for (const k of Object.keys(env)) if (process.env[k] === undefined) process.env[k] = env[k];
        return p;
      } catch (_) {}
    }
  }
  return null;
}

function firstEnv(...names) {
  for (const n of names) { const v = process.env[n]; if (v && String(v).trim() !== '') return v; }
  return undefined;
}
function envNum(name) {
  const v = process.env[name];
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 默认日志路径：<root>/logs/ai-conversation.log（与 .gitignore 的 *.log 规则配合）。 */
function defaultLogFile(root) {
  return path.join(root || process.cwd(), 'logs', 'ai-conversation.log');
}
/**
 * 校验/归一日志路径。禁用哨兵(/dev/null,nul,off,none)→undefined(静默)；
 * 必须 .log 结尾，否则回落默认（防 attacker 控制的 .env 把对话写进 .zshrc/.bashrc→RCE）。
 */
function sanitizeLogFile(raw, root) {
  const lf = String(raw || '').trim().toLowerCase();
  if (lf === '' || lf === '/dev/null' || lf === 'nul' || lf === 'off' || lf === 'none') return undefined;
  if (!lf.endsWith('.log')) return defaultLogFile(root);
  return raw;
}

/**
 * 解析完整 AI 配置。返回 {baseURL,apiKey,model,concurrency,idleMs,totalMs,logFile,envPath}。
 * 缺 baseURL/apiKey/model 任一即抛错。优先级：OHOS_MIGRATOR_AI_* > OPENAI_*。
 */
function resolveAiConfig(root) {
  const envPath = loadAiEnv(root);
  const baseURL = (firstEnv('OHOS_MIGRATOR_AI_BASE_URL', 'OPENAI_BASE_URL', 'OPENAI_URL', 'OPENAI_API_BASE') || '').replace(/\/$/, '');
  const apiKey = firstEnv('OHOS_MIGRATOR_AI_API_KEY', 'OPENAI_API_KEY') || '';
  const model = firstEnv('OHOS_MIGRATOR_AI_MODEL', 'OPENAI_MODEL') || '';
  if (!baseURL || !apiKey || !model) {
    throw new Error(
      `.env 配置缺失：需 OHOS_MIGRATOR_AI_BASE_URL / OHOS_MIGRATOR_AI_API_KEY / OHOS_MIGRATOR_AI_MODEL` +
      `（也接受 OPENAI_* 别名）${envPath ? '（来源 ' + envPath + '）' : '（未找到 .env）'}`,
    );
  }
  const rawLog = (process.env.OHOS_MIGRATOR_AI_LOG_FILE || '').trim();
  const logFile = rawLog === '' ? defaultLogFile(root) : sanitizeLogFile(rawLog, root);
  return {
    baseURL, apiKey, model,
    concurrency: envNum('OHOS_MIGRATOR_AI_CONCURRENCY') || 4,
    idleMs: envNum('OHOS_MIGRATOR_AI_TIMEOUT_MS') || 120000,
    totalMs: envNum('OHOS_MIGRATOR_AI_MAX_TOTAL_MS') || 600000,
    logFile, envPath,
  };
}

function tsStamp() { return new Date().toISOString(); }

/** 把 secret 从 text 中抹成 [REDACTED]（全量匹配 + 服务端回显的掩码形式）。短于 8 位跳过。 */
function redactSecret(text, secret) {
  if (!secret || secret.length < 8) return text;
  let out = text.split(secret).join('[REDACTED]');
  out = out.replace(/sk-[A-Za-z0-9_-]{1,20}\.{2,4}[A-Za-z0-9_-]{1,20}/g, '[REDACTED]');
  return out;
}

// ---- 实时日志：header(before stream) + 逐 delta 追加 + footer ----
const _seenLogDirs = new Set();
function logAppend(logFile, text) {
  if (!logFile) return;
  try {
    if (!_seenLogDirs.has(logFile)) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      _seenLogDirs.add(logFile);
    }
    fs.appendFileSync(logFile, text, 'utf8');
  } catch (_) { /* best-effort：日志失败不得中断迁移 */ }
}
function logHeader(cfg, system, user, attempt) {
  if (!cfg.logFile) return;
  const sep = '─'.repeat(72);
  const header = `[${tsStamp()}] attempt=${attempt} model=${cfg.model} base=${cfg.baseURL} status=STREAMING`;
  const block = [sep, header, '### system', system, '### user', user, '### response (streamed live)'].join('\n');
  logAppend(cfg.logFile, redactSecret(block, cfg.apiKey) + '\n');
}
function logDelta(cfg, text) { if (cfg.logFile) logAppend(cfg.logFile, text); }
function logFooter(cfg, status, error) {
  if (!cfg.logFile) return;
  const sep = '─'.repeat(72);
  const line = error ? `[${status}] ${error}` : `[${status}]`;
  logAppend(cfg.logFile, `${line}\n${sep}\n`);
}

// 从 AI 文本回复中提取最后一个 ```arkts 代码块作为改写后整文件（阶段1将改为 JSON edits）
function extractCode(text) {
  const fence = /```(?:arkts|typescript|ts|js|ets)?\s*\n([\s\S]*?)```/gi;
  let last = null, m;
  while ((m = fence.exec(text)) !== null) last = m[1];
  return last;
}

/**
 * 流式调用 OpenAI 兼容 /chat/completions。
 * 超时：idle-gap 看门狗（idleMs，chunk 间隔超时为主）+ 总量上限（totalMs，backstop）。
 * 日志：stream 前写 header（key 脱敏），每个 delta 实时追加，结束写 footer。
 * onDelta(piece) 实时回调每个增量（供终端流式打印）。返回完整文本。
 */
async function streamChat(cfg, system, user, attempt, onDelta) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  logHeader(cfg, system, user, attempt);

  const controller = new AbortController();
  let abortReason; // 'idle' | 'total'
  let idleTimer, totalTimer;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { abortReason = 'idle'; controller.abort(); }, cfg.idleMs);
  };
  totalTimer = setTimeout(() => { abortReason = 'total'; controller.abort(); }, cfg.totalMs);

  let full = '';
  try {
    armIdle(); // 连接建立前先布防，挂起的 socket-setup 也能在 idleMs 内死掉
    const resp = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, stream: true, temperature: 0.2 }),
      signal: controller.signal,
    });
    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`AI HTTP ${resp.status}: ${errText.slice(0, 500)}`);
    }
    armIdle(); // 响应头到达（进展）→ 重置 idle 窗口
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        let rawLine = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        rawLine = rawLine.replace(/\r$/, '');
        if (!rawLine.startsWith('data:')) continue;
        const data = rawLine.slice(5).trim();
        if (data === '[DONE]') continue;
        let json;
        try { json = JSON.parse(data); } catch (_) { continue; /* keepalive */ }
        const ch = json.choices && json.choices[0];
        const piece = ch && ch.delta && (ch.delta.content || '');
        if (piece) { full += piece; onDelta(piece); logDelta(cfg, piece); armIdle(); }
        const fr = ch && ch.finish_reason;
        if (fr === 'length' || fr === 'content_filter') {
          throw new Error(`stream truncated by finish_reason=${fr} after ${full.length} chars`);
        }
      }
    }
    // 流正常结束也可能是 watchdog abort（某些实现 abort 后迭代器正常返回）→ 视为超时
    if (controller.signal.aborted) {
      throw new Error(`stream ${abortReason}-timeout (idle=${cfg.idleMs}ms total=${cfg.totalMs}ms) after ${full.length} chars`);
    }
    logFooter(cfg, 'OK');
    return full;
  } catch (e) {
    const msg = abortReason
      ? `stream ${abortReason}-timeout (idle=${cfg.idleMs}ms total=${cfg.totalMs}ms) after ${full.length} chars`
      : (e && e.message) || String(e);
    logFooter(cfg, 'ERROR', msg);
    throw new Error(msg);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  }
}

function buildPrompt(file, srcText, hits) {
  // 只把带 useinstead 的废弃接口交给 AI
  const usable = hits.filter((h) => h.useinstead);
  const list = usable.map((h) =>
    `- 行 ${h.line}  调用: \`${h.callee}\`  废弃(${h.deprecated})  推荐替换(useinstead): \`${h.useinstead}\``
  ).join('\n');
  const sys =
    '你是鸿蒙 ArkTS/TypeScript 迁移专家。用户会给一个源文件及其中的废弃接口列表，' +
    '每个废弃接口都附带 SDK 标注的 useinstead 推荐替换目标（格式 ohos.<模块>[/<命名空间>]#<成员>）。' +
    '请根据 useinstead 改写文件：替换废弃调用、必要时调整 import。保持其余代码与逻辑不变。' +
    '只输出改写后的【完整文件内容】，放在单个 ```arkts 代码块内，不要任何额外解释。';
  const user =
    `文件: ${file}\n\n` +
    `废弃接口清单（仅含带 useinstead 的项，请全部处理）：\n${list}\n\n` +
    `源文件内容：\n\`\`\`arkts\n${srcText}\n\`\`\`\n\n` +
    `请输出改写后的完整文件。`;
  return { system: sys, user };
}

async function rewriteFileWithAi(file, ts2, sdkPath, ohTsPath, cfg) {
  const orig = fs.readFileSync(file, 'utf8');
  let content = orig;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
    // 扫描当前内容里的废弃接口
    const scan = scanFile(file, ts2, sdkPath, ohTsPath);
    const usable = scan.hits.filter((h) => h.useinstead);
    if (usable.length === 0) {
      logAppend(cfg.logFile, `[${tsStamp()}] [${file}] no useinstead-bearing deprecated usage remains — success\n`);
      return { ok: true, attempts: attempt, changed: content !== orig };
    }
    process.stdout.write(`  [ai] attempt ${attempt}/${MAX_AI_ATTEMPTS}: ${usable.length} to fix ... `);

    const { system, user } = buildPrompt(file, content, scan.hits);
    let aiText;
    try {
      aiText = await streamChat(cfg, system, user, attempt, (piece) => { process.stdout.write(piece); });
    } catch (e) {
      lastError = e;
      console.log(`\n  [ai] call failed: ${e.message}`);
      continue;
    }
    const newCode = extractCode(aiText);
    if (!newCode) {
      lastError = new Error('AI 回复中未找到代码块');
      console.log('\n  [ai] no code block in response');
      continue;
    }
    content = newCode;
    fs.writeFileSync(file, content, 'utf8'); // 先落盘以便重新扫描
    console.log('\n  [ai] applied, verifying...');
  }

  // 多次未通过：回退原文件
  logAppend(cfg.logFile, `[${tsStamp()}] [${file}] giving up after ${MAX_AI_ATTEMPTS} attempts, reverting\n`);
  fs.writeFileSync(file, orig, 'utf8');
  return { ok: false, attempts: MAX_AI_ATTEMPTS, changed: false, error: lastError ? lastError.message : 'unresolved deprecated usage' };
}

async function cmdRewriteAi(opts) {
  const ts2 = loadTs(opts.ohTsPath);
  const { root, files } = resolveTargets(opts);
  const cfg = resolveAiConfig(root);

  console.log(`[ai] log -> ${cfg.logFile || '(disabled)'}`);
  console.log(`[ai] baseURL=${cfg.baseURL}  model=${cfg.model}  idle=${cfg.idleMs}ms total=${cfg.totalMs}ms concurrency=${cfg.concurrency}`);
  logAppend(cfg.logFile,
    `${'#'.repeat(72)}\nohos-migrator AI rewrite  ${tsStamp()}\n` +
    `root: ${root}\nbaseURL: ${cfg.baseURL}\nmodel: ${cfg.model}\nfiles: ${files.length}\n`);

  // 第一步：扫描整个工程，挑出有"带 useinstead 的废弃接口"的文件
  const targets = [];
  for (const f of files) {
    let res;
    try { res = scanFile(f, ts2, opts.sdkPath, opts.ohTsPath); }
    catch (e) { console.error(`[scan error] ${f}: ${e.message}`); continue; }
    const usable = res.hits.filter((h) => h.useinstead);
    if (usable.length > 0) targets.push({ file: f, count: usable.length });
  }
  console.log(`[ai] ${targets.length} file(s) to process (have deprecated with useinstead)`);
  logAppend(cfg.logFile, `[${tsStamp()}] target files: ${targets.length}\n`);
  for (const t of targets) logAppend(cfg.logFile, `  ${t.file}  (${t.count})\n`);

  if (targets.length === 0) return;

  // 第二步：逐文件交给 AI
  let ok = 0, fail = 0;
  for (const t of targets) {
    console.log(`\n[ai] processing ${t.file}  (${t.count} deprecated)`);
    logAppend(cfg.logFile, `\n${'#'.repeat(60)}\n[${tsStamp()}] >>>> FILE ${t.file}\n`);
    const r = await rewriteFileWithAi(t.file, ts2, opts.sdkPath, opts.ohTsPath, cfg);
    if (r.ok) { ok++; console.log(`  [ai] ✓ done (${r.attempts} attempt(s))`); }
    else {
      fail++;
      console.log(`  [ai] ✗ FAILED after ${r.attempts} attempt(s), reverted. reason: ${r.error}`);
      console.log(`  [ai] ⚠ WARN: ${t.file} 未能完成迁移，已回退原文件，请人工处理。`);
    }
  }
  console.log(`\n==== rewrite(ai) done: ${targets.length} processed, ${ok} ok, ${fail} failed/reverted ====`);
  console.log(`[ai] log -> ${cfg.logFile || '(disabled)'}`);
}

// ============================================================================
// 入口
// ============================================================================
function main() {
  const opts = parseArgs();
  if (opts.cmd === 'scan') return cmdScan(opts);
  if (opts.cmd === 'rewrite') {
    if (opts.useAi) return cmdRewriteAi(opts).catch((e) => { console.error('[ai fatal]', e.message); process.exit(1); });
    return cmdRewriteSimple(opts);
  }
}
main();
