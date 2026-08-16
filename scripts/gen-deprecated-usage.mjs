#!/usr/bin/env node
/**
 * Generate COMPILABLE, real-usage code for every *importable* deprecated
 * symbol in the cached deprecation map, one `.ets` file per kit under
 * `test/deprecated/<kit>.ets`.
 *
 * Unlike `gen-deprecated-all.mjs` (a non-compiling scan fixture that emits
 * dual inert forms purely to trip TS-LS), this generator reads each symbol's
 * SDK declaration signature via ts-morph and emits a SINGLE correct call
 * shape: the right receiver (namespace value / qualified type / typed-local
 * instance stub), correct arity (fewest required params), and best-effort
 * argument placeholders. The result compiles under the scanner's
 * LanguageService config (strict OFF → `{} as T` and `{} as any` are fine)
 * AND triggers TS deprecation diagnostics (6385/6387) — a real usage that
 * the scanner detects.
 *
 * Compilability gate: `--check` builds a LanguageService mirroring
 * `tsc-diagnostics-scanner.buildLanguageService` and reports any
 * semantic/syntactic error beyond the expected 6385/6387/6133.
 *
 * Run:   node scripts/gen-deprecated-usage.mjs [apiVersion] [--check]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

import { Project, SyntaxKind } from "ts-morph";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const NUL = "\0";
const require = createRequire(import.meta.url);
const TS_LIB_DIR = dirname(require.resolve("typescript")).replace(/[\\/]+$/, "") + "/";

// -------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
const check = argv.includes("--check");
// --arkts: after the TS-LS self-repair, run the real ArkTSCheck (hvigorw
// default@CompileArkTS) self-repair loop to comment out any residual arkts-*
// errors (FA-only, non-TS field types, unresolvable nested types) so the
// corpus fully compiles. Requires DevEco SDK (NODE_HOME/DEVECO_SDK_HOME).
const arkts = argv.includes("--arkts");
const apiVersion = argv.find((a) => !a.startsWith("-")) ?? "24";
const generatedAt = new Date().toISOString();

const mapPath = join(ROOT, ".harmony-deprecate", `deprecation-map.${apiVersion}.json`);
/** @type {any} */
const map = JSON.parse(readFileSync(mapPath, "utf8"));
const entries = map.entries ?? [];
const kitExports = map.kitExports ?? {};
const kitDefaultExport = map.kitDefaultExport ?? {};
const sdkApiDir = map.sdkPath;

const isOrphan = (kit) => kit.startsWith("@?");
const isImportable = (kit, name) =>
  kitDefaultExport[kit] === name || (kitExports[kit] ?? []).includes(name);

// -------------------------------------------------------------- ts-morph project
const project = new Project({ useInMemoryFileSystem: true });
const sfCache = new Map();
/** Mirror of sdk-indexer.getOrCreateSourceFile (key swap .d.ets -> .d.ts). */
function getOrCreateSourceFile(filePath, content) {
  const parseKey = filePath.endsWith(".d.ets")
    ? filePath.replace(/\.d\.ets$/, ".d.ts")
    : filePath;
  const existing = project.getSourceFile(parseKey);
  if (existing) return existing;
  try {
    return project.createSourceFile(parseKey, content);
  } catch {
    return undefined;
  }
}
/** Load (cached) the SourceFile for an SDK declaration file path. */
function loadSdkFile(filePath) {
  const parseKey = filePath.endsWith(".d.ets")
    ? filePath.replace(/\.d\.ets$/, ".d.ts")
    : filePath;
  if (sfCache.has(parseKey)) return sfCache.get(parseKey);
  let sf;
  try {
    sf = getOrCreateSourceFile(filePath, readFileSync(filePath, "utf8"));
  } catch {
    sf = undefined;
  }
  sfCache.set(parseKey, sf);
  return sf;
}

// Defensive accessors (ts-morph v24 runtime surface is narrower than its types).
const getName = (n) => {
  try {
    return n?.getName?.();
  } catch {
    return undefined;
  }
};
const getModifiers = (n) => {
  try {
    return n?.getModifiers?.() ?? [];
  } catch {
    return [];
  }
};
const isStatic = (n) =>
  getModifiers(n).some((m) => {
    try {
      return m.getKind() === SyntaxKind.StaticKeyword;
    } catch {
      return false;
    }
  });
const getParameters = (n) => {
  try {
    return n?.getParameters?.() ?? [];
  } catch {
    return [];
  }
};
const paramTypeText = (p) => {
  try {
    const tn = p?.getTypeNode?.();
    if (tn) return tn.getText();
  } catch {
    // fall through
  }
  try {
    return p?.getType?.()?.getText?.() ?? "";
  } catch {
    return "";
  }
};
// `PropertySignature.isOptional` / `ParameterDeclaration.isOptional` are NOT
// functions in this ts-morph version (TypeError at runtime). Detect optionality
// via the underlying compiler node's question token, which is set for `field?:`
// signatures and `param?:` parameters.
const isOptionalNode = (p) => {
  try {
    if (typeof p?.isOptional === "function") return p.isOptional();
    return !!p?.compilerNode?.questionToken;
  } catch {
    return false;
  }
};
const isParamOptional = (p) => isOptionalNode(p);
const hasInitializer = (p) => {
  try {
    return p?.hasInitializer?.() ?? false;
  } catch {
    return false;
  }
};
const getDescendantsOfKind = (sf, kind) => {
  try {
    return sf?.getDescendantsOfKind?.(kind) ?? [];
  } catch {
    return [];
  }
};
const getStartLine = (n) => {
  try {
    return n?.getStartLineNumber?.();
  } catch {
    return undefined;
  }
};

// Per-SourceFile cache of all nameable descendants + a line->nodes index, so a
// file shared by many symbols is scanned once (SDK files reach 2700+ lines).
// Nameable kinds we may locate a declaration by line against (mirrors indexer).
const NAMEABLE_KINDS = new Set([
  SyntaxKind.ModuleDeclaration,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.EnumDeclaration,
  SyntaxKind.EnumMember,
  SyntaxKind.VariableStatement,
  SyntaxKind.VariableDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.PropertySignature,
  SyntaxKind.MethodSignature,
  SyntaxKind.PropertyDeclaration,
  SyntaxKind.MethodDeclaration,
]);
const fileDescCache = new Map(); // sf -> Node[]
const fileLineIndex = new Map(); // sf -> Map<line, Node[]>
/** All descendants of `sf` that are nameable kinds. */
function nameableDescendants(sf) {
  if (fileDescCache.has(sf)) return fileDescCache.get(sf);
  let all = [];
  try {
    all = sf.getDescendants?.() ?? [];
  } catch {
    all = [];
  }
  const filtered = all.filter((n) => NAMEABLE_KINDS.has(n.getKind()));
  fileDescCache.set(sf, filtered);
  // Build line index alongside.
  const idx = new Map();
  for (const n of filtered) {
    const ln = getStartLine(n);
    if (ln == null) continue;
    let arr = idx.get(ln);
    if (!arr) { arr = []; idx.set(ln, arr); }
    arr.push(n);
  }
  fileLineIndex.set(sf, idx);
  return filtered;
}

/**
 * Find the declaration node at `line` (1-based, == getStartLineNumber) within
 * `sf`, among nameable kinds. Falls back to ±2 lines, then to an
 * identity-inverse scan (build the member chain from ancestors and compare to
 * the symbol's exportName/members). Returns the node or undefined.
 */
