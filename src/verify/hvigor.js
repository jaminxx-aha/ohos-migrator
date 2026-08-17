/**
 * verify/hvigor.js — 真实编译器校验：对 HarmonyOS 工程跑 `hvigorw default@CompileArkTS`，
 * 解析 ArkTS 错误位点。移植自参考工程 E:/code/ohos-migrator/src/verify/hvigor.ts，
 * 加 Windows 适配（hvigorw.bat + shell 调用 + Win/mac SDK 探测路径）。
 *
 * 只解析 `At File:`（arkts ERROR），不解析 `ArkTS:WARN`（废弃警告是扫描器的预期信号，
 * 不能算迁移回归）。runHvigor 返回 ran=false 时带 reason，调用方据此降级为 skip+warn。
 */
const { existsSync, statSync } = require('fs');
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
 * 跑 `hvigorw default@CompileArkTS` 并解析错误位点。
 * 返回 { ran, reason?, errors: Map<absPath, number[]>, raw }。ran=false 时 errors 空、带 reason。
 */
function runHvigor(opts) {
  const empty = { ran: false, errors: new Map(), raw: '' };
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
  const args = [
    hvigorwJs,
    '--mode', 'module',
    '-p', 'module=entry@default',
    '-p', 'product=default',
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
  return { ran: true, errors: parseErrorLines(out), raw: out };
}

/**
 * 解析 `At File: <path>:<line>:<col>` → Map<absPath, number[]>（排序去重）。
 * ArkTS 错误跨多行，`At File:` 可能在续行，故逐行扫描（非单行 regex）。
 */
function parseErrorLines(output) {
  const byFile = new Map();
  const re = /At File: (\S+):(\d+):(\d+)/g;
  let m;
  while ((m = re.exec(output)) !== null) {
    const file = m[1];
    const line = Number(m[2]);
    if (!file || !line) continue;
    const set = byFile.get(file) || new Set();
    set.add(line);
    byFile.set(file, set);
  }
  const out = new Map();
  for (const [f, lines] of byFile) out.set(f, [...lines].sort((a, b) => a - b));
  return out;
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
 * 把 raw hvigor 输出按 relFile 归集错误消息文本。`At File:` 标记跟在它描述的错误消息后，
 * 故累积其前的消息行（排除 WARN 行），在遇到 `At File:` 时 flush 给该文件。每文件最多 10 条。
 * 移植自参考 pipeline.ts:groupRawByFile。
 */
function groupRawByFile(raw, projectRoot) {
  const out = new Map();
  let buf = [];
  const re = /At File: (\S+):(\d+):(\d+)/;
  for (const line of raw.split('\n')) {
    const m = line.match(re);
    if (m) {
      const rel = relFile(m[1], projectRoot);
      if (rel) {
        // hvigor 实际格式：`Error Message: <msg> At File: <path>:<line>:<col>` 同行。
        // 优先取同行消息段；回退累积 buf（兼容消息在独立行的旧/其他格式）。去 ANSI 色码。
        const same = line.match(/Error Message:\s*(.*?)\s+At File:/);
        const msg = (same ? same[1] : buf.join(' ')) || '';
        const clean = msg.replace(/\x1b\[[0-9;]*m/g, '').trim();
        const arr = out.get(rel) || [];
        arr.push(`${clean} [line ${m[2]}]`.trim());
        out.set(rel, arr);
      }
      buf = [];
    } else if (line.startsWith(' ') && !line.includes('WARN')) {
      // 错误消息行以空格开头（如 " Classes cannot be used as objects (arkts-no-classes-as-obj)），
      // flush 给下一个 At File:。排除 ArkTS:WARN（废弃警告，非 build-breaking）。
      buf.push(line.trim());
    }
  }
  const joined = new Map();
  for (const [f, msgs] of out) joined.set(f, msgs.slice(0, 10).join('\n'));
  return joined;
}

/**
 * 返回 raw 中属于 absFile 且行号在 lineSet 内的错误消息（含行号）。
 * 用于把"新增"编译错误的消息文本喂回 agent，过滤掉 baseline 已有的 pre-existing 错误。
 */
function errorsForFileFiltered(raw, projectRoot, absFile, lineSet) {
  const rel = relFile(absFile, projectRoot);
  if (!rel || lineSet.size === 0) return [];
  const out = [];
  let buf = [];
  const re = /At File: (\S+):(\d+):(\d+)/;
  for (const line of raw.split('\n')) {
    const m = line.match(re);
    if (m) {
      const ln = Number(m[2]);
      const mrel = relFile(m[1], projectRoot);
      if (mrel === rel && lineSet.has(ln)) {
        // 同 groupRawByFile：优先取同行 Error Message 段，回退 buf。去 ANSI 色码。
        const same = line.match(/Error Message:\s*(.*?)\s+At File:/);
        const msg = (same ? same[1] : buf.join(' ')) || '';
        const clean = msg.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (clean) out.push(`${clean} (line ${ln})`);
      }
      buf = [];
    } else if (line.startsWith(' ') && !line.includes('WARN')) {
      buf.push(line.trim());
    }
  }
  return out;
}

module.exports = {
  IS_WIN, resolveDevEcoSdkHome, devEcoRoot, nodeExe, hvigorwJsPath, nodeHome,
  looksLikeHarmonyProject, findProjectRootFromFile,
  runHvigor, parseErrorLines, relFile, groupRawByFile, errorsForFileFiltered,
};
