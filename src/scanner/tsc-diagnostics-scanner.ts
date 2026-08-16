/**
 * TS-LS (TypeScript LanguageService) deprecation scanner.
 *
 * Replaces the regex member/instance detection layer with the TypeScript
 * compiler's own `getSuggestionDiagnostics` (codes 6385 deprecated symbol /
 * 6387 deprecated signature, with `reportDeprecated:true`). Detection via the
 * binder+checker catches every call site the compiler flags as deprecated —
 * including variable-indirected instance methods (`const c = new X(); c.y()`)
 * that the regex scanner cannot match (the receiver isn't an import binding),
 * and `.ets` files (ArkUI) that the ts-morph instance scanner skips. It also
 * never matches text inside comments/strings, eliminating those false positives.
 *
 * ArkUI `.ets` is presented to TS as a virtual `.ts` root file (same on-disk
 * dir, `getScriptKind: () => ts.ScriptKind.TS`); `@Entry`/`@Component`/`struct`/
 * `build()` become harmless "Cannot find name" semantics that do NOT block
 * 6385/6387. Proven on `open_neteasy_cloud` via scripts/probe-real-project.mjs
 * + scripts/scan-deprecated.mjs (3/3 correct, 0 false positives, 0 misses).
 *
 * Classification is REUSED unchanged: a deprecated call site resolves to
 * (receiver, accessChain); the static path (`binding.<chain>`) calls
 * `classifyMemberCallSite` (the same helper the regex scanner uses), the
 * instance path (`var.<leaf>`) calls `instanceFinding`. Finding shapes and the
 * rewriter contract stay identical — only the *detection* layer changes.
 *
 * Degrades gracefully: when the SDK is absent (cache-only CI without DevEco
 * installed) it returns `ran:false`, and the CLI falls back to the regex scanners.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { walkFiles } from "../walk.js";
import {
  buildMemberIndex,
  buildInstanceIndex,
  classifyMemberCallSite,
  createBindingAllocator,
  dedupeOverlappingSpans,
  entryEligible,
  extractBindingMap,
  instanceFinding,
  type ContainerDropinResolver,
  type KitMoveResolver,
  type MemberScanOptions,
} from "./member-scanner.js";
import type { Finding } from "../rules/types.js";

export interface DiagnosticsScanResult {
  findings: Finding[];
  filesScanned: number;
  /** True when the pass actually ran (SDK present + files found). */
  ran: boolean;
}

/** Directory holding the bundled `lib.*.d.ts` (for `getDefaultLibFileName`). */
const TS_LIB_DIR = (() => {
  // Resolve the typescript package's main entry and derive its lib/ dir. Robust
  // across ESM dist layouts (the probes hard-coded ../node_modules, which breaks
  // from dist/scanner/).
  const tsResolve = createRequire(import.meta.url);
  return dirname(tsResolve.resolve("typescript")).replace(/[\\/]+$/, "") + "/";
})();

/**
 * Scan a project's `.ts` + `.ets` files for deprecated `@ohos.*` member/instance
 * usage via the TypeScript LanguageService. One shared program; each `.ets` is
 * a virtual `.ts` root file. See module doc for the detection/classification
 * split and the degrade behavior.
 */
