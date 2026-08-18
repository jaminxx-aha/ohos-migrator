/**
 * ai-agent.js — AI 模式（OpenAI 兼容，流式 + 多轮工具调用 agent）。
 * 把任务和文件丢给模型，模型自己 read/edit/replace/list_deprecated/done 迭代，
 * 我们只执行工具调用、把结果喂回、流式 + 实时日志。改完重扫校验废弃(带 useinstead)
 * 清零；MAX_AI_ATTEMPTS 轮次间带错误反馈重试；失败回退 pre-AI 原文告警。
 *
 * 安全/超时对齐参考工程：idle-gap 看门狗（chunk 间隔超时）+ 总量上限（backstop），
 * 日志路径必须 .log 结尾、API key 脱敏（见 ai-config / ai-log）。
 */
const fs = require('fs');
const path = require('path');
const { loadTs, resolveTargets, MAX_AI_ATTEMPTS, MAX_AGENT_STEPS } = require('./common');
const { scanFile } = require('./scan');
const { resolveAiConfig } = require('./ai-config');
const { tsStamp, logAppend, logHeader, logDelta } = require('./ai-log');
const hv = require('./verify/hvigor');

// SIGINT/SIGTERM 恢复：runAgent 在 list_deprecated 时会把半改 content 落盘，中途被
// Ctrl+C 强杀会留下半改文件。注册一次性信号处理器，退出前把"当前正在处理的文件"
// 恢复到进入 rewriteFileWithAi 前的原文；已成功完成的文件保持改后状态。
let _restoreOnSignal = null;
let _signalHandlerInstalled = false;
function _signalRestoreAndExit() {
  if (_restoreOnSignal) {
    try { fs.writeFileSync(_restoreOnSignal.file, _restoreOnSignal.content, 'utf8'); }
    catch (_) {}
  }
  process.exit(130);
}
function installSignalRestore() {
  if (_signalHandlerInstalled) return;
  process.on('SIGINT', _signalRestoreAndExit);
  process.on('SIGTERM', _signalRestoreAndExit);
  _signalHandlerInstalled = true;
}

// agent 可用的工具（OpenAI function-calling schema）。
const AGENT_TOOLS = [
  { type: 'function', function: { name: 'read_file', description: '读取目标文件的当前内容（含已做的编辑）。', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'edit_file', description: '对目标文件做一处精确替换。oldText 必须是当前文件内容里唯一出现的连续子串；不唯一或不存在会失败。改多处就调用多次。', parameters: { type: 'object', properties: { oldText: { type: 'string', description: '要被替换的精确子串（须唯一出现）' }, newText: { type: 'string', description: '替换后的文本' }, reason: { type: 'string', description: '简短原因' } }, required: ['oldText', 'newText'] } } },
  { type: 'function', function: { name: 'replace_file', description: '整文件替换（仅当 edit_file 难以锚定时使用）。传入完整新文件内容。', parameters: { type: 'object', properties: { content: { type: 'string', description: '完整的新文件内容' } }, required: ['content'] } } },
  { type: 'function', function: { name: 'list_deprecated', description: '重新扫描当前文件内容，返回仍未处理的废弃接口（带 useinstead）。用于自检进度。', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'done', description: '声明迁移完成。调用后流程做最终校验。', parameters: { type: 'object', properties: {}, required: [] } } },
];

/** 对 content 做一处精确替换：仅当 oldText 唯一出现时应用。 */
function applyOneEdit(content, oldText, newText) {
  if (!oldText) return { ok: false, occurrences: 0, error: 'empty oldText' };
  let occurrences = 0, i = 0;
  while ((i = content.indexOf(oldText, i)) !== -1) { occurrences++; i += oldText.length; }
  if (occurrences === 0) return { ok: false, occurrences: 0, error: 'notFound' };
  if (occurrences > 1) return { ok: false, occurrences, error: 'ambiguous' };
  const pos = content.indexOf(oldText);
  return { ok: true, occurrences: 1, offset: pos, content: content.slice(0, pos) + newText + content.slice(pos + oldText.length) };
}

/**
 * 流式调用 chat/completions（带 tools）。累积 content + tool_calls（按 index 拼接流式片段）。
 * 超时：idle-gap 看门狗 + 总量上限。onDelta 回调每个 content / tool-args 增量。
 * 返回 { content, toolCalls, finishReason }。
 */
