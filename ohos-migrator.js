#!/usr/bin/env node
/**
 * ohos-migrator.js — 鸿蒙废弃接口扫描 / 重写工具入口（仅 require + 派发）。
 * 参数解析见 src/args.js，各子命令实现见 src/ 下的 scan / rewrite-simple / ai-agent。
 */
const { parseArgs } = require('./src/args');
const { ensureSdkPaths } = require('./src/common');
const { cmdScan } = require('./src/scan');
const { cmdRewriteSimple } = require('./src/rewrite-simple');
const { cmdRewriteAi } = require('./src/ai-agent');

function main() {
  const opts = parseArgs();
  // scan/rewrite 都依赖 OH 版 typescript + OpenHarmony ets/api；路径缺失会在 scanFile
  // 里静默找不到 @ohos.*.d.ts 声明，产出"0 命中 0 报错"的假干净。在此提前友好阻断。
  if (opts.cmd === 'scan' || opts.cmd === 'rewrite') ensureSdkPaths(opts);
  if (opts.cmd === 'scan') return cmdScan(opts);
  if (opts.cmd === 'rewrite') {
    if (opts.useAi) return cmdRewriteAi(opts).catch((e) => { console.error('[ai fatal]', e.message); process.exit(1); });
    return cmdRewriteSimple(opts);
  }
}
main();