export function scanProjectDeprecatedMembers(opts: MemberScanOptions): DiagnosticsScanResult {
  const { projectRoot, map } = opts;
  const since = opts.since ?? 0;
  const sdkApiDir = map.sdkPath;
  const empty: DiagnosticsScanResult = { findings: [], filesScanned: 0, ran: false };
  if (!sdkApiDir || !existsDir(sdkApiDir)) return empty;

  const files = walkFiles(projectRoot, { extensions: [".ts", ".ets"] });
  if (files.length === 0) return empty;

  const memberIndex = buildMemberIndex(map);
  const instanceIndex = buildInstanceIndex(map);
  if (Object.keys(memberIndex).length === 0 && instanceIndex.size === 0) {
    // Nothing deprecated to find; skip the LS build entirely.
    return empty;
  }
  const kitMove: KitMoveResolver = (k) => map.kitIndex[k]?.newKit;
  const dropinMap = map.crossKitDropin ?? {};
  const containerDropin: ContainerDropinResolver = (k, n) =>
    dropinMap[`${k}\0${n}`] ?? dropinMap[`${k}\0default`];
  const ctx = {
    uiContextExpr: opts.uiContextExpr ?? "this.getUIContext()",
    windowStageExpr: opts.windowStageExpr ?? "this.windowStage",
    windowExpr: opts.windowExpr ?? "this.window",
  };

  const { ls, checker, tsOfEts } = buildLanguageService(files, sdkApiDir);

  const dedupe = new Map<string, Finding>();
  const injectFindings: Finding[] = [];
  let scanned = 0;

  for (const [ets, tsFile] of tsOfEts) {
    const file = ets; // absolute on-disk path (real .ets or .ts)
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    scanned++;
    const sf = ls.getProgram()?.getSourceFile(tsFile);
    if (!sf) continue; // failed to parse (e.g. ArkUI-only errors blocked it)

    const bindingMap = extractBindingMap(content);
    const alloc = createBindingAllocator(
      content,
      new Set(Object.keys(map.kitDefaultExport ?? {})),
    );
    const pickBinding = alloc.pickBinding;

    let diags: ts.Diagnostic[];
    try {
      diags = ls.getSuggestionDiagnostics(tsFile);
    } catch {
      continue;
    }
    for (const d of diags) {
      if (d.code !== 6385 && d.code !== 6387) continue;
      if (d.start == null) continue;
      const pae = findEnclosingMemberAccess(sf, d.start);
      if (!pae) continue;
      const isTypeRef = ts.isQualifiedName(pae);
      const split = splitToReceiver(pae, sf);
      if (!split) continue;
      const { leftmostText, fullChain } = split;

      if (bindingMap.has(leftmostText)) {
        // Static path: receiver is an import binding. Kit comes from the
        // binding's import; accessChain is the full chain after the binding.
        // Applies to BOTH value-position property access AND type-position
        // qualified names (e.g. `bluetooth.CharacteristicReadReq` in a type
        // annotation) — a deprecated type referenced in a type annotation
        // still needs its rename spliced when its kit moved/renamed it.
        const kit = bindingMap.get(leftmostText)!;
        const entries = memberIndex[kit];
        if (entries) {
          for (const e of entries) {
            if (!arraysEqual(e.dep.members, fullChain)) continue;
            if (!entryEligible(e, kit, map, since)) continue;
            const f = classifyMemberCallSite(
              file, projectRoot, pae.getStart(sf), pae.getEnd(), content,
              leftmostText, fullChain, e, ctx, kitMove, pickBinding, map.kitExports,
            );
            insertDedupe(dedupe, f);
          }
        }
        continue;
      }

      // Type-position qualified names have no instance semantics (you don't
      // call a method on a type reference), so the instance path below only
      // applies to value-position property access.
      if (isTypeRef) continue;

      // Instance path: receiver is a local variable. Resolve its type via the
      // checker (constructor return type, factory call, Promise unwrap, ...).
      // Deprecated instance members are single-leaf, so the chain is [leaf].
      const receiverExpr = pae.expression;
      const hit = resolveReceiver(receiverExpr, checker, map, sdkApiDir);
      if (!hit) continue;
      const { kit, typeHead } = hit;
      const entries = instanceIndex.get(`${kit}\0${typeHead}`);
      if (!entries) continue;
      const leaf = pae.name.text;
      const receiverText = receiverExpr.getText(sf);
      for (const { accessChain, entry: e } of entries) {
        if (accessChain.length !== 1 || accessChain[0] !== leaf) continue;
        if (since && e.since > since) continue;
        const f = instanceFinding(
          relative(projectRoot, file).split(sep).join("/"),
          pae.getStart(sf), pae.getEnd(), content, receiverText, accessChain, e,
          kitMove, containerDropin,
        );
        insertDedupe(dedupe, f);
      }
    }

    injectFindings.push(...alloc.injectImports(file, projectRoot, content));
  }

  const deduped = dedupeOverlappingSpans([...dedupe.values()]);
  return { findings: [...deduped, ...injectFindings], filesScanned: scanned, ran: true };
}

