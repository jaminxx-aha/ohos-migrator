# ohos-migrator

鸿蒙 ArkTS 废弃接口扫描 / 重写工具。基于 OpenHarmony 版 TypeScript 编译器检测 `@deprecated` 调用，提供「同模块改名」与「AI agent 迁移」两种重写模式。

## 它解决什么问题

HarmonyOS SDK 持续废弃旧 API 并以 `@useinstead` 标注替换目标。手动排查跨多个 SDK 模块的废弃调用既繁琐又易漏。本工具：

- **扫描**：用 SDK 自带的 OH 版 TS 编译器（`createProgram` + `getSymbolAtLocation` + `getJsDocTags`）精确解析每个调用的符号，命中真正的 `@deprecated` 标记，并提取 `@useinstead` 替换目标。
- **简单重写**：对「同模块纯成员改名」的废弃（如 `accessibility.isOpenAccessibility` → `isOpenAccessibilitySync`）按偏移精确替换。
- **AI 重写**：对跨模块 / 带命名空间链的复杂废弃，交给 OpenAI 兼容 agent 流式迭代，改完用 hvigor `CompileArkTS` 编译门禁校验，失败回退原文。

## 环境要求

- **Node.js >= 20.6**（内置 `fetch` + `process.loadEnvFile`；更低版本 AI 模式有手工 parseDotenv fallback，但官方支持线为 20.6+）。
- **DevEco Studio**，提供：
  - OH 版 TypeScript（`<DevEco>/tools/hvigor/hvigor-ohos-plugin/node_modules/typescript`）
  - OpenHarmony ets/api 声明（`<sdk>/default/openharmony/ets/api`，数百个 `@ohos.*.d.ts`）
  - hvigorw（AI 模式编译门禁用）
- **AI 模式**：任一 OpenAI 兼容 API（baseURL + apiKey + model）。

SDK 路径探测顺序：`DEVECO_SDK_HOME` 环境变量 > Windows 标准安装 > macOS 标准安装。找不到会在启动期友好报错（防「0 命中 0 报错」的假干净）。

## 快速开始

```bash
# 扫描单个文件
node ohos-migrator.js scan --file path/to/foo.ets

# 扫描整个工程
node ohos-migrator.js scan --project path/to/project

# 简单重写（同模块改名）
node ohos-migrator.js rewrite --file path/to/foo.ets

# AI 重写（跨模块 / 复杂废弃）
cp .env.example .env      # 填 baseURL / apiKey / model
node ohos-migrator.js rewrite --project path/to/project --use-ai
```

## 命令行参数

| 参数 | 说明 |
|---|---|
| `scan` / `rewrite` | 子命令 |
| `--file <path>` | 单文件目标（与 `--project` 互斥） |
| `--project <dir>` | 工程目录目标（递归 `.ets`/`.ts`，跳过 `build`/`oh_modules`/`.hvigor`/`.idea` 等） |
| `--use-ai` | `rewrite` 用 AI agent 模式 |
| `--sdk <path>` | 覆盖 OpenHarmony ets/api 路径 |
| `--oh-ts <path>` | 覆盖 OH 版 typescript 模块路径 |
| `--help` / `-h` | 用法 |

## AI 模式配置（.env）

仅 `rewrite --use-ai` 需要。`.env` 发现顺序：`<目标工程根>/.env` → `cwd/.env` → `~/.env`。

| 变量 | 必需 | 说明 |
|---|---|---|
| `OHOS_MIGRATOR_AI_BASE_URL` | 是 | OpenAI 兼容 baseURL（不带末尾 `/`） |
| `OHOS_MIGRATOR_AI_API_KEY` | 是 | API Key |
| `OHOS_MIGRATOR_AI_MODEL` | 是 | 模型名 |
| `OHOS_MIGRATOR_AI_TIMEOUT_MS` | 否 | 流式 idle-gap 超时，默认 `120000` |
| `OHOS_MIGRATOR_AI_MAX_TOTAL_MS` | 否 | 总量超时上限，默认 `600000` |
| `OHOS_MIGRATOR_AI_LOG_FILE` | 否 | 日志路径，须 `.log` 结尾；留空走默认 `cwd/log/ai-conversation.log`，设 `off`/`none`/`/dev/null` 禁用 |

## 工作原理

### 扫描（scan）

`scanFile` 把 `.ets` 复制成临时 `.ts`（绕过 ets 解析限制），用 OH 版 TS `createProgram` 配 `paths` 把 `@ohos.*` / `@system.*` 映射到 SDK 声明文件，再遍历 AST：对每个 CallExpression / PropertyAccess / Identifier 调 `getSymbolAtLocation`，若符号带 `@deprecated` JSDoc 标签则记录，并提取 `@useinstead`。去重键 `symName|line` 折叠 AST 递归产生的同调用多点探测，同时保留「容器符号」废弃（deprecated enum/namespace 经成员访问引用，PA 节点解析不到 symbol 时仅靠 name identifier 命中）。

### 简单重写（rewrite，无 --use-ai）

只处理 `useinstead` 形如 `ohos.<mod>#<member>`（无 `/` 命名空间链）、模块与废弃声明同模块、成员名不同的情况。按 `memberOffset` 倒序替换避免位置漂移。跨模块 / 带命名空间链的跳过，提示改用 `--use-ai`。

