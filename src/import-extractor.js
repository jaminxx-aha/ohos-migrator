/**
 * import-extractor.js — 容错解析 .ets/.ts 的 import（移植自参考工程
 * scanner/import-extractor.ts）。刻意不用 tsc 解析整文件：ArkUI .ets 的
 * struct/@Component/build() tsc 解析不了，但文件顶部 import 行是标准 TS，
 * 正则+偏移既稳又够 MVP 的 import-specifier 重写用。返回的 specStart/specEnd
 * 含引号，splice 精确。
 */
const IMPORT_FROM_RE = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s*(['"])([^'"]+)\2/g;
const REQUIRE_RE = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
const IMPORT_DYNAMIC_RE = /import\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

/** 1-based 行号 for 字符偏移。 */
function lineAt(content, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * 解析 named/default/namespace/require/dynamic import。
 * 返回 ImportInfo[]：{ specifier, line, specStart, specEnd, bindings:[{local, imported, nameStart?, nameEnd?}] }。
 * specStart/specEnd 含首尾引号；bindings 的 nameStart/nameEnd 指向 imported 名 token（rename-export 用）。
 */
function extractImports(content) {
  const out = [];
  for (const m of content.matchAll(IMPORT_FROM_RE)) {
    pushImport(out, m, content, m[1], 2, 3);
  }
  for (const m of content.matchAll(REQUIRE_RE)) {
    pushImport(out, m, content, null, 1, 2);
  }
  for (const m of content.matchAll(IMPORT_DYNAMIC_RE)) {
    pushDynamicImport(out, m, content, 1, 2);
  }
  return out;
}

function pushDynamicImport(out, m, content, quoteGroup, specGroup) {
  if (m.index === undefined) return;
  const quoteChar = m[quoteGroup];
  const specifier = m[specGroup];
  const quoteStart = m.index + m[0].indexOf(quoteChar + specifier);
  out.push({
    specifier,
    line: lineAt(content, quoteStart),
    specStart: quoteStart,
    specEnd: quoteStart + specifier.length + 2,
    bindings: [],
  });
}

function pushImport(out, m, content, clause, quoteGroup, specGroup) {
  if (m.index === undefined) return;
  const quoteChar = m[quoteGroup];
  const specifier = m[specGroup];
  const quoteStart = m.index + m[0].indexOf(quoteChar + specifier);
  const clauseStart = clause != null ? m.index + m[0].indexOf(clause) : 0;
  out.push({
    specifier,
    line: lineAt(content, quoteStart),
    specStart: quoteStart,
    specEnd: quoteStart + specifier.length + 2,
    bindings: clause ? parseBindings(clause, clauseStart) : [],
  });
}

/** 解析 `{a, b as c}` / default / `* as ns`。clauseStart 是 clause 在文件中的偏移。 */
function parseBindings(clause, clauseStart) {
  const bindings = [];
  const brace = clause.match(/\{([^}]*)\}/);
  if (brace && brace.index !== undefined) {
    const inner = brace[1];
    const contentStart = clauseStart + brace.index + 1;
    const re = /([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/g;
    let m;
    while ((m = re.exec(inner)) !== null) {
      const imported = m[1];
      const local = m[2] ?? m[1];
      const nameStart = contentStart + m.index;
      bindings.push({ imported, local, nameStart, nameEnd: nameStart + imported.length });
    }
    return bindings;
  }
  const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (ns) return [{ imported: '*', local: ns[1] }];
  const def = clause.match(/^([A-Za-z_$][\w$]*)$/);
  if (def) return [{ imported: 'default', local: def[1] }];
  return bindings;
}

/**
 * 建 local-binding → kit(specifier) 映射（移植自参考 member-scanner.ts extractBindingMap）。
 * 处理 `import * as X`/`import {a as b}`/`import X` 三形。rename-member/rebind 据此找 receiver 的 kit。
 */
function extractBindingMap(content) {
  const map = new Map();
  const re = /import\s+(?:type\s+)?(?:(\*\s+as\s+([A-Za-z_$][\w$]*))|(\{[^}]*\})|([A-Za-z_$][\w$]*))\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(re)) {
    const spec = m[5];
    if (m[2]) {
      map.set(m[2], spec);
    } else if (m[3]) {
      for (const part of m[3].slice(1, -1).split(',')) {
        const t = part.trim();
        const asM = t.match(/^(\w+)\s+as\s+(\w+)$/);
        map.set(asM ? asM[2] : t, spec);
      }
    } else if (m[4]) {
      map.set(m[4], spec);
    }
  }
  return map;
}

module.exports = { extractImports, extractBindingMap, parseBindings, lineAt, IMPORT_FROM_RE, REQUIRE_RE, IMPORT_DYNAMIC_RE };