/* ------------------------------------------------------------------ */
/* LanguageService host — virtual .ts for .ets, disk-read + SDK paths. */
/* ------------------------------------------------------------------ */

interface LsBundle {
  ls: ts.LanguageService;
  checker: ts.TypeChecker;
  /** map of real on-disk path -> virtual .ts path fed to the LS. */
  tsOfEts: Map<string, string>;
}

function buildLanguageService(files: string[], sdkApiDir: string): LsBundle {
  // virtual .ts path -> text, keyed by forward-slash path.
  const fileText = new Map<string, string>();
  const tsOfEts = new Map<string, string>();
  for (const f of files) {
    const fwd = f.replace(/\\/g, "/");
    const tsFile = fwd.replace(/\.ets$/, ".ts");
    tsOfEts.set(f, tsFile);
    fileText.set(tsFile, readFileSync(f, "utf8"));
  }

  // Disk-read with .ts -> .ets fallback (cross-file relative imports).
  function readText(p: string): string | undefined {
    const k = p.replace(/\\/g, "/");
    if (fileText.has(k)) return fileText.get(k);
    let real = p;
    try {
      if (!existsSync(p) && k.endsWith(".ts")) {
        const e = p.slice(0, -3) + ".ets";
        if (existsSync(e)) real = e;
      }
    } catch {
      // fall through to direct read
    }
    try {
      const st = statSync(real);
      if (st.isDirectory()) return undefined;
      const t = readFileSync(real, "utf8");
      fileText.set(k, t);
      return t;
    } catch {
      return undefined;
    }
  }

  const host: ts.LanguageServiceHost = {
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
      paths: {
        "@ohos.*": ["@ohos.*.d.ts"],
        "@system.*": ["@system.*.d.ts"],
      },
      reportDeprecated: true,
      allowImportingTsExtensions: true,
      noUnusedLocals: false,
    }),
    getDefaultLibFileName: () => TS_LIB_DIR + "lib.esnext.d.ts",
    getNewLine: () => "\n",
    getCurrentDirectory: () => "/",
    getScriptFileNames: () => [...tsOfEts.values()],
    getScriptVersion: () => "0",
    getScriptSnapshot: (p) => {
      const t = readText(p);
      return t == null ? undefined : ts.ScriptSnapshot.fromString(t);
    },
    getScriptKind: () => ts.ScriptKind.TS,
    getDirectories: () => [],
  };

  const ls = ts.createLanguageService(host);
  const checker = ls.getProgram()!.getTypeChecker();
  return { ls, checker, tsOfEts };
}

/* ------------------------------------------------------------------ */
/* AST helpers — locate the deprecated property access + split it.     */
/* ------------------------------------------------------------------ */

/** Deepest deprecated member access whose span contains `pos`. This is a
 *  `PropertyAccessExpression` in value position (`ns.member()` / `ns.member`)
 *  OR a `QualifiedName` in type position (`: ns.MemberType`). Both shapes can
 *  carry a 6385 deprecation diagnostic, and both need their rename spliced
 *  when the member moved/renamed across a kit — type annotations reference
 *  deprecated types just as much as value accesses. */
