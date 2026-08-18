#!/usr/bin/env node
/**
 * ohos-migrator.js — 鸿蒙废弃接口扫描 / 重写工具入口（仅 require + 派发）。
 * 参数解析见 src/args.js，各子命令实现见 src/ 下的 scan / rewrite-simple / ai-agent。
 */
const { parseArgs } = require('./src/args');
const { ensureSdkPaths } = require('./src/common');
const { cmdScan } = require('./src/scan');
const { cmdRewriteSimple } = require('./src/rewrite-simple');
const { cmdRewriteDeterministic } = require('./src/rules');
const { cmdRewriteAi } = require('./src/ai-agent');

function main() {
  const opts = parseArgs();
  // scan/rewrite 都依赖 OH 版 typescript + OpenHarmony ets/api；路径缺失会在 scanFile
  // 里静默找不到 @ohos.*.d.ts 声明，产出"0 命中 0 报错"的假干净。在此提前友好阻断。
  if (opts.cmd === 'scan' || opts.cmd === 'rewrite') ensureSdkPaths(opts);
  if (opts.cmd === 'scan') return cmdScan(opts);
  if (opts.cmd === 'rewrite') {
    // --use-ai：确定性先跑、AI 接管残料。--no-map：跳过 map 走旧 simple 路径（A/B 对照）。
    // 默认：确定性重写（map+安全门+写后编译回滚）；map 不可用时 rules 自降级 simple。
    if (opts.useAi) return cmdRewriteAi(opts).catch((e) => { console.error('[ai fatal]', e.message); process.exit(1); });
    if (opts.noMap) return cmdRewriteSimple(opts);
    return cmdRewriteDeterministic(opts);
  }
}
main();