async function streamChatWithTools(cfg, messages, tools, onDelta) {
  const controller = new AbortController();
  let abortReason, idleTimer, totalTimer;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { abortReason = 'idle'; controller.abort(); }, cfg.idleMs);
  };
  totalTimer = setTimeout(() => { abortReason = 'total'; controller.abort(); }, cfg.totalMs);

  const toolAcc = []; // by index → {id,name,arguments}
  let content = '';
  let finishReason = null;
  try {
    armIdle();
    const resp = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, tools, stream: true, temperature: 0.2 }),
      signal: controller.signal,
    });
    if (!resp.ok || !resp.body) {
      const t = await resp.text().catch(() => '');
      throw new Error(`AI HTTP ${resp.status}: ${t.slice(0, 500)}`);
    }
    armIdle();
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        let line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        line = line.replace(/\r$/, '');
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let json;
        try { json = JSON.parse(data); } catch (_) { continue; }
        const ch = json.choices && json.choices[0];
        if (!ch) continue;
        const d = ch.delta;
        if (d) {
          if (d.content) { content += d.content; onDelta(d.content); logDelta(cfg, d.content); armIdle(); }
          if (Array.isArray(d.tool_calls)) {
            for (const tc of d.tool_calls) {
              const i = (tc.index == null) ? 0 : tc.index;
              const slot = toolAcc[i] || (toolAcc[i] = { id: '', name: '', arguments: '' });
              if (tc.id) slot.id = tc.id;
              if (tc.function) {
                if (tc.function.name) slot.name = tc.function.name;
                if (tc.function.arguments) {
                  slot.arguments += tc.function.arguments;
                  onDelta(tc.function.arguments);
                  logDelta(cfg, tc.function.arguments);
                  armIdle();
                }
              }
            }
          }
        }
        if (ch.finish_reason) finishReason = ch.finish_reason;
      }
    }
    if (controller.signal.aborted) {
      throw new Error(`stream ${abortReason}-timeout (idle=${cfg.idleMs}ms total=${cfg.totalMs}ms)`);
    }
    const toolCalls = toolAcc.filter(Boolean).map((s) => ({
      id: s.id || ('call_' + Math.random().toString(36).slice(2)),
      type: 'function',
      function: { name: s.name, arguments: s.arguments },
    }));
    return { content, toolCalls, finishReason };
  } catch (e) {
    const msg = abortReason
      ? `stream ${abortReason}-timeout (idle=${cfg.idleMs}ms total=${cfg.totalMs}ms)`
      : (e && e.message) || String(e);
    throw new Error(msg);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  }
}

/**
 * 跑一轮 agent：模型多轮调工具改文件，直到 done 或步数上限。返回 {content, steps, changed, doneCalled}。
 * 文件以内存 content 为准；list_deprecated 时临时写盘扫描，结束时把最终 content 落盘。
 */