function findEnclosingMemberAccess(
  sf: ts.SourceFile,
  pos: number,
): ts.PropertyAccessExpression | ts.QualifiedName | undefined {
  let best: ts.PropertyAccessExpression | ts.QualifiedName | undefined;
  function visit(node: ts.Node): void {
    const start = node.getStart(sf);
    const end = node.getEnd();
    if (pos < start || pos >= end) return;
    if (ts.isPropertyAccessExpression(node) || ts.isQualifiedName(node)) {
      best = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return best;
}

interface PaeSplit {
  /** Leftmost identifier text (the static receiver / binding candidate). */
  leftmostText: string;
  /** Full member chain from the leftmost receiver to the accessed leaf. */
  fullChain: string[];
}

/** Walk a PAE (value) or QualifiedName (type) leftwards to the root identifier,
 *  collecting the member chain. PropertyAccessExpression chains via
 *  `.expression`/`.name`; QualifiedName (type position) via `.left`/`.right` —
 *  same shape, different field names. */
function splitToReceiver(
  node: ts.PropertyAccessExpression | ts.QualifiedName,
  sf: ts.SourceFile,
): PaeSplit | undefined {
  const chain: string[] = [];
  let cur: ts.PropertyAccessExpression | ts.QualifiedName | ts.Expression = node;
  while (ts.isPropertyAccessExpression(cur)) {
    chain.unshift(cur.name.text);
    cur = cur.expression;
  }
  while (ts.isQualifiedName(cur)) {
    chain.unshift(cur.right.text);
    cur = cur.left;
  }
  if (!ts.isIdentifier(cur)) return undefined; // e.g. `(a.b).c` or `fn().x`
  return { leftmostText: cur.getText(sf), fullChain: chain };
}

/* ------------------------------------------------------------------ */
/* Symbol -> kit resolution (receiver type -> owning kit via file->kit map). */
/* ------------------------------------------------------------------ */

function resolveReceiver(
  node: ts.Expression,
  checker: ts.TypeChecker,
  map: MemberScanOptions["map"],
  sdkApiDir: string,
): { kit: string; typeHead: string } | undefined {
  const type = checker.getTypeAtLocation(node);
  const sym = type.symbol ?? type.aliasSymbol;
  if (!sym) return undefined;
  const typeHead = sym.getName();
  if (!typeHead || isReservedName(typeHead)) return undefined;
  const fileKit = map.fileKit;
  for (const decl of sym.getDeclarations() ?? []) {
    const sf = decl.getSourceFile();
    if (sf) {
      // Primary: declaration file -> kit via the indexer's file->kit map.
      if (fileKit) {
        const rel = relative(sdkApiDir, sf.fileName).split(sep).join("/");
        const kit = fileKit[rel];
        if (kit && !kit.startsWith("@?")) return { kit, typeHead };
      }
      // Fallback: enclosing `declare module '@ohos.X'` (ambient fixtures).
      const mod = findAncestor(decl, ts.isModuleDeclaration);
      if (mod?.name) {
        const name = stripQuotes(mod.name.getText());
        if (name.startsWith("@ohos.") || name.startsWith("@system.")) {
          return { kit: name, typeHead };
        }
      }
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Small utilities.                                                    */
/* ------------------------------------------------------------------ */

function insertDedupe(dedupe: Map<string, Finding>, f: Finding | null): void {
  if (!f) return; // suppressed (e.g. no-op / aligned kit move)
  const key = `${f.file}:${f.line}:${f.oldSymbol}`;
  const prev = dedupe.get(key);
  if (!prev || (prev.needsManual && !f.needsManual)) dedupe.set(key, f);
}

function arraysEqual(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

function findAncestor<T extends ts.Node>(
  node: ts.Node,
  predicate: (n: ts.Node) => n is T,
): T | undefined {
  let n: ts.Node | undefined = node.parent;
  while (n) {
    if (predicate(n)) return n;
    n = n.parent;
  }
  return undefined;
}

function existsDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function stripQuotes(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, "");
}

/** Skip TS built-in symbol names that would never name a HarmonyOS type. */
function isReservedName(name: string): boolean {
  return (
    name === "" ||
    name === "Array" ||
    name === "Promise" ||
    name === "Object" ||
    name === "Function" ||
    name === "undefined" ||
    name === "string" ||
    name === "number" ||
    name === "boolean"
  );
}
