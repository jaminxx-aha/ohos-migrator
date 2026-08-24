/**
 * ai-agent.js — AI 模式（OpenAI 兼容，流式 + 多轮工具调用 agent）。
 * 把任务和文件丢给模型，模型自己 read/edit/replace/list_deprecated/done 迭代，
 * 我们只执行工具调用、把结果喂回、流式 + 实时日志。改完重扫校验废弃(带 useinstead)
 * 清零；MAX_AI_ATTEMPTS 轮次间带错误反馈重试；但单轮跑满 MAX_AGENT_STEPS 仍未 done
 * 视为「卡住」——不再重试、直接回退 pre-AI 原文告警（25 步没解完，再来一轮大概率原地打转）。
 *
 * 安全/超时对齐参考工程：idle-gap 看门狗（chunk 间隔超时）+ 总量上限（backstop），
 * 日志路径必须 .log 结尾、API key 脱敏（见 ai-config / ai-log）。
 */
const fs = require('fs');
const path = require('path');
const { loadTs, resolveTargets, MAX_AI_ATTEMPTS, MAX_AGENT_STEPS } = require('./common');
const { scanFile } = require('./scan');
const { resolveAiConfig } = require('./ai-config');
const { tsStamp, logAppend, logHeader, logDelta, logConv, convFileFor } = require('./ai-log');
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
  { type: 'function', function: { name: 'read_file', description: '读取目标文件的当前内容（含已做的编辑）。输出带行号前缀 L<n>: ，默认只返前 200 行（文件大时省后续，需看后段传 startLine/endLine）。注意：行号前缀不是文件真实内容，edit_file 的 oldText/newText 必须用去掉 L<n>: 前缀的纯文件文本。', parameters: { type: 'object', properties: { startLine: { type: 'integer', description: '起始行号（1-based，含）。不传则从 1 起。' }, endLine: { type: 'integer', description: '结束行号（1-based，含）。不传则默认到 startLine+199 行或文件末尾。' } }, required: [] } } },
  { type: 'function', function: { name: 'edit_file', description: '对目标文件做一处精确替换。oldText 必须是当前文件内容里唯一出现的连续子串；不唯一或不存在会失败。改多处就调用多次。', parameters: { type: 'object', properties: { oldText: { type: 'string', description: '要被替换的精确子串（须唯一出现）' }, newText: { type: 'string', description: '替换后的文本' }, reason: { type: 'string', description: '简短原因' } }, required: ['oldText', 'newText'] } } },
  { type: 'function', function: { name: 'replace_file', description: '整文件替换（仅当 edit_file 难以锚定时使用）。传入完整新文件内容。', parameters: { type: 'object', properties: { content: { type: 'string', description: '完整的新文件内容' } }, required: ['content'] } } },
  { type: 'function', function: { name: 'list_deprecated', description: '重新扫描当前文件内容，返回仍未处理的废弃接口（带 useinstead）。用于自检进度。', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'done', description: '声明迁移完成。调用后流程会跑 hvigor 编译门禁：编译干净才真正结束；若有编译错误会把你拒绝并返回错误清单，需继续用 edit_file 修复后重新调 done。', parameters: { type: 'object', properties: {}, required: [] } } },
];