function findDeclAtLine(sf, line, exportName, members) {
  if (!sf) return undefined;
  nameableDescendants(sf);
  const idx = fileLineIndex.get(sf);
  const byLine = (ln) => idx.get(ln);
  const exact = byLine(line);
  if (exact && exact.length) return exact[0];
  for (const d of [-2, -1, 1, 2]) {
    const arr = byLine(line + d);
    if (arr && arr.length) return arr[0];
  }
  // Identity-inverse: build the chain via ancestors and compare.
  const wantChain = [exportName, ...(members ?? [])].filter(Boolean);
  const all = fileDescCache.get(sf) ?? [];
  for (const n of all) {
    const chain = chainOf(n);
    if (chain.length === wantChain.length && chain.every((c, i) => c === wantChain[i])) return n;
  }
  return undefined;
}

/** Build the qualified name chain of a node via its enclosing namespaces/
 *  interfaces / classes / enums (mirrors indexer.computeIdentity). */
function chainOf(n) {
  const ENCLOSING = new Set([
    SyntaxKind.ModuleDeclaration,
    SyntaxKind.InterfaceDeclaration,
    SyntaxKind.ClassDeclaration,
    SyntaxKind.EnumDeclaration,
  ]);
  const out = [];
  let p = n.getParent?.();
  while (p) {
    if (ENCLOSING.has(p.getKind())) {
      const nm = getName(p);
      if (nm) out.unshift(nm);
    }
    p = p.getParent?.();
  }
  const own = getName(n);
  // For VariableStatement, the name is on the first VariableDeclaration.
  if (!own && n.getKind() === SyntaxKind.VariableStatement) {
    try {
      const decls = n.getDeclarationList?.()?.getDeclarations?.() ?? [];
      const first = decls[0];
      if (first) out.push(getName(first));
      return out;
    } catch {
      return out;
    }
  }
  if (own) out.push(own);
  return out;
}

// -------------------------------------------------------------- overload selection
/**
 * Given all candidate declarations for a symbol, pick the one to generate a
 * call for. Non-callable (property/enum-member/const/type) has at most one
 * candidate → return it. Callable (FunctionDeclaration/MethodSignature/
 * MethodDeclaration) → pick the overload with the fewest REQUIRED params
 * (tiebreak: fewest total params, then source order). Returns the node.
 */
function pickOverload(cands) {
  if (cands.length === 1) return cands[0];
  const callableKinds = new Set([
    SyntaxKind.FunctionDeclaration,
    SyntaxKind.MethodSignature,
    SyntaxKind.MethodDeclaration,
  ]);
  const callable = cands.filter((n) => callableKinds.has(n.getKind()));
  if (callable.length === 0) return cands[0]; // non-callable duplicates: first
  const score = (n) => {
    const ps = getParameters(n);
    const required = ps.filter((p) => !isParamOptional(p) && !hasInitializer(p)).length;
    const total = ps.length;
    const line = getStartLine(n) ?? 0;
    return [required, total, line];
  };
  callable.sort((a, b) => {
    const sa = score(a), sb = score(b);
    return sa[0] - sb[0] || sa[1] - sb[1] || sa[2] - sb[2];
  });
  return callable[0];
}

// -------------------------------------------------------------- argument mapper
/**
 * Map a parameter's type text to an ArkTS-legal argument placeholder. Delegates
 * to placeholderForType (no `any`/`as`/untyped `{}`). Genuinely-unconstructible
 * types return the `__omit__` sentinel — the emitted line then errors (2304) and
 * the hvigor self-repair comments it.
 */
function placeholderFor(typeText, ctx) {
  return placeholderForType(typeText, ctx, 0);
}

/**
 * Decide how to reference a named type in generated code, for a cast/typed-local.
 * Returns a type expression string, or undefined to fall back to `any`.
 *
 * The kit's default-export KIND (namespace vs class/function vs none) decides
 * whether nested types are reachable via the default binding or must be named:
 *  - namespace-default (indexer kitDefaultExport set, `declare namespace X;
 *    export default X`): every name declared inside the namespace is reachable
 *    as `binding.<Type>`. Named-importing them 2614s (they are namespace
 *    members, not module exports) — so ALWAYS qualify via the binding.
 *  - class/function-default (re-detected `export default class/function`, which
 *    the indexer's `collectKitDefaultExport` misses): the default class itself
 *    is `binding`; SIBLINGS (`export interface Y`) are real named exports →
 *    named-import (except the default name, which is NOT a named export).
 *  - ambient (no default at all, e.g. @ohos.UiTest): all kitExports are real
 *    named exports → named-import.
 */
function qualifyType(typeName, ctx) {
  if (!typeName) return undefined;
  const { kit, binding, namedExportsSet, sf, probedNested, defaultKind, effectiveDefault } = ctx;
  // The default-export name itself: reference via the binding (a class/function
  // value) when the kit has a detected default. For a namespace default, using
  // the namespace as a type is invalid (2749) — fall to `any`.
  if (effectiveDefault && typeName === effectiveDefault) {
    if (defaultKind === "class") return binding; // `{} as <binding>` (class type)
    return undefined; // namespace default as type → any
  }
  // namespace-default: nested types reach via the binding.
  if (defaultKind === "namespace" && binding && sf) {
    if (probedNested.has(typeName)) return `${binding}.${typeName}`;
    if (typeDeclaredInFile(sf, typeName)) {
      probedNested.add(typeName);
      return `${binding}.${typeName}`;
    }
    return undefined;
  }
  // class/function-default or ambient: real named exports (except the default,
  // excluded above) → named-import.
  if (namedExportsSet && namedExportsSet.has(typeName)) {
    ctx.addNamedImport?.(typeName);
    return typeName;
  }
  return undefined;
}

/** Is a type/interface/class/enum named `name` declared anywhere in `sf`? */
function typeDeclaredInFile(sf, name) {
  const kinds = [
    SyntaxKind.InterfaceDeclaration,
    SyntaxKind.ClassDeclaration,
    SyntaxKind.EnumDeclaration,
    SyntaxKind.TypeAliasDeclaration,
    SyntaxKind.ModuleDeclaration,
  ];
  for (const k of kinds) {
    for (const d of getDescendantsOfKind(sf, k)) {
      if (getName(d) === name) return true;
    }
  }
  return false;
}

/**
 * Detect a kit's default-export name for forms the indexer's
 * `collectKitDefaultExport` MISSES: `export default class X` /
 * `export default function f` / `export default abstract class X`. The indexer
 * only matches `export default <Identifier>`, so class/function defaults
 * (e.g. `@system.router`'s `export default class Router`) come back undefined
 * and the generator would wrongly treat the kit as ambient (named-importing
 * the default class → 2614). Returns the default name or undefined.
 */
function detectDefaultExport(sf) {
  if (!sf) return undefined;
  // `export default class X` / `function f` are declarations carrying a
  // DefaultKeyword modifier; their name is the default binding.
  for (const kind of [SyntaxKind.ClassDeclaration, SyntaxKind.FunctionDeclaration]) {
    for (const d of getDescendantsOfKind(sf, kind)) {
      if (hasDefaultModifier(d)) {
        const nm = getName(d);
        if (nm && /^[A-Za-z_$][\w$]*$/.test(nm)) return nm;
      }
    }
  }
  // `export default <Identifier>` (ExportAssignment) — already covered by the
  // indexer, but re-check defensively.
  const assigns = getDescendantsOfKind(sf, SyntaxKind.ExportAssignment);
  for (const a of assigns) {
    let txt;
    try {
      txt = a.getExpression?.()?.getText?.();
    } catch {
      txt = undefined;
    }
    if (txt && /^[A-Za-z_$][\w$]*$/.test(txt)) return txt;
  }
  return undefined;
}

