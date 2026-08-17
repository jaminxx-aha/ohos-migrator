/**
 * args.js — 参数解析：scan/rewrite 子命令 + --file/--project/--use-ai/--sdk/--oh-ts。
 */
const { DEFAULT_OH_TS, DEFAULT_SDK } = require('./common');

function usage() {
  console.log(`Usage:
  ohos-migrator.js scan    --file <path> | --project <dir> [--sdk <p>] [--oh-ts <p>]
  ohos-migrator.js rewrite --file <path> | --project <dir> [--use-ai] [--sdk <p>] [--oh-ts <p>]`);
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd !== 'scan' && cmd !== 'rewrite') { usage(); process.exit(2); }
  const opts = { cmd, file: null, project: null, useAi: false, sdkPath: DEFAULT_SDK, ohTsPath: DEFAULT_OH_TS };
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
  if (!opts.file && !opts.project) { console.error('error: --file or --project is required'); usage(); process.exit(2); }
  if (opts.file && opts.project) { console.error('error: --file and --project are mutually exclusive'); process.exit(2); }
  return opts;
}

module.exports = { usage, parseArgs };
