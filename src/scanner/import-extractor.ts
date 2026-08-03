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

const FROM_RE = /from\s*(['"])([^'"]+)\1/g;
const REQUIRE_RE = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

/** Extract all imports from file content. */
export function extractImports(content: string): ImportInfo[] {
  const out: ImportInfo[] = [];
  for (const m of content.matchAll(FROM_RE)) {
    pushImport(out, m, content, 1, 2);
  }
  for (const m of content.matchAll(REQUIRE_RE)) {
    pushImport(out, m, content, 1, 2);
  }
  return out;
}

function pushImport(
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
    specEnd: quoteStart + specifier.length + 2, // open + close quote
    bindings: extractBindings(m, content),
  });
}

/** Extract `{a, b as c}` / default / `* as ns` bindings from the match region. */
function extractBindings(m: RegExpMatchArray, content: string): ImportInfo["bindings"] {
  // Match spans from `import` to the specifier; parse the clause in between.
  const start = m.index ?? 0;
  const specIdx = start + m[0].lastIndexOf(m[2]!);
  const clause = content.slice(start, specIdx);
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
  const def = clause.match(/import\s+([A-Za-z_$][\w$]*)\s+from/);
  if (def) bindings.push({ imported: "default", local: def[1] });
  const ns = clause.match(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/);
  if (ns) bindings.push({ imported: "*", local: ns[1] });
  return bindings;
}

/** 1-based line number for a character offset. */
function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}
