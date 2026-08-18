/**
 * args.js — 参数解析：scan/rewrite 子命令 + --file/--project/--use-ai/--sdk/--oh-ts。
 * parseArgv(argv) 为纯函数（抛 ArgError，不碰 process/exit），便于单测；
 * parseArgs() 是读 process.argv + 处理退出码的薄壳，供入口调用。
 */
const { DEFAULT_OH_TS, DEFAULT_SDK } = require('./common');

function usage() {
  console.log(`Usage:
  ohos-migrator.js scan    --file <path> | --project <dir> [--sdk <p>] [--oh-ts <p>]
  ohos-migrator.js rewrite --file <path> | --project <dir> [--use-ai] [--no-map | --map <path>] [--sdk <p>] [--oh-ts <p>]
    --use-ai   : AI agent 接管残料（确定性先跑、AI 补残料）
    --no-map   : 跳过 deprecation map，走旧 simple 路径（同模块改名，A/B 对照基线）
    --map <p>  : 显式指定 deprecation-map.<v>.json（覆盖按 SDK apiVersion 自动选）`);
}

class ArgError extends Error {
  constructor(msg) { super(msg); this.name = 'ArgError'; }
}

/** 纯函数：解析 argv 数组 → opts；非法输入抛 ArgError（含可读 message）。 */
function parseArgv(argv) {
  const cmd = argv[0];
  if (cmd !== 'scan' && cmd !== 'rewrite') {
    throw new ArgError(`subcommand must be scan or rewrite (got ${JSON.stringify(cmd)})`);
  }
  const opts = { cmd, file: null, project: null, useAi: false, noMap: false, mapPath: null, sdkPath: DEFAULT_SDK, ohTsPath: DEFAULT_OH_TS, help: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const needValue = () => {
      const v = argv[++i];
      if (v == null) throw new ArgError(`${a} requires a value`);
      return v;
    };
    if (a === '--file') opts.file = needValue();
    else if (a === '--project') opts.project = needValue();
    else if (a === '--use-ai') opts.useAi = true;
    else if (a === '--no-map') opts.noMap = true;
    else if (a === '--map') opts.mapPath = needValue();
    else if (a === '--sdk') opts.sdkPath = needValue();
    else if (a === '--oh-ts') opts.ohTsPath = needValue();
    else if (a === '--help' || a === '-h') { opts.help = true; return opts; }
    else throw new ArgError(`unknown arg: ${a}`);
  }
  if (!opts.file && !opts.project) throw new ArgError('--file or --project is required');
  if (opts.file && opts.project) throw new ArgError('--file and --project are mutually exclusive');
  if (opts.noMap && opts.mapPath) throw new ArgError('--no-map and --map are mutually exclusive');
  return opts;
}

function parseArgs() {
  try {
    const opts = parseArgv(process.argv.slice(2));
    if (opts.help) { usage(); process.exit(0); }
    return opts;
  } catch (e) {
    if (e instanceof ArgError) { console.error('error: ' + e.message); usage(); process.exit(2); }
    throw e;
  }
}

module.exports = { usage, parseArgv, parseArgs, ArgError };