/** 对 content 做一处精确替换：仅当 oldText 唯一出现时应用。 */
function applyOneEdit(content, oldText, newText) {
  if (!oldText) return { ok: false, occurrences: 0, error: 'empty oldText' };
  // 行尾对齐：源文件常是 CRLF（Windows 工程），模型 oldText/newText 用 LF（JSON \n）。
  // 逐字节 indexOf 时 \n ≠ \r\n，多行 oldText 会整串 notFound——模型卡死重试到步数用尽。
  // 把模型串归一到 content 的行尾后再精确匹配，替换块也沿用同种行尾，原文件行尾不变。
  const le = content.includes('\r\n') ? '\r\n' : '\n';
  const norm = (s) => (le === '\r\n') ? s.replace(/\r?\n/g, '\r\n') : s;
  // 模型若误把 read_file 的行号前缀 L<n>: 带进 oldText/newText，剥离后重试——
  // 避免整段 notFound 死循环（与 CRLF 归一同属「让精确匹配对模型小错鲁棒」）。
  // 只在精确匹配 notFound 时才试剥前缀的变体；正常编辑（无前缀）剥前缀是 no-op，行为不变。
  const stripLinePrefix = (s) => s.split('\n').map((l) => l.replace(/^\s*L\d+:\s?/, '')).join('\n');
  const variants = [oldText, stripLinePrefix(oldText)];
  for (let k = 0; k < variants.length; k++) {
    const ot = norm(variants[k]);
    let occurrences = 0, i = 0;
    while ((i = content.indexOf(ot, i)) !== -1) { occurrences++; i += ot.length; }
    if (occurrences === 0) continue;
    if (occurrences > 1) return { ok: false, occurrences, error: 'ambiguous' };
    const pos = content.indexOf(ot);
    const nt = norm(stripLinePrefix(newText));
    return { ok: true, occurrences: 1, offset: pos, content: content.slice(0, pos) + nt + content.slice(pos + ot.length) };
  }
  return { ok: false, occurrences: 0, error: 'notFound' };
}

// read_file 默认最多回显的行数——避免整份大文件灌爆模型上下文（wantConstant 700 行全量重读
// 曾令 glm-5.2 推理 329s）。需看后续行用 startLine/endLine 翻页。
const READ_CAP_LINES = 200;

/**
 * 把 content 按行带行号返回（前缀 L<n>: ），默认截到 READ_CAP_LINES 行并附翻页提示。
 * startLine/endLine 给定时只返该区间。行尾 \r 去除以利显示；edit_file 匹配以归一后的为准。
 */
