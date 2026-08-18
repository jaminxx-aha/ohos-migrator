/**
 * verify/hvigor.js — 真实编译器校验：对 HarmonyOS 工程跑 `hvigorw default@CompileArkTS`，
 * 解析 ArkTS 错误位点。移植自参考工程 E:/code/ohos-migrator/src/verify/hvigor.ts，
 * 加 Windows 适配（hvigorw.bat + shell 调用 + Win/mac SDK 探测路径）。
 *
 * 只解析 `At File:`（arkts ERROR），不解析 `ArkTS:WARN`（废弃警告是扫描器的预期信号，
 * 不能算迁移回归）。runHvigor 返回 ran=false 时带 reason，调用方据此降级为 skip+warn。
 */
const { existsSync, statSync, readFileSync } = require('fs');
const { join, dirname } = require('path');
const { spawnSync } = require('child_process');
const { findDevEcoSdkHome } = require('../common');

const IS_WIN = process.platform === 'win32';

/**
 * 定位 DevEco SDK home：explicit（运行时覆盖）> common.findDevEcoSdkHome
 * （DEVECO_SDK_HOME > Win/mac 标准安装）。探测逻辑统一委托 common，本函数只叠加
 * explicit 覆盖层——避免与 common 的候选列表重复维护。无则 undefined。
 */
function resolveDevEcoSdkHome(explicit) {
  if (explicit && existsSync(explicit) && statSync(explicit).isDirectory()) return explicit;
  return findDevEcoSdkHome() || undefined;
}

/** sdkHome 是 `.../sdk`，DevEco 根是其父目录 `.../DevEco Studio`。hvigorw/node 都在 <root>/tools/。 */
function devEcoRoot(sdkHome) { return dirname(sdkHome); }
/**
 * bundled node 可执行。DevEco 布局跨平台不一致：mac 在 <root>/tools/node/bin/node，
 * Windows 在 <root>/tools/node/node.exe（无 bin/）。探测候选谁存在用谁；都不在则回退
 * 首选（让 spawnSync 报 ENOENT，由 runHvigor 捕获转成清晰错误而非误报成功）。
 */
function nodeExe(sdkHome) {
  const home = nodeHome(sdkHome);
  const cands = IS_WIN
    ? [join(home, 'node.exe'), join(home, 'bin', 'node.exe')]
    : [join(home, 'bin', 'node'), join(home, 'node')];
  for (const c of cands) if (existsSync(c)) return c;
  return cands[0];
}
/** hvigorw.js 入口：`<root>/tools/hvigor/bin/hvigorw.js`。用 node 直跑，避开 .bat 路径空格引号坑。 */
function hvigorwJsPath(sdkHome) {
  return join(devEcoRoot(sdkHome), 'tools', 'hvigor', 'bin', 'hvigorw.js');
}
/** bundled node 目录：`<root>/tools/node`。 */
function nodeHome(sdkHome) {
  return join(devEcoRoot(sdkHome), 'tools', 'node');
}

/** projectRoot 是否像 HarmonyOS stage module（有 build-profile.json5 且 entry/build-profile.json5）。 */
function looksLikeHarmonyProject(projectRoot) {
  return existsSync(join(projectRoot, 'build-profile.json5')) &&
    existsSync(join(projectRoot, 'entry', 'build-profile.json5'));
}