async function runAgent(file, ts2, sdkPath, ohTsPath, cfg, attempt, retryErrors) {
  const origContent = fs.readFileSync(file, 'utf8');
  let content = origContent;
  const scan0 = scanFile(file, ts2, sdkPath, ohTsPath);
  const usable0 = scan0.hits.filter((h) => h.useinstead);
  const list = usable0.map((h) =>
    `- 行 ${h.line}  调用: \`${h.callee}\`  废弃(${h.deprecated})  推荐替换(useinstead): \`${h.useinstead}\``
  ).join('\n');
  const system =
    '你是鸿蒙 ArkTS 迁移 agent，拥有读写目标文件的工具。任务：根据每个废弃接口的 useinstead，' +
    '把废弃调用替换为推荐接口，必要时调整 import，其余代码与逻辑保持不变。' +
    '规则：edit_file 的 oldText 必须是当前文件内容里唯一出现的连续子串；多处改动请调用多次 edit_file；' +
    '改完用 list_deprecated 自检；确认全部替换后调 done。useinstead 格式 ohos.<模块>[/<命名空间>]#<成员>。';
  let user = `目标文件: ${file}\n\n废弃接口清单（仅含带 useinstead 的项，须全部处理）：\n${list}\n\n当前文件内容：\n${content}`;
  if (retryErrors) user += `\n\n## 上一轮仍有问题：\n${retryErrors}\n请修复上述问题。`;
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  logHeader(cfg, system, user, attempt);

  let step = 0, doneCalled = false;
  for (step = 1; step <= MAX_AGENT_STEPS; step++) {
    logAppend(cfg.logFile, `\n--- step ${step} ---\n`);
    process.stdout.write(`  [agent] step ${step} ... `);
    let res;
    try {
      res = await streamChatWithTools(cfg, messages, AGENT_TOOLS, (p) => process.stdout.write(p));
    } catch (e) {
      console.log(`\n  [agent] stream error: ${e.message}`);
      logAppend(cfg.logFile, `[stream error] ${e.message}\n`);
      break;
    }
    console.log();
    const asst = { role: 'assistant', content: res.content || null };
    if (res.toolCalls.length) asst.tool_calls = res.toolCalls;
    messages.push(asst);
    logAppend(cfg.logFile, `[assistant] content=${(res.content || '').length}chars tools=${res.toolCalls.map((t) => t.function.name).join(',') || 'none'} finish=${res.finishReason}\n`);
    if (!res.toolCalls.length) { logAppend(cfg.logFile, '[agent] no tool_calls, finishing\n'); break; }

    let shouldBreak = false;
    for (const tc of res.toolCalls) {
      const name = tc.function.name;
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
      let result;
      if (name === 'read_file') {
        result = content;
      } else if (name === 'edit_file') {
        const r = applyOneEdit(content, args.oldText, args.newText);
        if (r.ok) { content = r.content; result = `ok: replaced ${args.oldText.length} chars at offset ${r.offset}`; }
        else result = `error: ${r.error} (occurrences=${r.occurrences})`;
      } else if (name === 'replace_file') {
        if (typeof args.content !== 'string') result = 'error: content missing';
        else { content = args.content; result = 'ok: file replaced'; }
      } else if (name === 'list_deprecated') {
        fs.writeFileSync(file, content, 'utf8');
        const s = scanFile(file, ts2, sdkPath, ohTsPath);
        const u = s.hits.filter((h) => h.useinstead);
        result = u.length ? u.map((h) => `行${h.line} ${h.callee} -> ${h.useinstead}`).join('\n') : 'none';
      } else if (name === 'done') {
        doneCalled = true; result = 'ok: completing'; shouldBreak = true;
      } else {
        result = `error: unknown tool ${name}`;
      }
      const logTail = String(result).slice(0, 400);
      logAppend(cfg.logFile, `[tool] ${name} ${tc.function.arguments.slice(0, 200)} -> ${logTail}\n`);
      process.stdout.write(`  [tool] ${name} -> ${String(result).slice(0, 80)}\n`);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
      if (shouldBreak) break;
    }
    if (shouldBreak) break;
  }
  const stepsRun = Math.min(step, MAX_AGENT_STEPS);
  logAppend(cfg.logFile, `[agent] ended after ${stepsRun} steps, doneCalled=${doneCalled}\n`);
  fs.writeFileSync(file, content, 'utf8'); // 落盘最终内容供校验
  return { content, steps: stepsRun, changed: content !== origContent, doneCalled };
}

/**
 * 对单文件跑 agent 迁移：先扫描，若有带 useinstead 的废弃则跑 agent；改完重新扫描校验。
 * 多次未清则回退 pre-AI 原文并告警。
 */
