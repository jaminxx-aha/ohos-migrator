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
const { loadTs, resolveTargets, MAX_AI_ATTEMPTS, MAX_AGENT_STEPS } = require('./common');
const { scanFile } = require('./scan');
const { resolveAiConfig } = require('./ai-config');
const { tsStamp, logAppend, logHeader, logDelta } = require('./ai-log');

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
  if (retryErrors) user += `\n\n## 上一轮仍未清除：\n${retryErrors}\n请继续修复这些项。`;
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
  logAppend(cfg.logFile, `[agent] ended after ${step} steps, doneCalled=${doneCalled}\n`);
  fs.writeFileSync(file, content, 'utf8'); // 落盘最终内容供校验
  return { content, steps: step, changed: content !== origContent, doneCalled };
}

/**
 * 对单文件跑 agent 迁移：先扫描，若有带 useinstead 的废弃则跑 agent；改完重新扫描校验。
 * 多次未清则回退 pre-AI 原文并告警。
 */
async function rewriteFileWithAi(file, ts2, sdkPath, ohTsPath, cfg) {
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
      logAppend(cfg.logFile, `[${tsStamp()}] [${file}] success: deprecated cleared\n`);
      console.log(`  [ai] ✓ cleared`);
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

async function cmdRewriteAi(opts) {
  const ts2 = loadTs(opts.ohTsPath);
  const { root, files } = resolveTargets(opts);
  const cfg = resolveAiConfig(root);

  console.log(`[ai] log -> ${cfg.logFile || '(disabled)'}`);
  console.log(`[ai] baseURL=${cfg.baseURL}  model=${cfg.model}  idle=${cfg.idleMs}ms total=${cfg.totalMs}ms concurrency=${cfg.concurrency}`);
  logAppend(cfg.logFile,
    `${'#'.repeat(72)}\nohos-migrator AI rewrite  ${tsStamp()}\n` +
    `root: ${root}\nbaseURL: ${cfg.baseURL}\nmodel: ${cfg.model}\nfiles: ${files.length}\n`);

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
  let ok = 0, fail = 0;
  for (const t of targets) {
    console.log(`\n[ai] processing ${t.file}  (${t.count} deprecated)`);
    logAppend(cfg.logFile, `\n${'#'.repeat(60)}\n[${tsStamp()}] >>>> FILE ${t.file}\n`);
    const r = await rewriteFileWithAi(t.file, ts2, opts.sdkPath, opts.ohTsPath, cfg);
    if (r.ok) { ok++; console.log(`  [ai] ✓ done (${r.attempts} attempt(s))`); }
    else {
      fail++;
      console.log(`  [ai] ✗ FAILED after ${r.attempts} attempt(s), reverted. reason: ${r.error}`);
      console.log(`  [ai] ⚠ WARN: ${t.file} 未能完成迁移，已回退原文件，请人工处理。`);
    }
  }
  console.log(`\n==== rewrite(ai) done: ${targets.length} processed, ${ok} ok, ${fail} failed/reverted ====`);
  console.log(`[ai] log -> ${cfg.logFile || '(disabled)'}`);
}

module.exports = { AGENT_TOOLS, applyOneEdit, streamChatWithTools, runAgent, rewriteFileWithAi, cmdRewriteAi };
