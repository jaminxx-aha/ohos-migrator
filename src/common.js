/**
 * common.js — 共享常量与基础工具：SDK 默认路径、文件遍历、目标解析、TS 模块加载。
 */
const path = require('path');
const fs = require('fs');

const DEVECO = 'C:/Program Files/Huawei/DevEco Studio';
const DEFAULT_OH_TS = `${DEVECO}/tools/hvigor/hvigor-ohos-plugin/node_modules/typescript`;
const DEFAULT_SDK = `${DEVECO}/sdk/default/openharmony/ets/api`;

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
  loadTs, listArktsFiles, resolveTargets,
};