async function rewriteFileWithAi(file, ts2, sdkPath, ohTsPath, cfg, hvCtx) {
  const orig = fs.readFileSync(file, 'utf8');
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
    fs.writeFileSync(file, orig, 'utf8'); // 每轮从原文开始
    const scan = scanFile(file, ts2, sdkPath, ohTsPath);
    const usable = scan.hits.filter((h) => h.useinstead);
    if (usable.length === 0) {
      logAppend(cfg.logFile, `[${tsStamp()}] [${file}] no useinstead-bearing deprecated usage — success\n`);
      return { ok: true, attempts: attempt, changed: false };
    }
    console.log(`  [ai] attempt ${attempt}/${MAX_AI_ATTEMPTS}: ${usable.length} deprecated to fix (running agent)`);
    try {
      await runAgent(file, ts2, sdkPath, ohTsPath, cfg, attempt, lastError);
    } catch (e) {
      lastError = e.message;
      console.log(`  [ai] agent error: ${e.message}`);
      logAppend(cfg.logFile, `[${file}] attempt ${attempt} agent error: ${e.message}\n`);
      continue;
    }
    // 校验：重新扫描
    const scan2 = scanFile(file, ts2, sdkPath, ohTsPath);
    const remain = scan2.hits.filter((h) => h.useinstead);
    if (remain.length === 0) {
      // 废弃已清零。接下来 hvigor 编译门禁（若可用）：只接受"编译也干净"的迁移。
      if (hvCtx) {
        const gate = compileGate(file, cfg, hvCtx, attempt);
        if (gate.ok) {
          logAppend(cfg.logFile, `[${tsStamp()}] [${file}] success: deprecated cleared + compiles clean\n`);
          console.log(`  [ai] ✓ cleared + compiles clean`);
          return { ok: true, attempts: attempt, changed: true };
        }
        lastError = gate.error;
        logAppend(cfg.logFile, `[${file}] attempt ${attempt}: ${gate.newErrCount} compile errors\n${lastError}\n`);
        console.log(`  [ai] attempt ${attempt}: ${gate.newErrCount} compile errors — ${attempt < MAX_AI_ATTEMPTS ? 'retry' : 'giving up'}`);
        continue;
      }
      // hvigor 不可用：废弃清零即判成功（不因校验器不可用而回退有效迁移）
      logAppend(cfg.logFile, `[${tsStamp()}] [${file}] success: deprecated cleared (compile-verify unavailable)\n`);
      console.log(`  [ai] ✓ cleared (compile-verify unavailable)`);
      return { ok: true, attempts: attempt, changed: true };
    }
    lastError = remain.map((h) => `行${h.line} ${h.callee} -> ${h.useinstead} 仍未替换`).join('\n');
    logAppend(cfg.logFile, `[${file}] attempt ${attempt}: ${remain.length} still remain\n${lastError}\n`);
    console.log(`  [ai] attempt ${attempt}: ${remain.length} still deprecated — ${attempt < MAX_AI_ATTEMPTS ? 'retry' : 'giving up'}`);
  }

  fs.writeFileSync(file, orig, 'utf8');
  logAppend(cfg.logFile, `[${tsStamp()}] [${file}] giving up after ${MAX_AI_ATTEMPTS} attempts, reverted\n`);
  return { ok: false, attempts: MAX_AI_ATTEMPTS, changed: false, error: lastError || 'unresolved deprecated usage' };
}

/**
 * hvigor 编译门禁：对工程跑一次 CompileArkTS，取本文件相对 baseline 的"新增"错误。
 * - hvigor 不可用（ran=false）→ 放行（废弃已清，不回退）。
 * - 无新增错误 → ok。
 * - 有新增错误 → 返回错误消息文本（带行号）喂回 agent 重试。
 *
 * delta 按「错误消息文本」比对，不用行号：baseline 是原文编译的错误消息集合，
 * agent 迁移常在文件顶部加 import 致行号整体下移，按行号比会把 pre-existing
 * 错误（行号已偏移）误判为新增并回退正确迁移。按消息比——pre-existing 错误消息
 * 不变即归 baseline 不算新增；agent 引入的新错误消息不在 baseline 即算新增。
 */
function compileGate(file, cfg, hvCtx, attempt) {
  const absFile = path.resolve(file);
  const rel = path.relative(hvCtx.projectRoot, absFile).replace(/\\/g, '/');
  const t0 = Date.now();
  const res = hv.runHvigor({ projectRoot: hvCtx.projectRoot, devecoSdkHome: hvCtx.sdkHome });
  const el = Math.round((Date.now() - t0) / 1000);
  if (!res.ran) {
    console.log(`  [ai] compile-verify unavailable: ${res.reason}; accepting deprecated-cleared`);
    logAppend(cfg.logFile, `[${tsStamp()}] [hvigor] attempt=${attempt} unavailable: ${res.reason}\n`);
    return { ok: true, newErrCount: 0 };
  }
  // res.entries 是全工程每条错误 {file,line,message}；取本文件条目，按消息做 delta。
  const postEntries = res.entries.filter((e) => hv.relFile(e.file, hvCtx.projectRoot) === rel);
  const baseline = hvCtx.baselineByFile.get(rel) || new Set(); // Set<message>
  const newEntries = postEntries.filter((e) => !baseline.has(e.message));
  logAppend(cfg.logFile, `[${tsStamp()}] [hvigor] attempt=${attempt} elapsed=${el}s file=${rel} post=${postEntries.length} baseline=${baseline.size} new=${newEntries.length}\n`);
  if (newEntries.length === 0) return { ok: true, newErrCount: 0 };
  const msgs = newEntries.map((e) => `${e.message} (line ${e.line})`);
  return { ok: false, newErrCount: newEntries.length, error: '## 编译错误（hvigor CompileArkTS，请修复这些）:\n' + msgs.join('\n') };
}

