/**
 * common.js — 共享常量与基础工具：SDK 默认路径探测、文件遍历、目标解析、TS 模块加载。
 */
const path = require('path');
const fs = require('fs');

/**
 * 探测 DevEco SDK home：DEVECO_SDK_HOME 环境变量 > Windows 标准安装 > macOS 标准安装。
 * 找不到返回 ''。与 verify/hvigor.js 的 resolveDevEcoSdkHome 同源（后者额外接受一个 explicit
 * 覆盖参数用于运行时 --deveco-sdk-home；本函数是启动期兜底，覆盖由 args.js 的 --sdk/--oh-ts 完成）。
 * 不写死路径——跨平台自适应，Win/mac 候选并存，谁存在用谁。
 */
function findDevEcoSdkHome() {
  const candidates = [
    process.env.DEVECO_SDK_HOME,
    'C:/Program Files/Huawei/DevEco Studio/sdk',     // Windows 标准安装
    '/Applications/DevEco-Studio.app/Contents/sdk',   // macOS 标准安装
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c; } catch (_) {}
  }
  return '';
}

/**
 * 由 sdkHome 推导 DevEco 安装根、OH 版 typescript 模块路径、OpenHarmony ets/api 路径。
 * sdkHome 是 `.../sdk`，DevEco 根是其父目录；typescript 在 <root>/tools/hvigor/hvigor-ohos-plugin/...，
 * api 在 <sdkHome>/default/openharmony/ets/api。sdkHome 为空（未探测到）时各项返回 ''，
 * 由消费者（loadTs / scanFile）报具体错误，而非在这里猜测路径。
 */
function deriveDevEcoPaths(sdkHome) {
  if (!sdkHome) return { root: '', ohTs: '', sdk: '' };
  const root = path.dirname(sdkHome);
  return {
    root,
    ohTs: path.join(root, 'tools/hvigor/hvigor-ohos-plugin/node_modules/typescript'),
    sdk: path.join(sdkHome, 'default/openharmony/ets/api'),
  };
}

const _dev = deriveDevEcoPaths(findDevEcoSdkHome());
const DEVECO = _dev.root;        // DevEco 安装根（向后兼容导出，无直接消费者）
const DEFAULT_OH_TS = _dev.ohTs;
const DEFAULT_SDK = _dev.sdk;

const SKIP_DIRS = new Set([
  'node_modules', 'oh_modules', 'build', '.preview', '.cxx', '.hvigor',
  '.idea', '.git', 'libs', 'cxx', 'temporary',
]);
const ARKTS_EXT = new Set(['.ets', '.ts']);

const MAX_AI_ATTEMPTS = 3;   // agent 整轮重试上限（轮间带错误反馈）
const MAX_AGENT_STEPS = 15;  // 单轮 agent 内工具往返步数上限

function loadTs(ohTsPath) {
  try { return require(ohTsPath); }
  catch (e) { console.error('无法加载 OH 版 typescript:', ohTsPath, '\n', e.message); process.exit(1); }
}

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

module.exports = {
  DEVECO, DEFAULT_OH_TS, DEFAULT_SDK, SKIP_DIRS, ARKTS_EXT,
  MAX_AI_ATTEMPTS, MAX_AGENT_STEPS,
  findDevEcoSdkHome, loadTs, listArktsFiles, resolveTargets,
};