function readWithLineNumbers(content, startLine, endLine) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const total = lines.length;
  const s = (Number.isInteger(startLine) && startLine > 0) ? Math.min(startLine, total) : 1;
  let e = (Number.isInteger(endLine) && endLine >= s) ? Math.min(endLine, total) : Math.min(total, s + READ_CAP_LINES - 1);
  if (e < s) e = s;
  const seg = [];
  for (let n = s; n <= e; n++) seg.push(`L${n}: ${lines[n - 1]}`);
  let out = seg.join('\n');
  if (s > 1 || e < total) {
    out += `\n... (共 ${total} 行，已显示 L${s}–L${e}；要看后续/前段请用 read_file(startLine=X, endLine=Y))`;
  }
  return out;
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
  // glm-5.2 等推理模型先吐 reasoning_content（思考流）再吐 content/tool_calls。
  // 用两个 flag 给对话日志加分段标记：思考期写 [reasoning]，进入正式回复写 [response]。
  let reasoningStarted = false, responseStarted = false;
  try {
    armIdle();
    const resp = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, tools, stream: true, temperature: 0.2, max_tokens: cfg.maxTokens }),
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
      // 不在字节级 armIdle：只在收到实质 delta（content/reasoning_content/tool_calls，
      // 见下方各分支）时续命。否则服务端只发 SSE 心跳/空帧吊着连接、零产出的情形（如
      // ohos-animator.ets 心跳续命 12.9min 直到 token 触顶 finish=length）会被心跳一直
      // 重置 idle、永不超时。reasoning 思考期靠 reasoning_content 分支 armIdle 续命，
      // 不需要字节级兜底——早期 f449871 的字节级兜底是 reasoning 分支补上前的临时方案。
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
          // 思考流写进 per-file 对话日志（[reasoning] 段）。否则思考期 conv 文件一字不增，
          // 肉眼像「卡死」（如 wantConstant.ets step 14 静默 5.5min），且看不到模型在想什么。
          // reasoning 不进 messages、不累进 content——只用于日志观察。
          const reasoning = d.reasoning_content || d.reasoning;
          if (reasoning) {
            if (!reasoningStarted) { logAppend(cfg.convFile, '\n[reasoning] '); reasoningStarted = true; }
            logDelta(cfg, reasoning);
            armIdle();
          }
          if (d.content) {
            if (reasoningStarted && !responseStarted) { logAppend(cfg.convFile, '\n[response] '); responseStarted = true; }
            content += d.content; onDelta(d.content); logDelta(cfg, d.content); armIdle();
          }
          if (Array.isArray(d.tool_calls)) {
            if (reasoningStarted && !responseStarted) { logAppend(cfg.convFile, '\n[response] '); responseStarted = true; }
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
async function runAgent(file, ts2, sdkPath, ohTsPath, cfg, attempt, retryErrors, hvCtx) {
  const origContent = fs.readFileSync(file, 'utf8');
  let content = origContent;
  const scan0 = scanFile(file, ts2, sdkPath, ohTsPath);
  const usable0 = scan0.hits.filter((h) => h.useinstead);
  // 三段式描述（错误信息/接口声明/接口描述）直接取 scan 产出的 hit.desc，
  // 条目间用分隔线隔开，让 AI 拿到 SDK 声明的完整上下文而非仅 useinstead 串。
  const list = usable0.map((h) => h.desc).join('\n\n---\n\n');
  // 目标模块真实声明（按模块去重）：同一文件多处命中可能映射到多条 useinstead——
  // 如 Flags 枚举级 `#Flags` + 每个成员级 `#FLAG_X` 各一条，它们产出的 targetDecl 各
  // 重复同一句「X 导出: ...」、成员块互为子集。Set 按全文相等去不了，按模块名合并、
  // 留最长（信息最全）那一条即可。让模型看到目标模块真实导出形态（有什么/没什么），
  // 避免盲猜 import 形态——如新 wantConstant 无 Action/Entity、Flags 只剩少量常量。
  const _byMod = new Map();
  for (const td of usable0.map((h) => h.targetDecl).filter(Boolean)) {
    const km = td.match(/目标模块声明 \(([^)]+)\)/);
    const key = km ? km[1] : td;
    const prev = _byMod.get(key);
    if (!prev || td.length > prev.length) _byMod.set(key, td);
  }
  const targetDecls = [..._byMod.values()].join('\n\n');
  const system =
    '你是鸿蒙 ArkTS 迁移 agent，拥有读写目标文件的工具。任务：根据每个废弃接口的 useinstead，' +
    '把废弃调用替换为推荐接口，必要时调整 import，其余代码与逻辑保持不变。' +
    '规则：edit_file 的 oldText 必须是当前文件内容里唯一出现的连续子串；多处改动请调用多次 edit_file；' +
    '改完用 list_deprecated 自检废弃是否清零；然后调 done 触发编译门禁——编译干净才结束，' +
    '若有编译错误会被退回，继续用 edit_file 修（不要整文件重写）直到编译通过再 done。' +
    'useinstead 格式 ohos.<模块>[/<命名空间>]#<成员>，其中 # 表示该成员是类/接口的**实例成员**（非静态）；' +
    '调用实例成员需先有该类的实例——ohos kit 常导出全大写单例 const 承载 builder 链（如 UiTest 的 ON.text(...)，' +
    '不是 On.text(...) 在类上静态调，否则编译报 typeof On 无该属性）。改 import 时把这个全大写单例一并导入。' +
    '若不确定调用形态，按 useinstead 的类名找同 kit 导出的全大写同名 const。' +
    '当前文件完整内容已在下面 user 消息里给出——未做编辑前不要调 read_file 重复读（整份重灌会拖慢推理、撑爆上下文）。' +
    '只有做过编辑、想看最新状态时才用 read_file；它带行号前缀 L<n>: 便于定位，但 edit_file 的 oldText/newText 必须去掉该前缀、用纯文件文本。';
  let user = `目标文件: ${file}\n\n废弃接口清单（每条含 SDK 声明的错误信息/接口声明/接口描述三段式上下文，须全部处理）：\n${list}${targetDecls ? '\n\n' + targetDecls : ''}\n\n当前文件内容：\n${content}`;
  if (retryErrors) user += `\n\n## 上一轮仍有问题：\n${retryErrors}\n请修复上述问题。`;
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  logHeader(cfg, system, user, attempt);

  let step = 0, doneCalled = false, finalGate = null;
  // 失败不从头来：流式超时 / 无工具调用属可恢复，在同一会话里告诉 AI 并让其继续，
  // 保留已做的 content 与对话历史。连续上限防死循环；达上限才真正放弃本轮。
  const MAX_CONSECUTIVE_TIMEOUTS = 3;
  const MAX_CONSECUTIVE_EMPTY = 2;
  let consecutiveTimeouts = 0, consecutiveEmpty = 0;
  for (step = 1; step <= MAX_AGENT_STEPS; step++) {
    logConv(cfg, `\n--- step ${step} ---\n`);
    const tStepStart = Date.now();
    // 与 AI 的交互进度：对话全文（prompt/delta/transcript）写 per-file 对话日志（logConv/logDelta）；
    // 每步的「时间 + 动作」摘要行另写主日志 ohos-migrator.log（logAppend cfg.logFile），便于跨文件回溯。
    // 终端不打——避免刷屏；project 级进度在 cmdRewriteAi 的逐文件头/完成行打到终端。
    let res;
    try {
      res = await streamChatWithTools(cfg, messages, AGENT_TOOLS, () => {});
    } catch (e) {
      // 流式超时 / 网络中断：不结束本轮、不丢已做的 content，告诉 AI 超时、让它接着改，
      // 在同一会话里重试。连续达上限才放弃（防 API 挂死无限重试）。step-- 不消耗步数预算。
      consecutiveTimeouts++;
      const elErr = ((Date.now() - tStepStart) / 1000).toFixed(1);
      if (consecutiveTimeouts > MAX_CONSECUTIVE_TIMEOUTS) {
        logConv(cfg, `[stream error] ${e.message} — giving up after ${consecutiveTimeouts} consecutive\n`);
        logAppend(cfg.logFile, `[${tsStamp()}] [step ${step}] ${path.basename(file)} a=${attempt} stream-error: ${e.message} — giving up (${elErr}s)\n`);
        break;
      }
      logConv(cfg, `[stream error] ${e.message} — resume (${consecutiveTimeouts}/${MAX_CONSECUTIVE_TIMEOUTS})\n`);
      logAppend(cfg.logFile, `[${tsStamp()}] [step ${step}] ${path.basename(file)} a=${attempt} stream-error: ${e.message} — resume ${consecutiveTimeouts}/${MAX_CONSECUTIVE_TIMEOUTS} (${elErr}s)\n`);
      messages.push({ role: 'user', content: '（上一轮流式调用超时/中断，你的回复未完整返回。请基于当前文件内容接着完成迁移，不要从头重写。）' });
      step--; // 抵消 for 的 step++，纯基础设施超时不消耗 agent 步数预算
      continue;
    }
    consecutiveTimeouts = 0;
    const asst = { role: 'assistant', content: res.content || null };
    if (res.toolCalls.length) asst.tool_calls = res.toolCalls;
    messages.push(asst);
    logConv(cfg, `[assistant] content=${(res.content || '').length}chars tools=${res.toolCalls.map((t) => t.function.name).join(',') || 'none'} finish=${res.finishReason}\n`);
    {
      const elStep = ((Date.now() - tStepStart) / 1000).toFixed(1);
      logAppend(cfg.logFile, `[${tsStamp()}] [step ${step}] ${path.basename(file)} a=${attempt} assistant: content=${(res.content || '').length}chars tools=[${res.toolCalls.map((t) => t.function.name).join(',') || '-'}] finish=${res.finishReason} ${elStep}s\n`);
    }
    if (!res.toolCalls.length) {
      consecutiveEmpty++;
      if (consecutiveEmpty > MAX_CONSECUTIVE_EMPTY) {
        logConv(cfg, `[agent] no tool_calls ${consecutiveEmpty}x — giving up\n`);
        break;
      }
      logConv(cfg, `[agent] no tool_calls — nudge to continue (${consecutiveEmpty}/${MAX_CONSECUTIVE_EMPTY})\n`);
      messages.push({ role: 'user', content: '请继续用工具（edit_file/replace_file/list_deprecated/done）完成迁移，不要只输出文字说明。' });
      step--;
      continue;
    }
    consecutiveEmpty = 0;

    let shouldBreak = false;
    for (const tc of res.toolCalls) {
      const name = tc.function.name;
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
      let result;
      if (name === 'read_file') {
        result = readWithLineNumbers(content, args.startLine, args.endLine);
      } else if (name === 'edit_file') {
        const r = applyOneEdit(content, args.oldText, args.newText);
        if (r.ok) { content = r.content; result = `ok: replaced ${args.oldText.length} chars at offset ${r.offset}`; }
        else result = `error: ${r.error} (occurrences=${r.occurrences})`;
      } else if (name === 'replace_file') {
        if (typeof args.content !== 'string') result = 'error: content missing';
        else {
          // 同 applyOneEdit：模型 content 用 LF，源文件是 CRLF 时归一以保留原行尾。
          const le = content.includes('\r\n') ? '\r\n' : '\n';
          content = (le === '\r\n') ? args.content.replace(/\r?\n/g, '\r\n') : args.content;
          result = 'ok: file replaced';
        }
      } else if (name === 'list_deprecated') {
        fs.writeFileSync(file, content, 'utf8');
        const s = scanFile(file, ts2, sdkPath, ohTsPath);
        const u = s.hits.filter((h) => h.useinstead);
        result = u.length ? u.map((h) => `行${h.line} ${h.callee} -> ${h.useinstead}`).join('\n') : 'none';
      } else if (name === 'done') {
        fs.writeFileSync(file, content, 'utf8'); // 编译门禁读盘
        if (hvCtx) {
          // 把编译门禁挪进 agent 循环：done 时当场跑 hvigor。
          // 干净 → 接受 done，这一轮真正结束；有错 → 不接受 done，把错误喂回 agent，
          // 让它在同一轮里继续 edit_file 修，修完再 done，直到编译通过。
          // 否则 agent 唯一的自检（list_deprecated）只看废弃是否清零，看不到编译错误，
          // 会一次 replace_file + done 就停，编译问题要等外层重开 attempt 才暴露。
          const gate = compileGate(file, cfg, hvCtx, attempt);
          finalGate = gate;
          if (gate.ok) { doneCalled = true; result = 'ok: 废弃清零 + 编译干净，完成'; shouldBreak = true; }
          else {
            result = `尚未通过编译门禁：${gate.newErrCount} 个新增编译错误。请用 edit_file 逐个修复（不要重写整个文件），修完再调 done：\n${gate.error}`;
          }
        } else {
          doneCalled = true; result = 'ok: completing'; shouldBreak = true;
        }
      } else {
        result = `error: unknown tool ${name}`;
      }
      const logTail = String(result).slice(0, 8000);
      logConv(cfg, `[tool] ${name} ${tc.function.arguments.slice(0, 200)} -> ${logTail}\n`);
      logAppend(cfg.logFile, `[${tsStamp()}] [step ${step}]   tool ${name} args=${tc.function.arguments.slice(0, 200)} -> ${String(result).replace(/\n/g, ' ').slice(0, 120)}\n`);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
      if (shouldBreak) break;
    }
    if (shouldBreak) break;
  }
  const stepsRun = Math.min(step, MAX_AGENT_STEPS);
  logConv(cfg, `[agent] ended after ${stepsRun} steps, doneCalled=${doneCalled}\n`);
  logAppend(cfg.logFile, `[${tsStamp()}] [agent] ${path.basename(file)} a=${attempt} ended: steps=${stepsRun} done=${doneCalled}\n`);
  fs.writeFileSync(file, content, 'utf8'); // 落盘最终内容供校验
  // 步数用尽 / 无 tool_calls / 流式中断而未 done：跑一次最终门禁取当前状态供外层判断。
  // 若 done 曾被拒（finalGate 已是失败态），此处重跑取最新内容对应的状态。
  if (!doneCalled && hvCtx) {
    finalGate = compileGate(file, cfg, hvCtx, attempt);
  }
  return { content, steps: stepsRun, changed: content !== origContent, doneCalled, gate: finalGate };
}

