/**
 * binding-allocator.js — 跨 kit 成员 drop-in 的 per-file binding 分配器
 * （移植自参考 member-scanner.ts createBindingAllocator + injectImports）。
 *
 * pickBinding(kit, forceNew?)：文件已 import 该 kit 则复用现有 binding，否则分配
 * 防撞名的新名（kit 末段 + 数字后缀）并记一条待注入 import。forceNew 强制新建
 * （逆 drop-in 用：旧 kit 的 binding 即将被 rewrite-import 换走，成员须留在旧 kit
 * 则需新 binding）。injectImports(content) 产出每文件一条零长 span 的 inject-import
 * finding，锚在最后一个 import 的 specEnd 后一行（EOF fallback）。kitDefaultExport
 * 命中的 kit 用 `import X from`（default 形），否则 `import * as X from`。
 */
const { extractBindingMap, extractImports, lineAt } = require('./import-extractor');

function createBindingAllocator(content, defaultExportKits) {
  const bindings = extractBindingMap(content);
  const kitToBinding = new Map();
  const usedBindings = new Set();
  for (const [b, k] of bindings) {
    usedBindings.add(b);
    if (!kitToBinding.has(k)) kitToBinding.set(k, b);
  }
  const allocated = new Map(); // kit -> binding

  function pickBinding(kit, forceNew = false) {
    if (!forceNew) {
      const existing = kitToBinding.get(kit);
      if (existing) return { binding: existing, injected: false };
    }
    const hit = allocated.get(kit);
    if (hit) return { binding: hit, injected: true };
    const base = kit.split('.').pop() || 'mod';
    let name = base;
    let n = 2;
    const taken = (nm) => usedBindings.has(nm) || [...allocated.values()].some((a) => a === nm);
    while (taken(name)) name = `${base}${n++}`;
    usedBindings.add(name);
    allocated.set(kit, name);
    return { binding: name, injected: true };
  }

  function injectImports(content) {
    if (allocated.size === 0) return [];
    const imps = extractImports(content);
    const maxSpecEnd = imps.length ? Math.max(...imps.map((i) => i.specEnd)) : -1;
    let anchor;
    if (maxSpecEnd >= 0) {
      const nl = content.indexOf('\n', maxSpecEnd);
      anchor = nl === -1 ? content.length : nl + 1;
    } else {
      anchor = 0;
    }
    const text =
      [...allocated.entries()].map(([k, b]) =>
        defaultExportKits && defaultExportKits.has(k)
          ? `import ${b} from '${k}';`
          : `import * as ${b} from '${k}';`,
      ).join('\n') + '\n';
    return [{
      rule: 'inject-import',
      matchStart: anchor,
      matchEnd: anchor,
      replacement: text,
      note: `inject ${allocated.size} import(s) for cross-kit member rebind`,
      line: lineAt(content, anchor),
    }];
  }

  return { pickBinding, injectImports };
}

module.exports = { createBindingAllocator };