/** True when a node carries the `default` modifier (defensive). */
function hasDefaultModifier(n) {
  return getModifiers(n).some((m) => {
    try {
      return m.getKind() === SyntaxKind.DefaultKeyword;
    } catch {
      return false;
    }
  });
}

/**
 * If the container declaration (class/interface) enclosing `decl` declares
 * type parameters, return `<any, any, ...>` matching the arity, so a typed
 * local `let v: T<...>` compiles (TS2314 otherwise). Empty string if none.
 */
function typeArgsOfEnclosingContainer(decl) {
  try {
    const parent = decl.getParent?.();
    if (!parent) return "";
    const k = parent.getKind();
    if (k !== SyntaxKind.ClassDeclaration && k !== SyntaxKind.InterfaceDeclaration) return "";
    const tps =
      (typeof parent.getTypeParameters === "function" && parent.getTypeParameters()) ??
      parent.compilerNode?.typeParameters ??
      [];
    const n = Array.isArray(tps) ? tps.length : 0;
    if (n <= 0) return "";
    // ArkTS forbids `any`/`unknown` type args; use `string` (concrete).
    return "<" + Array(n).fill("string").join(", ") + ">";
  } catch {
    return "";
  }
}

/** `<any, any, ...>` matching a declaration's OWN type-parameter arity (for a
 *  generic interface/type-alias/class leaf referenced in type position). */
function ownTypeArgs(decl) {
  try {
    const tps =
      (typeof decl.getTypeParameters === "function" && decl.getTypeParameters()) ??
      decl.compilerNode?.typeParameters ??
      [];
    const n = Array.isArray(tps) ? tps.length : 0;
    // ArkTS forbids `any`/`unknown` in type-arg position (arkts-no-any-unknown);
    // use `string` as a concrete filler (valid for most unconstrained generics;
    // constrained generics are caught by the hvigor self-repair).
    return n > 0 ? "<" + Array(n).fill("string").join(", ") + ">" : "";
  } catch {
    return "";
  }
}

const hasExportModifier = (n) =>
  getModifiers(n).some((m) => {
    try {
      return m.getKind() === SyntaxKind.ExportKeyword;
    } catch {
      return false;
    }
  });

/** Name of a nameable declaration node, handling VariableStatement (first
 *  VariableDeclaration) and EnumMember, which ts-morph's getName() misses. */
const nameableName = (n) => {
  try {
    const k = n?.getKind?.();
    if (k === SyntaxKind.VariableStatement) {
      const d = n?.getDeclarationList?.()?.[0];
      return d ? getName(d) : undefined;
    }
  } catch {
    // fall through
  }
  return getName(n);
};

const NAMESPACE_MEMBER_KINDS = [
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.EnumDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.ModuleDeclaration,
  SyntaxKind.VariableStatement,
];

/** Find a top-level `declare namespace <nsName>` ModuleDeclaration in `sf`. */
function findNamespaceDecl(sf, nsName) {
  for (const d of getDescendantsOfKind(sf, SyntaxKind.ModuleDeclaration)) {
    if (getName(d) !== nsName) continue;
    try {
      const p = d.getParent?.();
      if (p && p.getKind?.() === SyntaxKind.SourceFile) return d;
    } catch {
      // ignore
    }
  }
  return undefined;
}

/** Ground-truth: is `name` an EXPORTED member of the namespace `nsName` in the
 *  kit's top-level declaration file? Non-exported namespace members (e.g. usb's
 *  `interface USBConfig` without `export`) are NOT accessible via the default
 *  binding `binding.name` (TS 2339), so the usage must fall back. */
function exportedNamespaceMember(topSf, nsName, name) {
  if (!topSf || !nsName || !name) return false;
  const ns = findNamespaceDecl(topSf, nsName);
  if (!ns) return false;
  // (a) an exported declaration named `name` (e.g. `export interface Foo`).
  for (const k of NAMESPACE_MEMBER_KINDS) {
    for (const d of getDescendantsOfKind(ns, k)) {
      if (nameableName(d) === name && hasExportModifier(d)) return true;
    }
  }
  // (b) a namespace-body `export { name }` / `export { x as name }` re-export
  // (e.g. @ohos.fileio declares `function access` without `export`, then
  // `export { access }` inside `declare namespace fileIO` — the re-export is
  // what makes `fileIO.access` accessible, not the declaration's modifier).
  for (const e of getDescendantsOfKind(ns, SyntaxKind.ExportDeclaration)) {
    try {
      const els = e?.getNamedExports?.() ?? [];
      for (const el of els) {
        if (getName(el) === name) return true; // export { name }
        if (el?.getPropertyName?.() === name) return true; // export { x as name }
      }
    } catch {
      // ignore
    }
  }
  return false;
}

const NAMESPACE_VALUE_KINDS = [
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.VariableStatement,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.EnumDeclaration,
];

/** Does the namespace `nsName` expose any VALUE member (so the default binding
 *  is usable as a value, not just a type)? A namespace with only interfaces/
 *  type aliases is type-only — `const _ = binding` 2708s. Value-ness comes
 *  from exported value declarations OR namespace-body `export { X }` re-exports
 *  (re-exported names are values, e.g. @ohos.document's `export { choose }`). */