/**
 * 迁移全部完成后的整工程编译审计：跑一次 hvigor，把全工程错误对 baseline 做 delta，
 * 汇总「新增」错误（不限文件）。用于弥补 compileGate 的跨文件盲区——agent 改 A 引入的
 * 错误若落在非目标文件 B（B 未参与迁移），per-file gate 看不到，此处兜底检出。
 *
 * 仅报告、不回退：A 的迁移本身可能正确（B 的报错是 B 自身未迁移的废弃调用被 A 的新接口
 * 触发），回退正确迁移反而错；交人工核查。成功文件已通过各自 gate（本文件编译干净），
 * 故此处新增错误几乎都属跨文件影响。
 */
function compileAudit(cfg, hvCtx) {
  const t0 = Date.now();
  const res = hv.runHvigor({ projectRoot: hvCtx.projectRoot, devecoSdkHome: hvCtx.sdkHome });
  const el = Math.round((Date.now() - t0) / 1000);
  if (!res.ran) {
    console.log(`[ai] compile-audit: unavailable (${res.reason}) — skipped`);
    logAppend(cfg.logFile, `[${tsStamp()}] [audit] unavailable: ${res.reason}\n`);
    return;
  }
  const newEntries = [];
  for (const e of res.entries) {
    const r = hv.relFile(e.file, hvCtx.projectRoot);
    if (!r) continue;
    const base = hvCtx.baselineByFile.get(r) || new Set();
    if (!base.has(e.message)) newEntries.push({ file: r, line: e.line, message: e.message });
  }
  logAppend(cfg.logFile, `[${tsStamp()}] [audit] ran in ${el}s, ${newEntries.length} new error(s) post-migration\n`);
  if (newEntries.length === 0) {
    console.log(`[ai] compile-audit: ✓ no new compile errors across project (${el}s)`);
    return;
  }
  console.log(`[ai] compile-audit: ⚠ ${newEntries.length} new compile error(s) — manual review needed:`);
  for (const e of newEntries) {
    console.log(`  ${e.file}:${e.line}  ${e.message}`);
    logAppend(cfg.logFile, `  ${e.file}:${e.line}  ${e.message}\n`);
  }
  console.log(`[ai] ⚠ 以上为迁移后新增编译错误（多为跨文件影响），请人工核查。`);
}

