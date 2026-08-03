/**
 * Tolerant import extraction for `.ets` / `.ts`.
 *
 * We deliberately avoid parsing the whole file with tsc: ArkUI `.ets` uses
 * `struct` / `@Component` / `build()` which tsc cannot parse. Import lines at
 * the top of a file are standard TS, so a regex/offset approach is both robust
 * and sufficient for the import-specifier rewrites that form the MVP.
 *
 * Returned offsets target the *quoted specifier literal* (including the
 * surrounding quotes) so the rewriter can splice precisely.
 */

export interface ImportInfo {
  /** The module specifier without quotes, e.g. `@ohos.ability.dataUriUtils`. */
  specifier: string;
  /** 1-based line of the specifier literal. */
  line: number;
  /** Start character offset of the opening quote. */
  specStart: number;
  /** End character offset just past the closing quote. */
  specEnd: number;
  /** Local bindings introduced, for phase-2 member resolution. */
  bindings: { local: string; imported: string }[];
}

// `import <clause> from 'spec'` — clause captured so bindings can be parsed.
const IMPORT_FROM_RE = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s*(['"])([^'"]+)\2/g;
const REQUIRE_RE = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
const IMPORT_DYNAMIC_RE = /import\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

/** Extract all imports from file content. */
export function extractImports(content: string): ImportInfo[] {
  const out: ImportInfo[] = [];
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

function pushDynamicImport(
  out: ImportInfo[],
  m: RegExpMatchArray,
  content: string,
  quoteGroup: number,
  specGroup: number,
): void {
  if (m.index === undefined) return;
  const quoteChar = m[quoteGroup];
  const specifier = m[specGroup];
  const quoteStart = m.index + m[0].indexOf(quoteChar + specifier);
  out.push({
    specifier,
    line: lineAt(content, quoteStart),
    specStart: quoteStart,
    specEnd: quoteStart + specifier.length + 2,
    bindings: [], // dynamic import() has no bindings
  });
}

function pushImport(
  out: ImportInfo[],
  m: RegExpMatchArray,
  content: string,
  clause: string | null,
  quoteGroup: number,
  specGroup: number,
): void {
  if (m.index === undefined) return;
  const quoteChar = m[quoteGroup];
  const specifier = m[specGroup];
  const quoteStart = m.index + m[0].indexOf(quoteChar + specifier);
  out.push({
    specifier,
    line: lineAt(content, quoteStart),
    specStart: quoteStart,
    specEnd: quoteStart + specifier.length + 2, // open + close quote
    bindings: clause ? parseBindings(clause) : [],
  });
}

/** Parse `{a, b as c}` / default / `* as ns` bindings from an import clause. */
function parseBindings(clause: string): ImportInfo["bindings"] {
  const bindings: ImportInfo["bindings"] = [];
  const brace = clause.match(/\{([^}]*)\}/);
  if (brace) {
    for (const raw of brace[1].split(",")) {
      const t = raw.trim();
      if (!t) continue;
      const asM = t.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asM) bindings.push({ imported: asM[1], local: asM[2] });
      else if (/^\w+$/.test(t)) bindings.push({ imported: t, local: t });
    }
    return bindings;
  }
  const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (ns) return [{ imported: "*", local: ns[1] }];
  const def = clause.match(/^([A-Za-z_$][\w$]*)$/);
  if (def) return [{ imported: "default", local: def[1] }];
  return bindings;
}

/** 1-based line number for a character offset. */
function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}