function namespaceHasValueMembers(topSf, nsName) {
  if (!topSf || !nsName) return false;
  const ns = findNamespaceDecl(topSf, nsName);
  if (!ns) return false;
  for (const k of NAMESPACE_VALUE_KINDS) {
    for (const d of getDescendantsOfKind(ns, k)) {
      if (hasExportModifier(d)) return true;
    }
  }
  for (const e of getDescendantsOfKind(ns, SyntaxKind.ExportDeclaration)) {
    try {
      const els = e?.getNamedExports?.() ?? [];
      if (els.length > 0) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

/** Ground-truth: is `name` a real module-level NAMED export of the kit's
 *  top-level declaration file? Covers `export interface/class/enum/function/
 *  const/type X`, `export { X }`, and `export { X } from '...'`. Non-exported
 *  module-level declarations (e.g. worker's `declare interface WorkerGlobalScope`
 *  with no `export`) are NOT importable as named exports (TS 2614). */
function exportedModuleLevelName(topSf, name) {
  if (!topSf || !name) return false;
  for (const k of NAMESPACE_MEMBER_KINDS) {
    for (const d of getDescendantsOfKind(topSf, k)) {
      // Only module-level (parent SourceFile); skip namespace-nested.
      try {
        const p = d.getParent?.();
        if (!p || p.getKind?.() !== SyntaxKind.SourceFile) continue;
      } catch {
        continue;
      }
      if (nameableName(d) === name && hasExportModifier(d)) return true;
    }
  }
  // `export { X }` / `export { X } from '...'` re-exports.
  for (const e of getDescendantsOfKind(topSf, SyntaxKind.ExportDeclaration)) {
    try {
      const els = e?.getNamedExports?.() ?? [];
      for (const el of els) {
        if (getName(el) === name || el?.getPropertyName?.() === name) return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

// -------------------------------------------------------------- ArkTS-legal construction
//
// ArkTSCheck forbids `any`, `as` casts, and untyped object literals. The old
// stubs (`{} as T`, `({} as any)`) compiled only under the scanner's relaxed
// TS-LS. The helpers below build REAL, ArkTS-legal values:
//   - data interface → typed object literal `{ field: <placeholder>, ... }`
//     (contextual type = the interface, so the literal is typed, not untyped)
//   - class with ctor → `new T(<typed-arg placeholders>)`
//   - call-signature interface → function literal `() => {}`
//   - enum → `Enum.FIRST_MEMBER`
//   - primitives/callbacks/arrays → literals
// Genuinely-unconstructible types (method-bearing interfaces like
// ResourceManager, tuples, Promise-typed args) yield the sentinel `__omit__`,
// which errors (2304 cannot find name) and the hvigor self-repair comments it.

const TYPE_DECL_KINDS = [
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.EnumDeclaration,
  SyntaxKind.TypeAliasDeclaration,
];
const OMIT = "__omit__";

/** JSDoc text of a declaration (for @FAModelOnly detection). Defensive. */
function jsDocText(decl) {
  if (!decl) return "";
  try {
    const docs = typeof decl.getJsDocs === "function" ? decl.getJsDocs() : [];
    return docs.map((d) => { try { return d.getText(); } catch { return ""; } }).join("\n");
  } catch {
    return "";
  }
}
/** True if the declaration's JSDoc marks it FA-model-only (unusable in stageMode). */
function declIsFAModelOnly(decl) {
  if (!decl) return false;
  return /@FAModelOnly\b/.test(jsDocText(decl));
}

/** Resolve a bare type name to its declaration in the kit's top file or the
 *  symbol's source file. Returns { decl, kind } or undefined. */
function resolveTypeDecl(name, ctx) {
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return undefined;
  for (const sf of [ctx.topSf, ctx.sf].filter(Boolean)) {
    for (const k of TYPE_DECL_KINDS) {
      for (const d of getDescendantsOfKind(sf, k)) {
        if (getName(d) === name) return { decl: d, kind: k };
      }
    }
  }
  return undefined;
}

/** Does an interface/class decl declare any method (→ not a data type; can't be
 *  object-literal'd)? Defensive. */
function interfaceHasMethods(decl) {
  if (!decl) return false;
  try {
    if ((getDescendantsOfKind(decl, SyntaxKind.MethodSignature) ?? []).length > 0) return true;
  } catch { /* ignore */ }
  try {
    if ((getDescendantsOfKind(decl, SyntaxKind.MethodDeclaration) ?? []).length > 0) return true;
  } catch { /* ignore */ }
  return false;
}

/** Required (non-optional) data fields of an interface/class decl, as
 *  { name, typeText }. Returns null if the decl has methods (not a data type)
 *  or has no enumerable required fields. Does not chase `extends` (inherited
 *  fields missing from the literal are caught by self-repair). */
function interfaceFields(decl) {
  if (!decl) return null;
  const k = decl.getKind();
  if (k !== SyntaxKind.InterfaceDeclaration && k !== SyntaxKind.ClassDeclaration) return null;
  if (interfaceHasMethods(decl)) return null;
  const fields = [];
  for (const pk of [SyntaxKind.PropertySignature, SyntaxKind.PropertyDeclaration]) {
    for (const p of getDescendantsOfKind(decl, pk)) {
      try {
        if (isOptionalNode(p)) continue;
        const nm = getName(p);
        if (!nm) continue;
        const tn = p.getTypeNode?.();
        fields.push({ name: nm, typeText: tn ? tn.getText() : "" });
      } catch { /* skip */ }
    }
  }
  return fields.length > 0 ? fields : null;
}

/** Build an ArkTS-legal typed object literal for a data interface/class decl:
 *  `{ field: <placeholder>, ... }` for each required field. Returns OMIT if
 *  not constructible (methods / an unconstructible field type). */
function objectLiteralFor(decl, ctx, depth) {
  const fields = interfaceFields(decl);
  if (!fields) return OMIT;
  const parts = [];
  for (const f of fields) {
    const ph = placeholderForType(f.typeText, ctx, depth + 1);
    if (ph === OMIT) return OMIT;
    parts.push(`${f.name}: ${ph}`);
  }
  return `{ ${parts.join(", ")} }`;
}

/**
 * Map a type text to an ArkTS-legal value placeholder (NO any/as/untyped {}).
 * Returns OMIT (`__omit__`) when no legal placeholder can be built — the
 * emitted line then errors (2304) and the hvigor self-repair comments it.
 */
function placeholderForType(typeText, ctx, depth = 0) {
  const t = (typeText ?? "").trim();
  if (!t) return OMIT;
  if (depth > 3) return OMIT;
  const core = t.replace(/\s*\|\s*(undefined|void)\s*$/, "").trim();
  if (!core) return OMIT;
  if (/^(string|String)$/.test(core)) return "''";
  if (/^(number|Number)$/.test(core)) return "0";
  if (/^(bigint)$/.test(core)) return "0n";
  if (/^(boolean|Boolean)$/.test(core)) return "false";
  if (core === "null") return "null";
  const lit = core.match(/^'[^']*'|^"[^"]*"|^\d+(\.\d+)?$/);
  if (lit) return lit[0];
  if (/\bAsyncCallback\b/.test(core) || core.startsWith("(") || /=>/.test(core) ||
      /\bFunction\b/.test(core) || /^(ErrorCallback|Callback)</.test(core)) return "() => {}";
  if (/\[\]$/.test(core) || core.startsWith("Array<") || core.startsWith("ReadonlyArray<")) return "[]";
  if (core.startsWith("[")) return OMIT; // tuple — element-wise construction is unreliable
  if (/^Uint8Array/.test(core) || core.startsWith("ArrayBuffer")) return "new Uint8Array(0)";
  if (core.startsWith("Promise<")) return OMIT; // no value placeholder for a Promise-typed arg
  if (core === "object" || core === "Object") return OMIT;
  if (core.startsWith("Record<") || core.startsWith("Partial<") || core.startsWith("Pick<") || core.startsWith("Omit<")) return OMIT;
  // Named type: strip qualified prefix (ns.Type → Type) and generic args.
  const simple = core.replace(/^[\w$]+\./, "").replace(/<.*>$/, "").trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(simple)) return OMIT;
  const resolved = resolveTypeDecl(simple, ctx);
  if (!resolved) return OMIT;
  const { decl: rd, kind: rk } = resolved;
  if (rk === SyntaxKind.EnumDeclaration) {
    const member = firstEnumMember(rd);
    if (!member) return OMIT;
    // Qualify if the enum is a namespace member (reached via the binding),
    // not a module-level named export.
    const ref = exportedNamespaceMember(ctx.topSf, ctx.binding, simple)
      ? `${ctx.binding}.${simple}` : simple;
    return `${ref}.${member}`;
  }
  if (rk === SyntaxKind.ClassDeclaration) {
    // A class-typed arg would need `new` with a correctly-qualified name and
    // constructible ctor args — unreliable for namespace-member classes.
    // Conservative: OMIT (self-repair comments; class-typed args are rare).
    return OMIT;
  }
  if (rk === SyntaxKind.InterfaceDeclaration || rk === SyntaxKind.TypeAliasDeclaration) {
    // Type alias to a function type (e.g. `type EventListener = (e) => void`)
    // → function literal. Common for callback params.
    if (rk === SyntaxKind.TypeAliasDeclaration) {
      const tn = rd.getTypeNode?.();
      const tk = tn?.getKind?.();
      if (tk === SyntaxKind.FunctionType || tk === SyntaxKind.ConstructSignature) return "() => {}";
    }
    return objectLiteralFor(rd, ctx, depth + 1);
  }
  return OMIT;
}

// -------------------------------------------------------------- form selection
/**
 * Build the usage lines for one symbol. Returns { lines: string[],
 *  namedImports: string[] } where `lines` are statement strings (with leading
 *  `// since N; useinstead ...` comment) and `namedImports` are extra names to
 *  import from the kit.
 *
 * Per-symbol `isDefaultForm` (exportName === effectiveDefault) decides the
 *  root binding: the default-export name is reached via the default import
 *  binding; every other exportName is a named import. This holds across the
 *  three kit default kinds (namespace-default / class-default / ambient).
 */
function emitUsage(sym, ctx) {
  const { kit, binding, exportName, members, entry, decl } = ctx;
  let m = members ?? [];
  const note = `// since ${entry.since ?? "?"}; useinstead ${replText(entry.repl)}`;

  // FA-model-only symbols cannot be referenced in a stageMode module (ArkTSCheck
  // rejects "used only in FA Mode"). Comment them out — the honest treatment;
  // scanner detection drops these ~113 (acceptable; they're stage-unusable).
  if (declIsFAModelOnly(decl)) {
    return {
      lines: [`${note}\n// ${sym}: FA-model-only; not referenceable in stageMode (omitted)`],
      namedImports: [],
      fallback: true,
    };
  }

  // Module-move (deprecated kit -> new kit): detection is import-level — the
  // import specifier itself triggers the rewrite-import scanner — so no body
  // reference is needed. Emitting `const _ = binding` would 2708 ("Cannot use
  // namespace as a value") for type-only namespaces (e.g. deviceManager, whose
  // namespace has only interfaces). Skip the body; the import line covers it.
  if (entry.kind === "module-move") {
    return {
      lines: [`${note}\n// ${sym}: module-move (kit-level); covered by the import line`],
      namedImports: [],
      fallback: false,
    };
  }

  // Form correction for namespace-default kits. A symbol attributed with
  // exportName=X (X != the default) is, for a namespace-default kit, usually
  // a namespace MEMBER: the indexer lists namespace `export { X }` re-exports
  // and namespace declarations as kitExports, but they are NOT module-level
  // named exports, so `import { X }` 2614s. When X is an exported namespace
  // member, re-attribute to member access `binding.X[.chain]` (the correct,
  // compiling form) by folding X into the member chain. Applies to any member
  // length: members=[] -> [X]; members=[m] -> [X, m]; etc. Declaration node
  // is unchanged (it is the leaf's declaration either way).
  let effExportName = exportName;
  if (ctx.effectiveDefault && exportName !== ctx.effectiveDefault) {
    if (exportedNamespaceMember(ctx.topSf, binding, exportName)) {
      effExportName = ctx.effectiveDefault; // reach via the default binding
      m = [exportName, ...m]; // fold X into the member chain
    }
  }
  const leaf = m.length > 0 ? m[m.length - 1] : undefined;

  // Could not locate the declaration → best-effort bare reference.
  if (!decl) {
    return {
      lines: [`${note}\n// ${sym}: declaration not located; best-effort reference`],
      namedImports: [],
      fallback: true,
    };
  }

  const kind = decl.getKind();
  const namedImports = [];
  const argCtx = {
    kit,
    binding,
    namedExportsSet: ctx.namedExportsSet,
    sf: ctx.sf,
    topSf: ctx.topSf,
    probedNested: ctx.probedNested,
    addNamedImport: (n) => namedImports.push(n),
    nextVar: ctx.nextVar,
    defaultKind: ctx.defaultKind,
    effectiveDefault: ctx.effectiveDefault,
  };

  // Per-symbol default form: effExportName IS the kit's default-export name.
  const isDefaultForm = !!ctx.effectiveDefault && effExportName === ctx.effectiveDefault;
  // The root reference for members-length-1: the binding (default form) or the
  // named-imported effExportName.
  const root = isDefaultForm ? binding : (namedImports.push(effExportName), effExportName);

  // NOTE: reachability is NOT gated here. The indexer's kitExports include
  // non-exported declarations, but a ts-morph check of the kit's TOP-LEVEL file
  // cannot see members declared in nested SDK files (which TS-LS resolves fine
  // via the import) — gating on it would comment out ~60% of reachable symbols.
  // Instead, genuinely-unreachable references are caught by the post-generation
  // LS self-repair pass (comment out lines that actually error).

  // ---- export-level (members == []) -----------------------------------------
  if (m.length === 0) {
    const r = root; // binding (default form) or exportName (named)
    switch (kind) {
      case SyntaxKind.FunctionDeclaration:
        return { lines: [`${note}\n${r}(${argsFor(decl, argCtx)});`], namedImports };
      case SyntaxKind.VariableStatement:
      case SyntaxKind.VariableDeclaration:
        return { lines: [`${note}\nconst ${argCtx.nextVar()} = ${r};`], namedImports };
      case SyntaxKind.ClassDeclaration:
      case SyntaxKind.InterfaceDeclaration:
      case SyntaxKind.TypeAliasDeclaration: {
        // Reference the deprecated type in a type annotation (declare-only,
        // no initializer) — fires 6385 on the type reference and is always
        // ArkTS-legal (no `as`/`any`/object construction needed). For a generic
        // type, ownTypeArgs supplies concrete `<string, ...>` args.
        const te = `${r}${ownTypeArgs(decl)}`;
        const v = argCtx.nextVar();
        return { lines: [`${note}\nlet ${v}: ${te};`], namedImports };
      }
      case SyntaxKind.EnumDeclaration:
        return { lines: [`${note}\nconst ${argCtx.nextVar()} = ${r}.${firstEnumMember(decl) ?? "0"};`], namedImports };
      case SyntaxKind.ModuleDeclaration: {
        // The deprecated namespace itself. ArkTS forbids using a namespace as
        // an object value (`const _ = binding` → arkts-no-ns-as-obj), and a
        // deprecated namespace/module is detected at the IMPORT line (the
        // `import binding from '<kit>'` fires 6385), so the body is comment-only.
        return {
          lines: [`${note}\n// ${sym}: deprecated namespace; detected via the import line; usage omitted`],
          namedImports: [],
          fallback: true,
        };
      }
      default:
        return { lines: [`${note}\nconst ${argCtx.nextVar()} = ${r};`], namedImports };
    }
  }

  // Bracket-notation members (e.g. `[Symbol.iterator]`) can't be emitted as
  // `receiver.[name]` (invalid syntax -> TS 1003) and the scanner's member
  // regex matches a literal `.`, so bracket access is undetectable anyway
  // (a known limitation, ~3 entries). Comment-only fallback.
  if (leaf && leaf.includes("[")) {
    return {
      lines: [`${note}\n// ${sym}: bracket-notation member '${leaf}' (scanner limitation); usage omitted`],
      namedImports: [],
      fallback: true,
    };
  }

  // ---- members length >= 1 --------------------------------------------------
  // The receiver expression: for length 1 it's `root`; for length >= 2 it's
  // `root.<containerChain>` (namespace-default: nested type via binding;
  // class-default/ambient: a qualified named export — also `root.chain`).
  let typeExpr;
  if (m.length === 1) {
    typeExpr = root;
  } else {
    const chain = m.slice(0, -1).join(".");
    typeExpr = isDefaultForm ? `${root}.${chain}` : `${root}.${chain}`;
    if (!isDefaultForm) {
      // class-default/ambient: root (= exportName) is a named import already
      // pushed; deeper chain segments are namespace-nested (no extra import).
    }
  }
  return emitMember(typeExpr, leaf, kind, decl, note, argCtx, namedImports);
}

/**
 * Emit a member access where the receiver is a TYPE/VALUE expression
 * (`typeExpr`). Dispatches on the leaf declaration's kind:
 *  - instance members (MethodSignature / non-static MethodDeclaration /
 *    PropertySignature / non-static PropertyDeclaration): typed-local stub
 *    `let v: T = {} as T; v.leaf(...)` — T must be a type (interface/class),
 *    which these leaf kinds always enclose.
 *  - namespace-value members (FunctionDeclaration / VariableStatement /
 *    VariableDeclaration / EnumMember / EnumDeclaration / ModuleDeclaration):
 *    static value access `typeExpr.leaf(...)` / `const _ = typeExpr.leaf;` —
 *    typeExpr is a value (namespace), so NO stub (avoids the namespace-as-type
 *    2749 trap, e.g. `settings.TTS.DEFAULT_TTS_PITCH`).
 */
function emitMember(typeExpr, leaf, kind, decl, note, argCtx, namedImports) {
  // Type-only leaves (interface / type alias referenced as the deprecated
  // symbol itself, e.g. huks's `export interface HuksHandle` attributed as
  // members=[HuksHandle]). Reference in TYPE position (declare-only local):
  // `let v: binding.Leaf;` resolves to the exported namespace type member and
  // fires 6385. No value construction (interfaces/type aliases have no runtime
  // value) and no `as` (ArkTS-legal).
  if (kind === SyntaxKind.InterfaceDeclaration || kind === SyntaxKind.TypeAliasDeclaration) {
    const rt = `${typeExpr}.${leaf}${ownTypeArgs(decl)}`;
    const v = argCtx.nextVar();
    return { lines: [`${note}\nlet ${v}: ${rt};`], namedImports };
  }
  const instanceKinds = new Set([
    SyntaxKind.MethodSignature,
    SyntaxKind.PropertySignature,
  ]);
  if (instanceKinds.has(kind)) {
    // ArkTSCheck requires definite assignment before use — a bare `let v: T;`
    // then `v.leaf` errors "used before being assigned", and
    // `let v: T | undefined = undefined` narrows v to `never` (ArkTS CFA sees
    // v is definitely undefined, so `v?.leaf` operates on `never`). An AMBIENT
    // `declare let v: T;` sidesteps both: externally-assigned (no 2454) and
    // not CFA-narrowed (so `v.leaf` checks against the real type T). The member
    // access still references the deprecated member (fires 6385 under the
    // scanner's reportDeprecated), with no value construction / `as` / `any` —
    // works for data AND method-bearing interfaces, even async-only ones.
    const rt = withTypeArgs(typeExpr, decl, kind);
    const v = argCtx.nextVar();
    const isCall = kind === SyntaxKind.MethodSignature;
    const tail = isCall ? `${v}.${leaf}(${argsFor(decl, argCtx)});` : `const ${argCtx.nextVar()} = ${v}.${leaf};`;
    return { lines: [`${note}\ndeclare let ${v}: ${rt}; ${tail}`], namedImports };
  }
  if (kind === SyntaxKind.MethodDeclaration) {
    if (isStatic(decl)) {
      return { lines: [`${note}\n${typeExpr}.${leaf}(${argsFor(decl, argCtx)});`], namedImports };
    }
    const rt = withTypeArgs(typeExpr, decl, kind);
    const v = argCtx.nextVar();
    return { lines: [`${note}\ndeclare let ${v}: ${rt}; ${v}.${leaf}(${argsFor(decl, argCtx)});`], namedImports };
  }
  if (kind === SyntaxKind.PropertyDeclaration) {
    if (isStatic(decl)) {
      return { lines: [`${note}\nconst ${argCtx.nextVar()} = ${typeExpr}.${leaf};`], namedImports };
    }
    const rt = withTypeArgs(typeExpr, decl, kind);
    const v = argCtx.nextVar();
    return { lines: [`${note}\ndeclare let ${v}: ${rt}; const ${argCtx.nextVar()} = ${v}.${leaf};`], namedImports };
  }
  // Namespace-value leaves (no instance stub).
  switch (kind) {
    case SyntaxKind.FunctionDeclaration:
      return { lines: [`${note}\n${typeExpr}.${leaf}(${argsFor(decl, argCtx)});`], namedImports };
    case SyntaxKind.VariableStatement:
    case SyntaxKind.VariableDeclaration:
    case SyntaxKind.EnumMember:
    case SyntaxKind.EnumDeclaration:
    case SyntaxKind.ModuleDeclaration:
      return { lines: [`${note}\nconst ${argCtx.nextVar()} = ${typeExpr}.${leaf};`], namedImports };
    default:
      // Best-effort bare reference (no call) — still resolves + fires 6385.
      return { lines: [`${note}\nconst ${argCtx.nextVar()} = ${typeExpr}.${leaf};`], namedImports };
  }
}

/** Append type args (`<any, ...>`) to a receiver type when its enclosing
 *  container is generic (TS2314 otherwise). Only for instance members. */
function withTypeArgs(typeExpr, decl, kind) {
  if (kind === SyntaxKind.MethodSignature || kind === SyntaxKind.PropertySignature ||
      kind === SyntaxKind.MethodDeclaration || kind === SyntaxKind.PropertyDeclaration) {
    const ta = typeArgsOfEnclosingContainer(decl);
    if (ta) return `${typeExpr}${ta}`;
  }
  return typeExpr;
}

/** Argument list string for a callable declaration: exactly its required
 *  params, each mapped via placeholderFor. */
function argsFor(decl, argCtx) {
  const ps = getParameters(decl).filter((p) => !isParamOptional(p) && !hasInitializer(p));
  return ps.map((p) => placeholderFor(paramTypeText(p), argCtx)).join(", ");
}

/** First enum member name of an EnumDeclaration, or undefined. */
function firstEnumMember(decl) {
  try {
    const ms = decl.getMembers?.() ?? [];
    const n = ms[0]?.getName?.();
    return n;
  } catch {
    return undefined;
  }
}

function replText(repl) {
  if (!repl) return "none";
  const kit = repl.kit ? `${repl.kit}.` : "";
  const mem = (repl.members ?? []).join(".");
  return kit + mem || "none";
}
function safeIdent(s) {
  return String(s ?? "_").replace(/[^A-Za-z0-9_$]/g, "_");
}

// -------------------------------------------------------------- per-kit build
/** Sanitize a kit into a file-name-safe stem. */
function kitTag(kit) {
  return kit.replace(/^@/, "").replace(/[^A-Za-z0-9_.]+/g, "_").replace(/\./g, "-").replace(/^_+|_+$/g, "");
}

/**
 * Group entries by distinct symbol (kit, exportName, members.join(".")),
 * collecting every source line (overloads). Skip orphans + unimportable.
 */
function groupSymbols() {
  const groups = new Map(); // key -> { kit, exportName, members, lines:Set, entry }
  let orphan = 0, unimportable = 0;
  for (const e of entries) {
    const { kit, exportName } = e.dep;
    const members = e.dep.members ?? [];
    if (!exportName || isOrphan(kit)) { orphan++; continue; }
    if (!isImportable(kit, exportName)) { unimportable++; continue; }
    const key = `${kit}${NUL}${exportName}${NUL}${members.join(".")}`;
    let g = groups.get(key);
    if (!g) {
      g = { kit, exportName, members, lines: new Set(), entry: e };
      groups.set(key, g);
    }
    if (e.source?.line) g.lines.add(e.source.line);
    g.entry = e; // last entry per symbol (since/repl consistent across overloads)
  }
  return { groups: [...groups.values()], orphan, unimportable };
}

/** Generate all per-kit files. Returns summary stats. */
function generateAll() {
  const { groups, orphan, unimportable } = groupSymbols();
  // group symbols by kit.
  const byKit = new Map();
  for (const g of groups) {
    let arr = byKit.get(g.kit);
    if (!arr) { arr = []; byKit.set(g.kit, arr); }
    arr.push(g);
  }

  const stats = { kits: 0, symbols: 0, fallback: 0, files: 0, orphan, unimportable };
  const perFileErrors = []; // for --check

  // Corpus lives inside the buildable stage module so ArkTSCheck compiles it.
  const outDir = join(ROOT, "test", "deprecated", "entry", "src", "main", "ets");
  mkdirSync(outDir, { recursive: true });
  // Clear stale corpus files from a prior (flat) generation layout.
  for (const f of readdirSync(outDir)) {
    if (f.endsWith(".ets") && f !== "corpus-index.ets" &&
        !f.includes("entryability") && !f.includes("pages")) {
      try { rmSync(join(outDir, f)); } catch { /* ignore */ }
    }
  }
  const corpusFiles = [];

  for (const [kit, syms] of [...byKit.entries()].sort()) {
    const namedExportsSet = new Set(kitExports[kit] ?? []);
    // Resolve the kit's default export. The indexer's `kitDefaultExport` only
    // matches `export default <Identifier>` (namespace defaults); class/
    // function defaults (`export default class Router`) are MISSED, so re-detect
    // from the kit's top-level declaration file.
    let effectiveDefault = kitDefaultExport[kit];
    let defaultKind = effectiveDefault ? "namespace" : "none";
    // Always load the kit's top-level declaration file — used both for
    // class/function default re-detection AND for the ground-truth
    // accessibility checks (exportedNamespaceMember / exportedModuleLevelName).
    const topFile = `${sdkApiDir}/${kit}.d.ts`;
    const topSf = loadSdkFile(topFile);
    if (!effectiveDefault) {
      const detected = detectDefaultExport(topSf);
      if (detected) {
        effectiveDefault = detected;
        defaultKind = "class";
      }
    }
    const isDefaultKit = !!effectiveDefault;
    const binding = isDefaultKit ? safeIdent(effectiveDefault) : undefined;

    // Imports: default (if any) + named.
    const namedImports = new Set();
    const addNamedImport = (n) => namedImports.add(n);

    const probedNested = new Set();
    let iVar = 0;
    const nextVar = () => `_v${iVar++}`;

    const usageLines = [];
    let fallbackCount = 0;

    for (const sym of syms.sort((a, b) => (a.members.join(".") < b.members.join(".") ? -1 : 1))) {
      // Locate the declaration. Load the source file from the entry's source.file.
      const srcFile = sym.entry.source?.file;
      const line = sym.entry.source?.line;
      const sf = srcFile ? loadSdkFile(srcFile) : undefined;
      const ctx = {
        kit, binding, exportName: sym.exportName, members: sym.members,
        entry: sym.entry, sf, topSf, isDefaultKit, namedExportsSet, probedNested,
        addNamedImport, nextVar, effectiveDefault, defaultKind,
      };
      // Find candidate declarations at any of the symbol's overload lines.
      const cands = [];
      for (const ln of sym.lines) {
        const d = findDeclAtLine(sf, ln, sym.exportName, sym.members);
        if (d) cands.push(d);
      }
      const decl = cands.length ? pickOverload(cands) : undefined;

      const r = emitUsage(`${kit}.${sym.exportName}${sym.members.length ? "." + sym.members.join(".") : ""}`, { ...ctx, decl });
      for (const n of r.namedImports ?? []) namedImports.add(n);
      if (r.fallback) fallbackCount++;
      usageLines.push(...r.lines);
      stats.symbols++;
      if (r.fallback) stats.fallback++;
    }

    // Assemble the file.
    const out = [];
    out.push(`// Auto-generated by scripts/gen-deprecated-usage.mjs — do not edit.`);
    out.push(`// Kit: ${kit}`);
    out.push(`// Deprecated symbols: ${syms.length} (compilable real-usage corpus; expect TS 6385/6387).`);
    out.push(`// Generated: ${generatedAt}`);
    out.push("");
    const imports = [];
    if (isDefaultKit) imports.push(`import ${binding} from '${kit}';`);
    const named = [...namedImports].sort();
    if (named.length) imports.push(`import { ${named.join(", ")} } from '${kit}';`);
    if (imports.length) { out.push(...imports); out.push(""); }
    out.push("// Deprecated symbol usages.");
    out.push(...usageLines);
    out.push("");

    const filePath = join(outDir, `${kitTag(kit)}.ets`);
    writeFileSync(filePath, out.join("\n"), "utf8");
    corpusFiles.push(kitTag(kit));
    stats.files++;
    stats.kits++;
    if (fallbackCount) perFileErrors.push({ kit, fallback: fallbackCount });
  }

  // corpus-index.ets: side-effect import of every corpus file so ArkTSCheck
  // pulls them all into the compile graph (only files reachable from the entry
  // ability are compiled). EntryAbility.ets imports this index.
  const indexOut = [
    "// Auto-generated by scripts/gen-deprecated-usage.mjs — do not edit.",
    "// Side-effect imports that pull every deprecated-API corpus file into the",
    "// ArkTS compile graph (only files reachable from the entry ability compile).",
    ...corpusFiles.map((t) => `import './${t}';`),
    "",
  ];
  writeFileSync(join(outDir, "corpus-index.ets"), indexOut.join("\n"), "utf8");

  return { stats, perFileErrors };
}

// -------------------------------------------------------------- --check probe
/** 1-based line number at char offset `off` in `txt` (manual, since TS's
 *  getLineAndCharacterOfPosition throws on ESM-imported `typescript` here). */
function lineOf(txt, off) {
  let line = 1;
  for (let i = 0; i < off && i < txt.length; i++) if (txt[i] === "\n") line++;
  return line;
}

/** Build a LanguageService mirroring the scanner's config over the given
 *  generated files. Returns { ls, fileText, readText, files, bump, versions }.
 *  `bump(k)` increments a file's script version so the LS re-parses after an
 *  in-place edit (a constant version yields stale diagnostics). */
function buildUsageLs(files) {
  const fileText = new Map();
  for (const f of files) fileText.set(f.replace(/\\/g, "/"), readFileSync(f, "utf8"));
  const versions = new Map();
  function readText(p) {
    const k = p.replace(/\\/g, "/");
    if (fileText.has(k)) return fileText.get(k);
    try { const t = readFileSync(p, "utf8"); fileText.set(k, t); return t; } catch { return undefined; }
  }
  const host = {
    fileExists: (p) => readText(p) !== undefined,
    readFile: (p) => readText(p),
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["esnext", "dom"],
      skipLibCheck: true,
      noLib: false,
      types: [],
      esModuleInterop: true,
      baseUrl: sdkApiDir,
      paths: { "@ohos.*": ["@ohos.*.d.ts"], "@system.*": ["@system.*.d.ts"] },
      reportDeprecated: true,
      allowImportingTsExtensions: true,
      allowNonTsExtensions: true, // let TS parse the .ets corpus files
      noUnusedLocals: false,
    }),
    getDefaultLibFileName: () => TS_LIB_DIR + "lib.esnext.d.ts",
    getNewLine: () => "\n",
    getCurrentDirectory: () => "/",
    getScriptFileNames: () => [...fileText.keys()],
    getScriptVersion: (p) => String(versions.get(p.replace(/\\/g, "/")) ?? 0),
    getScriptSnapshot: (p) => { const t = readText(p); return t == null ? undefined : ts.ScriptSnapshot.fromString(t); },
    getScriptKind: () => ts.ScriptKind.TS,
    getDirectories: () => [],
  };
  const ls = ts.createLanguageService(host);
  const bump = (k) => versions.set(k, (versions.get(k) ?? 0) + 1);
  return { ls, fileText, readText, files, bump, versions };
}

const CHECK_IGNORE = new Set([6385, 6387, 6133, 6196]); // deprecated/signature/unused

/** Iterative self-repair: comment out statement lines that produce non-ignored
 *  TS errors, and remove unimportable names from named-import clauses (2614).
 *  Repeats until no further changes (cascades: removing an import name turns
 *  its bare usages into 2304, commented next pass). Mutates files on disk. */
function repairFiles() {
  const dir = join(ROOT, "test", "deprecated");
  const files = collectTsFiles(dir);
  if (files.length === 0) return { commented: 0, importEdits: 0, dropped: 0 };
  const { ls, fileText, readText, bump } = buildUsageLs(files);
  let commented = 0;
  let importEdits = 0;
  let dropped = 0;
  for (let iter = 0; iter < 6; iter++) {
    let changed = false;
    for (const f of files) {
      const k = f.replace(/\\/g, "/");
      let txt = fileText.get(k);
      if (!txt) continue;
      const diags = [...ls.getSemanticDiagnostics(k), ...ls.getSyntacticDiagnostics(k)]
        .filter((d) => !CHECK_IGNORE.has(d.code));
      if (diags.length === 0) continue;
      const lines = txt.split(/\r?\n/);
      // Group diagnostics by 0-based line index.
      const byLine = new Map();
      for (const d of diags) {
        if (d.start == null) continue;
        const ln = lineOf(txt, d.start) - 1;
        if (ln < 0 || ln >= lines.length) continue;
        if (!byLine.has(ln)) byLine.set(ln, []);
        byLine.get(ln).push(d);
      }
      for (const [ln, ds] of byLine) {
        const orig = lines[ln];
        if (orig == null || /^\s*\/\//.test(orig)) continue; // already commented
        if (/^\s*import\s*\{/.test(orig)) {
          // Named-import clause: remove names that don't resolve (2614).
          let line2 = orig;
          for (const d of ds) {
            const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
            const m = msg.match(/no exported member '([^']+)'/);
            if (!m) continue;
            const bad = m[1];
            line2 = line2.replace(new RegExp(`\\b${bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+as\\s+\\w+\\s*,?\\s*`, "g"), "");
            line2 = line2.replace(new RegExp(`\\s*,?\\s*\\b${bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), "");
            line2 = line2.replace(/\{\s*,\s*/, "{ ");
            line2 = line2.replace(/\s*,\s*\}/, " }");
          }
          if (/\{\s*\}/.test(line2)) { lines[ln] = null; dropped++; }
          else if (line2 !== orig) { lines[ln] = line2; importEdits++; }
          else { lines[ln] = `// ${orig}  // omitted: would not compile (${ds.map((d) => d.code).join(",")})`; commented++; }
        } else {
          // Statement line: comment out (its leading `// since ...` note stays).
          lines[ln] = `// ${orig}  // omitted: would not compile (${ds.map((d) => d.code).join(",")})`;
          commented++;
        }
        changed = true;
      }
      const newTxt = lines.filter((l) => l !== null).join("\n");
      if (newTxt !== txt) {
        fileText.set(k, newTxt);
        txt = newTxt;
        writeFileSync(f, newTxt, "utf8");
        bump(k); // invalidate LS cache so next iteration sees the edit
      }
    }
    if (!changed) break;
  }
  return { commented, importEdits, dropped };
}

/**
 * Build a LanguageService mirroring the scanner's config and report any
 * semantic/syntactic error in test/deprecated/*.ets beyond 6385/6387/6133.
 */
function checkCompiles() {
  const dir = join(ROOT, "test", "deprecated");
  const files = collectTsFiles(dir);
  if (files.length === 0) { console.log("no files to check"); return; }
  const { ls, readText } = buildUsageLs(files);
  let total = 0;
  const perKit = new Map();
  for (const f of files) {
    const k = f.replace(/\\/g, "/");
    const sem = ls.getSemanticDiagnostics(k);
    const syn = ls.getSyntacticDiagnostics(k);
    const all = [...sem, ...syn].filter((d) => !CHECK_IGNORE.has(d.code));
    if (all.length === 0) continue;
    const kit = basename(f, ".ets");
    perKit.set(kit, (perKit.get(kit) ?? 0) + all.length);
    total += all.length;
    const locLine = (d) => {
      try {
        const df = d.file?.fileName;
        const dt = df ? readText(df) : undefined;
        if (d.start == null || typeof dt !== "string") return null;
        const ln = lineOf(dt, d.start);
        return { line: ln, text: dt.split(/\r?\n/)[ln - 1] ?? "" };
      } catch { return null; }
    };
    if (all.length <= 6) {
      for (const d of all) {
        const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
        const ll = locLine(d);
        console.log(`  ${kit}:${ll?.line ?? "?"} [${d.code}] ${msg}`);
        if (ll?.text) console.log(`    | ${ll.text.trim()}`);
      }
    } else {
      const d0 = all[0];
      const ll0 = locLine(d0);
      console.log(`  ${kit}: ${all.length} errors (first: [${d0.code}] ${ts.flattenDiagnosticMessageText(d0.messageText, "\n")})`);
      if (ll0?.text) console.log(`    | ${ll0.text.trim()}`);
    }
  }
  console.log(`\n--check: ${total} residual errors across ${perKit.size} kits (out of ${files.length} files)`);
}

// Scaffolding subdirs (entry ability / pages) use @kit.* imports the TS-LS
// host can't resolve, and build/oh_modules/.hvigor hold generated artifacts —
// exclude all from the TS-LS self-repair / check, which must only touch the
// generated corpus files.
const TS_LS_SKIP_DIRS = new Set([
  "entryability", "pages",          // scaffolding
  "build", "oh_modules", ".hvigor", // hvigor artifacts
  "node_modules",
]);

function collectTsFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) {
        if (TS_LS_SKIP_DIRS.has(name)) continue;
        walk(p);
      } else if (name.endsWith(".ets")) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

// -------------------------------------------------------------- main
const { stats, perFileErrors } = generateAll();
console.log(`generated ${stats.files} files / ${stats.symbols} symbols across ${stats.kits} kits`);
console.log(`  orphans skipped: ${stats.orphan}, unimportable skipped: ${stats.unimportable}`);
console.log(`  fallback (decl not located / best-effort): ${stats.fallback}`);
if (perFileErrors.length) {
  console.log("kits with fallback symbols:");
  for (const { kit, fallback } of perFileErrors) console.log(`  ${kit}: ${fallback}`);
}
// Always self-repair: comment out lines that would not compile (genuinely
// unreachable refs, overload-arity mismatches) and drop unimportable names
// from named-import clauses, so the on-disk corpus compiles cleanly.
const repair = repairFiles();
console.log(`self-repair: commented ${repair.commented} un-compilable statement line(s), edited ${repair.importEdits} import clause(s), dropped ${repair.dropped} empty import(s)`);
if (check) {
  console.log("\nrunning compile check (--check)...");
  checkCompiles();
}
if (arkts) {
  console.log("\nrunning ArkTSCheck self-repair (--arkts)...");
  const r = spawnSync(process.execPath, [join(__dirname, "check-arkts.mjs")],
    { stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error("ArkTSCheck self-repair reported residual errors (see above).");
    process.exit(r.status ?? 1);
  }
}