async function cmdRewriteAi(opts) {
  const ts2 = loadTs(opts.ohTsPath);
  const { root, files } = resolveTargets(opts);
  const cfg = resolveAiConfig(root);

  console.log(`[ai] log -> ${cfg.logFile || '(disabled)'}`);
  console.log(`[ai] baseURL=${cfg.baseURL}  model=${cfg.model}  idle=${cfg.idleMs}ms total=${cfg.totalMs}ms`);
  logAppend(cfg.logFile,
    `${'#'.repeat(72)}\nohos-migrator AI rewrite  ${tsStamp()}\n` +
    `root: ${root}\nbaseURL: ${cfg.baseURL}\nmodel: ${cfg.model}\nfiles: ${files.length}\n`);

  // 编译校验上下文：解析 hvigor 工程根 + SDK home + baseline（pre-existing 错误行）。
  // baseline 用来做 delta：只把"新增"编译错误算到迁移头上，避免误伤本来就编译不过的工程。
  let hvCtx = null; // null = 不可用（降级为 skip+warn）
  {
    const projectRoot = opts.project
      ? path.resolve(opts.project)
      : hv.findProjectRootFromFile(path.resolve(opts.file));
    if (!projectRoot) {
      console.log(`[ai] compile-verify: skipped (file 不在 HarmonyOS 工程内)`);
      logAppend(cfg.logFile, `[${tsStamp()}] compile-verify skipped: file not in a HarmonyOS project\n`);
    } else {
      const sdkHome = hv.resolveDevEcoSdkHome();
      if (!sdkHome) {
        console.log(`[ai] compile-verify: skipped (DevEco SDK home 未找到)`);
        logAppend(cfg.logFile, `[${tsStamp()}] compile-verify skipped: DevEco SDK home not found\n`);
      } else if (!hv.looksLikeHarmonyProject(projectRoot)) {
        console.log(`[ai] compile-verify: skipped (非 HarmonyOS stage module)`);
        logAppend(cfg.logFile, `[${tsStamp()}] compile-verify skipped: not a HarmonyOS stage module\n`);
      } else {
        console.log(`[ai] compile-verify: running baseline CompileArkTS on ${projectRoot} ...`);
        const t0 = Date.now();
        const base = hv.runHvigor({ projectRoot, devecoSdkHome: sdkHome });
        const el = Math.round((Date.now() - t0) / 1000);
        if (!base.ran) {
          console.log(`[ai] compile-verify: skipped (baseline 失败: ${base.reason})`);
          logAppend(cfg.logFile, `[${tsStamp()}] hvigor baseline unavailable: ${base.reason}\n`);
        } else {
          // baseline 按文件聚合「错误消息集合」：rel -> Set<message>。用消息而非行号——
          // agent 增删行会令行号偏移，按行号比会把 pre-existing 错误误判为新增并回退正确迁移。
          const baselineByFile = new Map();
          for (const e of base.entries) {
            const r = hv.relFile(e.file, projectRoot);
            if (!r) continue;
            const set = baselineByFile.get(r) || new Set();
            set.add(e.message);
            baselineByFile.set(r, set);
          }
          // 已知限制：baseline 一次性按"全工程原文"计算；逐文件迁移成功后该文件留改后状态，
          // 后续文件 delta 仍对照原文 baseline。因成功文件已通过 compileGate（编译干净），
          // 引入跨文件新错误的概率极低；严格修复需每文件重算 baseline（hvigor 跑 N+ 次，过慢）。
          hvCtx = { projectRoot, sdkHome, baselineByFile };
          console.log(`[ai] compile-verify: baseline ran in ${el}s, ${baselineByFile.size} file(s) with pre-existing errors`);
          logAppend(cfg.logFile, `[${tsStamp()}] hvigor baseline ran in ${el}s, ${baselineByFile.size} files with pre-existing errors\n`);
        }
      }
    }
  }

  // 第一步：扫描整个工程，挑出有"带 useinstead 的废弃接口"的文件
  const targets = [];
  for (const f of files) {
    let res;
    try { res = scanFile(f, ts2, opts.sdkPath, opts.ohTsPath); }
    catch (e) { console.error(`[scan error] ${f}: ${e.message}`); continue; }
    const usable = res.hits.filter((h) => h.useinstead);
    if (usable.length > 0) targets.push({ file: f, count: usable.length });
  }
  console.log(`[ai] ${targets.length} file(s) to process (have deprecated with useinstead)`);
  logAppend(cfg.logFile, `[${tsStamp()}] target files: ${targets.length}\n`);
  for (const t of targets) logAppend(cfg.logFile, `  ${t.file}  (${t.count})\n`);

  if (targets.length === 0) return;

  // 第二步：逐文件交给 AI
  installSignalRestore();
  let ok = 0, fail = 0;
  for (const t of targets) {
    console.log(`\n[ai] processing ${t.file}  (${t.count} deprecated)`);
    logAppend(cfg.logFile, `\n${'#'.repeat(60)}\n[${tsStamp()}] >>>> FILE ${t.file}\n`);
    // 记录进入前原文供信号处理器恢复；await 返回后（成功保留改后/失败已 revert）清空。
    _restoreOnSignal = { file: t.file, content: fs.readFileSync(t.file, 'utf8') };
    try {
      const r = await rewriteFileWithAi(t.file, ts2, opts.sdkPath, opts.ohTsPath, cfg, hvCtx);
      if (r.ok) { ok++; console.log(`  [ai] ✓ done (${r.attempts} attempt(s))`); }
      else {
        fail++;
        console.log(`  [ai] ✗ FAILED after ${r.attempts} attempt(s), reverted. reason: ${r.error}`);
        console.log(`  [ai] ⚠ WARN: ${t.file} 未能完成迁移，已回退原文件，请人工处理。`);
      }
    } finally {
      _restoreOnSignal = null;
    }
  }
  console.log(`\n==== rewrite(ai) done: ${targets.length} processed, ${ok} ok, ${fail} failed/reverted ====`);
  if (hvCtx) compileAudit(cfg, hvCtx);
  console.log(`[ai] log -> ${cfg.logFile || '(disabled)'}`);
}

module.exports = { AGENT_TOOLS, applyOneEdit, streamChatWithTools, runAgent, rewriteFileWithAi, cmdRewriteAi };
