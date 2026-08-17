#!/usr/bin/env node
/**
 * ohos-migrator.js — 鸿蒙废弃接口扫描 / 重写工具入口（仅 require + 派发）。
 * 参数解析见 src/args.js，各子命令实现见 src/ 下的 scan / rewrite-simple / ai-agent。
 */
const { parseArgs } = require('./src/args');
const { cmdScan } = require('./src/scan');
const { cmdRewriteSimple } = require('./src/rewrite-simple');
const { cmdRewriteAi } = require('./src/ai-agent');

function main() {
  const opts = parseArgs();
  if (opts.cmd === 'scan') return cmdScan(opts);
  if (opts.cmd === 'rewrite') {
    if (opts.useAi) return cmdRewriteAi(opts).catch((e) => { console.error('[ai fatal]', e.message); process.exit(1); });
    return cmdRewriteSimple(opts);
  }
}
main();