/**
 * 对单文件跑 agent 迁移：先扫描，若有带 useinstead 的废弃则跑 agent；改完重新扫描校验。
 * 多次未清则回退 pre-AI 原文并告警。
 */
async function rewriteFileWithAi(file, ts2, sdkPath, ohTsPath, cfg, hvCtx) {
  const orig = fs.readFileSync(file, 'utf8');
  let lastError = null;
  // 编译错误重试：保留上一轮 agent 产出（废弃已清零、只是签名/类型不对）做定点修；
  // 废弃未清零重试：回滚原文重做（迁移没生效，得重来）。
  // 不回滚原文是关键——否则「文件是 BY、编译错误说 On」自相矛盾，模型易卡死。
  let lastFailKind = null;       // 'compile' | 'remain' | null
  let lastAgentContent = null;   // 上一轮 agent 产出（仅 compile 重试时复用）
  let gaveUpStepCap = false;     // 单轮跑满步数仍未 done → 放弃重试

  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
    const baseContent = (lastFailKind === 'compile' && lastAgentContent != null) ? lastAgentContent : orig;
    fs.writeFileSync(file, baseContent, 'utf8');
    const scan = scanFile(file, ts2, sdkPath, ohTsPath);
    const usable = scan.hits.filter((h) => h.useinstead);
    // 只有从原文起算、确实无废弃时才判「无事可做」；编译重试时文件已迁移、usable=0 是预期的。
    if (baseContent === orig && usable.length === 0) {
      logAppend(cfg.logFile, `[${tsStamp()}] [${file}] no useinstead-bearing deprecated usage — success\n`);
      return { ok: true, attempts: attempt, changed: false };
    }
    // AI 对话内容（system/user prompt、流式 delta、step/assistant/tool transcript）写到
    // per-file 对话文件 log/<源文件名>.log，主日志只留状态行 + 一条 [conv] 指针。
    cfg.convFile = convFileFor(cfg, file);
    logAppend(cfg.logFile, `[${tsStamp()}] [conv] ${path.basename(file)} -> ${cfg.convFile}\n`);
    let r;
    try {
      r = await runAgent(file, ts2, sdkPath, ohTsPath, cfg, attempt, lastError, hvCtx);
    } catch (e) {
      // runAgent 内部已对流式超时 / 无工具调用做「同一会话内恢复」（告诉 AI 并继续），
      // 走到这里的异常是非瞬时致命错误（如编译门禁 spawn 失败、代码 bug）：
      // 记错，下一轮按 lastFailKind 处理（remain→回滚原文；compile→保留产出定点修）。
      lastError = e.message;
      logAppend(cfg.logFile, `[${file}] attempt ${attempt} agent error: ${e.message}\n`);
      lastFailKind = 'remain';
      lastAgentContent = null;
      continue;
    } finally {
      cfg.convFile = null;
    }
    lastAgentContent = r.content;
    // 单轮跑满步数仍未 done：不再重试——25 步没解完，再来一轮大概率原地打转。
    if (!r.doneCalled && r.steps >= MAX_AGENT_STEPS) {
      lastError = `step cap (${MAX_AGENT_STEPS}) reached without done`;
      gaveUpStepCap = true;
      logAppend(cfg.logFile, `[${file}] attempt ${attempt}: hit step cap (${MAX_AGENT_STEPS}) unsolved — abort retries (no further attempts)\n`);
      break;
    }
    // 校验：重新扫描废弃
    const scan2 = scanFile(file, ts2, sdkPath, ohTsPath);
    const remain = scan2.hits.filter((h) => h.useinstead);
    if (remain.length > 0) {
      lastError = remain.map((h) => `行${h.line} ${h.callee} -> ${h.useinstead} 仍未替换`).join('\n');
      logAppend(cfg.logFile, `[${file}] attempt ${attempt}: ${remain.length} still remain\n${lastError}\n`);
      lastFailKind = 'remain';   // 废弃未清零：下一轮回滚原文重做
      lastAgentContent = null;
      continue;
    }
    // 废弃已清零。编译门禁：优先复用 agent 内 done 时已跑过的 gate，避免重复编译。
    if (hvCtx) {
      const gate = r.gate || compileGate(file, cfg, hvCtx, attempt);
      if (gate && gate.ok) {
        logAppend(cfg.logFile, `[${tsStamp()}] [${file}] success: deprecated cleared + compiles clean\n`);
        return { ok: true, attempts: attempt, changed: true };
      }
      lastError = gate ? gate.error : 'compile-verify error';
      const n = gate ? gate.newErrCount : '?';
      logAppend(cfg.logFile, `[${file}] attempt ${attempt}: ${n} compile errors\n${lastError}\n`);
      lastFailKind = 'compile'; // 下一轮保留 agent 产出做定点修
      continue;
    }
    // hvigor 不可用：废弃清零即判成功（不因校验器不可用而回退有效迁移）
    logAppend(cfg.logFile, `[${tsStamp()}] [${file}] success: deprecated cleared (compile-verify unavailable)\n`);
    return { ok: true, attempts: attempt, changed: true };
  }

  try {
    fs.writeFileSync(file, orig, 'utf8');
  } catch (e) {
    // 回退写失败不能让整个 run 崩（文件可能被占用/只读）：告警并按"未回退"记录，
    // 落盘的是最后 attempt 的改后状态——比崩在异常里强，至少退出码受控。
    console.warn(`  [ai] WARN: revert failed for ${file}: ${e.message} (left as last attempt)`);
    logAppend(cfg.logFile, `[${tsStamp()}] [${file}] revert FAILED: ${e.message}; left as last attempt\n`);
  }
  if (gaveUpStepCap) {
    logAppend(cfg.logFile, `[${tsStamp()}] [${file}] giving up: step cap (${MAX_AGENT_STEPS}) reached without solving, reverted\n`);
    return { ok: false, attempts: MAX_AI_ATTEMPTS, changed: false, error: lastError };
  }
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
    `root: ${root}\nfiles: ${files.length}\n`);

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
  const total = targets.length;
  let idx = 0;
  for (const t of targets) {
    idx++;
    console.log(`\n[ai] (${idx}/${total}) ${path.basename(t.file)}  (${t.count} deprecated)  [done: ok=${ok} fail=${fail}]`);
    logAppend(cfg.logFile, `\n${'#'.repeat(60)}\n[${tsStamp()}] >>>> FILE (${idx}/${total}) ${t.file}\n`);
    // 记录进入前原文供信号处理器恢复；await 返回后（成功保留改后/失败已 revert）清空。
    _restoreOnSignal = { file: t.file, content: fs.readFileSync(t.file, 'utf8') };
    try {
      const r = await rewriteFileWithAi(t.file, ts2, opts.sdkPath, opts.ohTsPath, cfg, hvCtx);
      if (r.ok) { ok++; console.log(`  [ai] ✓ done (${r.attempts} attempt(s))  [progress: ${idx}/${total}  ok=${ok} fail=${fail}]`); }
      else {
        fail++;
        console.log(`  [ai] ✗ FAILED after ${r.attempts} attempt(s), reverted. reason: ${r.error}  [progress: ${idx}/${total}  ok=${ok} fail=${fail}]`);
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