### AI 重写（rewrite --use-ai）

1. 扫描全工程，挑出有「带 useinstead 的废弃」的文件。
2. 跑一次 baseline `hvigor CompileArkTS`，记录 pre-existing 编译错误（delta 基线）。
3. 逐文件交 agent：把废弃清单 + 文件内容给模型，模型调 `edit_file` / `replace_file` 改、`list_deprecated` 自检、`done` 收尾（单轮 ≤ 15 步，整轮 ≤ 3 次重试）。
4. 改完重扫：废弃清零 + hvigor 无新增编译错误 → 成功；否则带错误反馈重试，失败回退原文。
5. SIGINT / SIGTERM 被强杀时，恢复当前正在处理的文件到原文（已成功的文件保留）。
6. 全部文件处理完后，跑一次整工程 hvigor 做**跨文件审计**：全工程错误对 baseline 做 delta，检出 per-file gate 看不到的跨文件新增错误（agent 改 A 破坏非目标文件 B 时漏检的兜底）。仅报告不回退——回退正确迁移去修别处报错反而错，交人工核查。

### 编译门禁

`verify/hvigor.js` 用 DevEco bundled node 跑 `hvigorw.js default@CompileArkTS`（不经 shell，路径含空格安全），解析 `At File:` 错误条目，按「错误消息文本」做 baseline delta 只把「新增」错误算到迁移头上——用消息而非行号，agent 加 import 致行号整体偏移也不会把 pre-existing 错误误判为新增。module/product 名从 `build-profile.json5` 解析（非 entry 模块也能编译到正确目标）。hvigor 不可用时降级为「废弃清零即成功」。

编译校验分两层：每文件 `compileGate`（只看本文件，用于喂回 agent 重试，因 agent 只能改自己文件）+ 整工程 `compileAudit`（迁移结束后跑一次，看全文件 delta，兜底跨文件盲区，仅报告）。

## 日志

AI 模式实时记录对话到 `cwd/log/ai-conversation.log`（header + 逐 delta + 工具调用）。日志路径强制 `.log` 结尾（防写 dotfile → RCE），API key 脱敏。

## 工程结构

```
ohos-migrator.js        入口（仅 parseArgs + 派发）
src/
  args.js               参数解析
  common.js             SDK 路径探测 / 文件遍历 / TS 加载
  scan.js               扫描核心 + parseUseinstead
  rewrite-simple.js     简单重写
  ai-agent.js           AI agent（流式 + 工具调用 + 编译门禁 + SIGINT 恢复）
  ai-config.js          .env 加载 + 配置解析
  ai-log.js             对话日志 + key 脱敏
  verify/hvigor.js      hvigor 编译校验
test/deprecated/        可全量编译的废弃 API 语料（150 个 .ets，stage 模块）
.env.example            AI 配置示例
package.json            engines >=20.6 / bin / scripts
```

## 单元测试

纯函数单测（`node:test`，无需 SDK/网络）覆盖 `src/` 全部 8 个模块的可测纯函数——`args.parseArgv`、`common.deriveDevEcoPaths/listArktsFiles`、`scan.parseUseinstead/normMod`、`rewrite-simple.applySimpleRewrites/escapeRe`、`ai-agent.applyOneEdit`、`ai-config.parseDotenv/sanitizeLogFile/defaultLogFile`、`ai-log.redactSecret`、`verify/hvigor`（`parseErrorEntries`/`relFile`/`resolveHvigorTargets`/`stripJson5`/路径推导/工程根探测），共 78 例：

```bash
npm test
```

CI（GitHub Actions）在 push / PR 时自动跑该套件（见 `.github/workflows/ci.yml`）。

## 测试语料

`test/deprecated/` 是一个可全量编译的 HarmonyOS stage 模块，含 150 个 `.ets` 覆盖各 SDK 模块的废弃 API。本机 SDK 下 scanner 检出 **4969 处废弃调用、0 报错**。可直接用它验证工具：

```bash
node ohos-migrator.js scan --project test/deprecated
```

## 已知限制

- **去重键 `symName|line`**：同一行两处调用同一废弃符号会并成一条（真实代码罕见；语料每行一语句不触发）。改用 `start` 偏移会重复计数 AST 多层探测或漏报容器符号废弃，经验证当前粒度正确。
- **AI 编译门禁 baseline** 一次性按原文计算；逐文件迁移成功后该文件留改后状态，后续 delta 仍对照原文 baseline（成功文件已编译干净，跨文件新错误概率极低）。delta 按错误消息文本比对，agent 增删行致的行号偏移不会把 pre-existing 错误误判为新增。per-file gate 只看本文件有跨文件盲区（改 A 破坏非目标文件 B 漏检），由迁移结束后的整工程 `compileAudit` 兜底检出（仅报告）。
- AI 模式 SIGINT 恢复逻辑未实跑验证（需真实 API key + 信号），靠代码审查 + 模块加载确认语法。
- FA-only 符号（`featureAbility` / `particleAbility` 等）属隐式废弃（声明无 `@deprecated` 文本），scanner 不检测，需单独处理。