/** 从 file 向上找最近的 HarmonyOS 工程根，找不到返回 null。用于 --file 模式。 */
function findProjectRootFromFile(file) {
  let dir = dirname(file);
  for (; ;) {
    if (looksLikeHarmonyProject(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // 到根了
    dir = parent;
  }
}

/**
 * 宽容解析 json5：去行注释、块注释、尾逗号，再 JSON.parse。行注释不误删 URL 的双斜杠。
 * build-profile.json5 通常无注释，但模板偶带行注释；宽容解析避免单点失败回退硬编码。
 * 解析异常由调用方兜底，不在此抛。
 */
function stripJson5(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
}

/**
 * 从工程根 build-profile.json5 解析 hvigorw 的 module/product：
 *   modules[0].name + targets[0].name -> `<module>@<target>`
 *   app.products[0].name              -> product
 * 取代硬编码 entry@default：非 entry 模块名（feature/library/hsp）工程才能编译到正确目标。
 * build-profile.json5 缺失或解析失败一律回退 entry@default，保持旧行为不回归。
 */
function resolveHvigorTargets(projectRoot) {
  const fallback = { module: 'entry@default', product: 'default' };
  const bp = join(projectRoot, 'build-profile.json5');
  if (!existsSync(bp)) return fallback;
  let json;
  try { json = JSON.parse(stripJson5(readFileSync(bp, 'utf8'))); }
  catch (_) { return fallback; }
  const mod = json.modules && json.modules[0];
  const moduleName = (mod && mod.name) || 'entry';
  const targetName = (mod && mod.targets && mod.targets[0] && mod.targets[0].name) || 'default';
  const productName = (json.app && json.app.products && json.app.products[0] && json.app.products[0].name) || 'default';
  return { module: `${moduleName}@${targetName}`, product: productName };
}

/**
 * 跑 `hvigorw default@CompileArkTS` 并解析错误条目。
 * 返回 { ran, reason?, entries: Array<{file,line,message}>, raw }。ran=false 时 entries 空、带 reason。
 * 按「错误消息文本」做 delta（见 ai-agent.compileGate）：行号偏移不误判 pre-existing 错误为新增。
 */
function runHvigor(opts) {
  const empty = { ran: false, entries: [], raw: '' };
  const sdkHome = resolveDevEcoSdkHome(opts.devecoSdkHome);
  if (!sdkHome) {
    return { ...empty, reason: 'DEVECO_SDK_HOME 未找到（设置环境变量或安装 DevEco Studio）' };
  }
  const hvigorwJs = hvigorwJsPath(sdkHome);
  if (!existsSync(hvigorwJs)) {
    return { ...empty, reason: `hvigorw.js 不存在: ${hvigorwJs}` };
  }
  if (!looksLikeHarmonyProject(opts.projectRoot)) {
    return { ...empty, reason: `${opts.projectRoot} 不是 HarmonyOS stage module（缺 entry/build-profile.json5）` };
  }
  // 整工程编译（不带 --mode module）：编 product 下全部模块，确保被迁移文件所在模块
  // （可能在 modules[1+]，如 feature/hsp/har）也被编译到，避免 per-file gate 假干净。
  // 此前用 `--mode module -p module=modules[0]` 只编第一个模块，多模块工程会漏检。
  // 单模块工程两种调用等价（已实测 83==83）；多模块工程整工程更全。
  const targets = resolveHvigorTargets(opts.projectRoot);
  const args = [
    hvigorwJs,
    '-p', `product=${targets.product}`,
    'default@CompileArkTS',
    '--no-daemon',
  ];
  // 用 bundled node 直跑 hvigorw.js：args 数组不经 shell，路径含空格也安全。
  const node = nodeExe(sdkHome);
  const r = spawnSync(node, args, {
    cwd: opts.projectRoot,
    env: { ...process.env, NODE_HOME: nodeHome(sdkHome), DEVECO_SDK_HOME: sdkHome },
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  // spawnSync 启动失败（ENOENT 等）或被信号终止必须判 ran=false，否则空输出会被
  // 误判为"编译无错误"——这正是之前 nodeExe 路径错时"compiles clean"假象的根因。
  if (r.error) return { ...empty, reason: `hvigorw 启动失败：${r.error.code || r.error.message}（${node}）` };
  if (r.status === null) return { ...empty, reason: `hvigorw 被信号终止：${r.signal || '?'}` };
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  return { ran: true, entries: parseErrorEntries(out), raw: out };
}

/** absPath → 相对 projectRoot 的正斜杠路径；不在工程内返回 null。 */
function relFile(absPath, projectRoot) {
  const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const a = norm(absPath);
  const root = norm(projectRoot);
  if (a === root) return '.';
  if (a.startsWith(root + '/')) return a.slice(root.length + 1);
  return null;
}

/**
 * 解析 hvigor 输出里每条 `At File: <path>:<line>:<col>` 错误 → { file, line, message }。
 * message 取 At File 之前的同行文本（兼容两种形态：
 *   `Error Message: <msg> At File:` —— 常规格式，去 Error Message: 前缀；
 *   `<msg> At File:` —— 链式错误续行，如 `Type X is not comparable to Y. At File:`，
 *                     无 Error Message: 前缀，此前被丢致 2/85 漏检）；
 * 同行文本为空才回退 At File 之前累积的缩进续行 buf。去 ANSI 色码。
 * 全量收集、不做行号过滤——delta 由 ai-agent.compileGate 按「消息文本」比对：
 * baseline 是原文编译的错误消息集合，agent 增删行只挪行号、消息不变，故 pre-existing
 * 错误归 baseline 不算新增；agent 引入的新错误消息不在 baseline 即算新增。
 * 行号随条目保留，用于把新增错误行号反馈给 agent 定位（改后文件的行号）。
 */
function parseErrorEntries(output) {
  const entries = [];
  let buf = [];
  const re = /At File: (.+?):(\d+):(\d+)/;
  for (const line of output.split('\n')) {
    const m = line.match(re);
    if (m) {
      const file = m[1];
      const ln = Number(m[2]);
      const inline = line.slice(0, m.index)
        .replace(/Error Message:\s*/i, '')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .trim();
      const msg = (inline || buf.join(' ')).replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (file && ln && msg) entries.push({ file, line: ln, message: msg });
      buf = [];
    } else if (line.startsWith(' ') && !line.includes('WARN')) {
      buf.push(line.trim());
    }
  }
  return entries;
}

module.exports = {
  IS_WIN, resolveDevEcoSdkHome, devEcoRoot, nodeExe, hvigorwJsPath, nodeHome,
  looksLikeHarmonyProject, findProjectRootFromFile, resolveHvigorTargets,
  stripJson5, runHvigor, parseErrorEntries, relFile,
};
