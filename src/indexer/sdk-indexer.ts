/**
 * Indexer: parse SDK `.d.ts` / `.d.ets` declarations into a deprecation map.
 *
 * For every declaration carrying a `@deprecated since N` JSDoc we compute:
 *   - identity: kit (import specifier) + enclosing namespace/interface/class chain
 *   - replacement: parsed `@useinstead` token (or null when absent)
 *   - kind: `module-move` when a top-level `declare namespace` itself is
 *     deprecated and its `@useinstead` points to a different kit; `member`
 *     otherwise.
 *
 * Phase 2 (recursive): indexes every `@ohos.*.d.ts` / `.d.ets` in the SDK
 * `api/` tree, including files in subdirectories. Subdirectory files (e.g.
 * `bundleManager/ApplicationInfo.d.ts`, `app/context.d.ts`) are not themselves
 * importable kits — they are re-exported by a top-level `@ohos.*` kit. We
 * resolve each nested declaration's owning kit by tracing the re-export:
 *   - `import * as _X from './dir/file'`     -> whole nested file -> kit
 *   - `import { Name as _Local } from './dir/file'` -> (file, Name) -> kit
 * `@internal/**` is skipped.
 */

import { basename, dirname, resolve, sep } from "node:path";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind, type Node, type ImportDeclaration, type ExportDeclaration } from "ts-morph";
import { walkFiles } from "../walk.js";
import { parseUseinstead, toReplSymbol } from "./useinstead-parser.js";
import type {
  DeprecationEntry,
  DeprecationMap,
  DepSymbol,
  ExportIndex,
  CrossKitDropin,
  KitDepInfo,
} from "../rules/types.js";

const DEPRECATED_RE = /@deprecated\s+since\s+(\d+)/;
const USEINSTEAD_RE = /@useinstead\s+(\S+)/;

const NAMEABLE_KINDS = new Set<SyntaxKind>([
  SyntaxKind.ModuleDeclaration,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.EnumDeclaration,
  SyntaxKind.EnumMember,
  SyntaxKind.VariableStatement,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.PropertySignature,
  SyntaxKind.MethodSignature,
  SyntaxKind.PropertyDeclaration,
  SyntaxKind.MethodDeclaration,
]);

const ENCLOSING_KINDS = new Set<SyntaxKind>([
  SyntaxKind.ModuleDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.EnumDeclaration,
]);

export interface IndexOptions {
  /** Full path to the SDK `ets/api` directory. */
  sdkApiDir: string;
  /** Resolved apiVersion (for cache naming + map metadata). */
  apiVersion: number;
  /** Generation timestamp (injected so the indexer stays deterministic-ish). */
  generatedAt?: string;
}

export function buildDeprecationMap(opts: IndexOptions): DeprecationMap {
  const { sdkApiDir, apiVersion } = opts;

  const project = new Project({ useInMemoryFileSystem: true });
  const files = collectDeclFiles(sdkApiDir);
  if (files.length === 0) {
    throw new Error(`No @ohos.* declaration files under ${sdkApiDir}`);
  }

  const fileSet = new Set(files);

  // Known kits: top-level `@ohos.*` files only (nested files are not kits).
  const knownKits = new Set<string>();
  const topLevelFiles: string[] = [];
  for (const f of files) {
    if (isTopLevel(f)) {
      knownKits.add(kitFromFile(basename(f)));
      topLevelFiles.push(f);
    }
  }
  // Case-insensitive lookup (lowercased -> real-case) so wrong-cased
  // @useinstead kit qualifiers (e.g. `ohos.uitest.Component`) still resolve.
  const kitLookup = new Map<string, string>();
  for (const k of knownKits) kitLookup.set(k.toLowerCase(), k);

  // Resolve nested-file -> owning kit via re-export tracing from top-level files.
  const nsImportKits = new Map<string, string>(); // nestedFile -> kit
  const namedReexports = new Map<string, string>(); // `${nestedFile}\0${exportName}` -> kit
  buildReexportMap(project, topLevelFiles, fileSet, nsImportKits, namedReexports);

  const entries: DeprecationEntry[] = [];
  const kitIndex: Record<string, KitDepInfo> = {};
  const exportIndex: ExportIndex = {};
  const crossKitDropin: CrossKitDropin = {};

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const sourceFile = getOrCreateSourceFile(project, filePath, content);
    if (!sourceFile) continue;
    const ownKit = resolveOwnKit(filePath, nsImportKits, namedReexports);

    sourceFile.forEachDescendant((node) => {
      if (!isNameable(node)) return;
      const jsdocTexts = getJsdocTexts(node, content);
      if (jsdocTexts.length === 0) return;

      let since: number | undefined;
      let useToken: string | undefined;
      for (const text of jsdocTexts) {
        const dm = text.match(DEPRECATED_RE);
        if (!dm) continue;
        since = Number(dm[1]);
        const um = text.match(USEINSTEAD_RE);
        if (um) useToken = um[1];
        break; // first deprecated-bearing doc wins
      }
      if (since === undefined) return;

      const { dep, isNamespaceLevel } = computeIdentity(node, ownKit);
      const repl = useToken
        ? toReplSymbol(parseUseinstead(useToken, knownKits, ownKit, kitLookup))
        : null;

      // Only top-level kits can drive import-level module moves; nested files
      // never produce kitIndex entries (they are re-exported, not imported).
      const newKit = repl?.kit;
      const isModuleMove =
        isTopLevel(filePath) && isNamespaceLevel && !!newKit && newKit !== ownKit;

      if (isTopLevel(filePath)) {
        if (isModuleMove) {
          mergeKit(kitIndex, ownKit, since, { newKit: newKit! });
        } else if (isNamespaceLevel) {
          // Namespace deprecated but no cross-kit replacement -> manual.
          mergeKit(kitIndex, ownKit, since, { manual: true });
        }
      }

      const sourceLine = node.getStartLineNumber() ?? 0;
      entries.push({
        dep,
        since,
        repl,
        kind: isModuleMove ? "module-move" : "member",
        source: { file: filePath, line: sourceLine },
      });

      // Same-kit export-name rename (e.g. @ohos.UiTest `By` -> `On`): a
      // memberless declaration whose @useinstead resolves to a single new
      // name within the same kit. These drive the rename-export scanner rule.
      if (isTopLevel(filePath) && !isNamespaceLevel && !dep.members?.length && dep.exportName && repl?.members?.length === 1) {
        const newName = repl.members[0];
        const sameKit = !repl.kit || repl.kit === ownKit;
        if (sameKit && newName !== dep.exportName) {
          exportIndex[`${ownKit}\0${dep.exportName}`] = newName;
        }
        // Cross-kit same-name drop-in (e.g. @system.router.RouterOptions ->
        // @ohos.router.RouterOptions): the export moved to another kit under
        // the same name. A named-import clause rewrites its specifier when
        // every binding drops to the same target kit. Skip kits that already
        // have a module-level move (rewrite-import handles them wholesale).
        if (repl.kit && repl.kit !== ownKit && newName === dep.exportName && !kitIndex[ownKit]?.newKit) {
          crossKitDropin[`${ownKit}\0${dep.exportName}`] = repl.kit;
        }
      }
    });
  }

  return {
    apiVersion,
    sdkPath: sdkApiDir,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    entries,
    kitIndex,
    exportIndex,
    crossKitDropin,
  };
}

/** Merge a kit summary, keeping the lowest `since` and respecting precedence. */
function mergeKit(
  index: Record<string, KitDepInfo>,
  kit: string,
  since: number,
  patch: Partial<KitDepInfo>,
): void {
  const existing = index[kit];
  if (!existing) {
    index[kit] = { since, ...patch };
    return;
  }
  // Lowest since wins; a module-move takes precedence over manual.
  existing.since = Math.min(existing.since, since);
  if (patch.newKit) existing.newKit = patch.newKit;
  if (patch.manual) existing.manual = true;
  if (patch.newKit) existing.manual = false;
}

/** Recursively collect declaration files (.d.ts/.d.ets), skipping @internal. */
function collectDeclFiles(sdkApiDir: string): string[] {
  const all = walkFiles(sdkApiDir, { extensions: [".d.ts", ".d.ets"] });
  return all.filter((f) => !isInternal(f));
}

/** `@internal/**` paths are excluded from the public map. */
function isInternal(filePath: string): boolean {
  return filePath.split(sep).includes("@internal");
}

/** Top-level files are `@ohos.*.d.ts` / `.d.ets` directly under api/. */
function isTopLevel(filePath: string): boolean {
  // `@ohos.*` are the current kits; `@system.*` are the legacy (pre-API-9)
  // system kits, also top-level importable modules. No nested declaration
  // file has an `@`-prefixed basename, so the prefix check is unambiguous.
  const name = basename(filePath);
  return name.startsWith("@ohos.") || name.startsWith("@system.");
}

function isEts(filePath: string): boolean {
  return filePath.endsWith(".d.ets");
}

/**
 * Create or fetch a SourceFile in the project. `.d.ets` is parsed under a
 * `.d.ts` key so the compiler treats it as a TS declaration. Reuses an
 * existing entry (buildReexportMap and the main loop both touch top-level
 * files) instead of throwing on the second create.
 */
function getOrCreateSourceFile(
  project: Project,
  filePath: string,
  content: string,
) {
  const parseKey = isEts(filePath) ? filePath.replace(/\.d\.ets$/, ".d.ts") : filePath;
  try {
    const existing = project.getSourceFile(parseKey);
    if (existing) return existing;
    return project.createSourceFile(parseKey, content);
  } catch {
    return undefined;
  }
}

/** `@ohos.ability.dataUriUtils.d.ts` -> `ohos.ability.dataUriUtils`. */
function kitFromFile(fileName: string): string {
  return fileName.replace(/\.d\.(ts|ets)$/, "").replace(/^@/, "");
}

/**
 * Resolve the owning kit for any declaration file.
 * Top-level files derive it from the filename; nested files are resolved
 * through the re-export map (falling back to a path-derived synthetic kit so
 * the entry still lands in the map for completeness, prefixed with `?` so
 * scanners know it is not directly importable).
 */
function resolveOwnKit(
  filePath: string,
  nsImportKits: Map<string, string>,
  namedReexports: Map<string, string>,
): string {
  if (isTopLevel(filePath)) return "@" + kitFromFile(basename(filePath));
  if (nsImportKits.has(filePath)) return nsImportKits.get(filePath)!;
  // If any named export of this file was re-exported by a top-level kit,
  // attribute the whole file to that kit (best-effort, covers type-only files).
  const prefix = filePath + "\0";
  for (const key of namedReexports.keys()) {
    if (key.startsWith(prefix)) return namedReexports.get(key)!;
  }
  // Unresolved: synthetic, non-importable kit (kept for map completeness).
  return "@?" + basename(filePath).replace(/\.d\.(ts|ets)$/, "");
}

function isNameable(node: Node): boolean {
  return NAMEABLE_KINDS.has(node.getKind());
}

/**
 * Read JSDoc text blocks for a node via the TS-native `compilerNode.jsDoc`
 * array (ts-morph v24 does not expose `getJsdocs` at runtime). Text is sliced
 * from the file content using each JSDoc's pos/end.
 */
function getJsdocTexts(node: Node, content: string): string[] {
  const cn = (node as { compilerNode?: { jsDoc?: { pos: number; end: number }[] } })
    .compilerNode;
  const docs = cn?.jsDoc;
  if (!Array.isArray(docs) || docs.length === 0) return [];
  const out: string[] = [];
  for (const j of docs) {
    if (typeof j.pos === "number" && typeof j.end === "number") {
      out.push(content.slice(j.pos, j.end));
    }
  }
  return out;
}

/**
 * Compute the deprecated symbol identity from AST position.
 * Returns the chain of enclosing namespace/interface/class names plus the
 * node's own name, and whether the node is a namespace-level declaration.
 */
function computeIdentity(
  node: Node,
  ownKit: string,
): { dep: DepSymbol; isNamespaceLevel: boolean } {
  const nameOf = (n: Node): string | undefined => {
    type Named = Node & { getName?: () => string | undefined };
    const fn = (n as Named).getName;
    try {
      return fn?.call(n);
    } catch {
      return undefined;
    }
  };

  const enclosing: string[] = [];
  let p: Node | undefined = node.getParent();
  while (p) {
    if (ENCLOSING_KINDS.has(p.getKind())) {
      const n = nameOf(p);
      if (n) enclosing.unshift(n);
    }
    p = p.getParent();
  }

  const ownName = nameOf(node);
  const isNamespaceLevel = node.getKind() === SyntaxKind.ModuleDeclaration;

  const dep: DepSymbol = { kit: ownKit };
  if (isNamespaceLevel) {
    if (ownName) dep.exportName = ownName;
  } else if (enclosing.length > 0) {
    dep.exportName = enclosing[0];
    dep.members = [...enclosing.slice(1)];
    if (ownName) dep.members.push(ownName);
  } else if (ownName) {
    dep.exportName = ownName;
  }
  return { dep, isNamespaceLevel };
}

/**
 * Build the nested-file -> kit re-export map by scanning top-level kits'
 * import statements. Two shapes are recorded:
 *   - `import * as _X from './dir/file'`  -> whole nested file -> kit
 *   - `import { Name [, Name2] } from './dir/file'` -> each Name -> kit
 * `import type {...}` is also honoured (type-only re-exports still surface the
 * kit for the user's binding resolution).
 */
function buildReexportMap(
  project: Project,
  topLevelFiles: string[],
  fileSet: Set<string>,
  nsImportKits: Map<string, string>,
  namedReexports: Map<string, string>,
): void {
  // Fixpoint worklist: seed with top-level files, then propagate. When a
  // nested file is attributed to a kit (via a namespace or named re-export),
  // process ITS imports too so second-level types (e.g.
  // `@ohos.bundle` -> `bundle/bundleInfo` -> `bundle/hapModuleInfo`) are
  // attributed to the same kit instead of falling through to `@?`.
  const processed = new Set<string>();
  const worklist: string[] = [...topLevelFiles];
  while (worklist.length > 0) {
    const filePath = worklist.shift()!;
    if (processed.has(filePath)) continue;
    processed.add(filePath);
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const sourceFile = getOrCreateSourceFile(project, filePath, content);
    if (!sourceFile) continue;
    const ownKit = isTopLevel(filePath)
      ? "@" + kitFromFile(basename(filePath))
      : resolveOwnKit(filePath, nsImportKits, namedReexports);
    // Don't propagate unresolved (`@?`) synthetic kits.
    if (!ownKit || ownKit.startsWith("@?")) continue;

    for (const imp of sourceFile.getDescendantsOfKind(SyntaxKind.ImportDeclaration)) {
      const spec = normalizeSpecifier(imp);
      if (!spec || (!spec.startsWith("./") && !spec.startsWith("../"))) continue;
      const target = resolveRelative(filePath, spec, fileSet);
      if (!target) continue;
      recordImport(imp, target, ownKit, nsImportKits, namedReexports);
      if (!processed.has(target) && !isTopLevel(target)) worklist.push(target);
    }
    // Re-exports (`export { X } from './y'`, `export * from './y'`) also bind a
    // nested file to this kit — e.g. `@ohos.arkui.modifier` re-exports every
    // `*Modifier` file. Without this those files fall through to `@?`.
    for (const exp of sourceFile.getDescendantsOfKind(SyntaxKind.ExportDeclaration)) {
      const spec = exp.getModuleSpecifierValue?.();
      if (!spec || (!spec.startsWith("./") && !spec.startsWith("../"))) continue;
      const target = resolveRelative(filePath, spec, fileSet);
      if (!target) continue;
      recordExport(exp, target, ownKit, nsImportKits, namedReexports);
      if (!processed.has(target) && !isTopLevel(target)) worklist.push(target);
    }
  }
}

function normalizeSpecifier(imp: ImportDeclaration): string | undefined {
  try {
    return imp.getModuleSpecifierValue();
  } catch {
    return undefined;
  }
}

/** Resolve a relative import specifier to an actual file in the SDK tree. */
function resolveRelative(
  importer: string,
  spec: string,
  fileSet: Set<string>,
): string | undefined {
  const dir = dirname(importer);
  for (const ext of [".d.ts", ".d.ets"]) {
    const cand = resolve(dir, spec + ext);
    if (fileSet.has(cand)) return cand;
  }
  const cand = resolve(dir, spec);
  if (fileSet.has(cand)) return cand;
  return undefined;
}

function recordImport(
  imp: ImportDeclaration,
  targetFile: string,
  kit: string,
  nsImportKits: Map<string, string>,
  namedReexports: Map<string, string>,
): void {
  // Namespace import: `import * as X from './...'` -> whole file belongs to kit.
  const ns = imp.getNamespaceImport?.();
  if (ns) {
    if (!nsImportKits.has(targetFile)) nsImportKits.set(targetFile, kit);
    return;
  }
  // Default import: `import X from './...'` -> file's default export -> kit.
  const def = imp.getDefaultImport?.();
  if (def) {
    namedReexports.set(`${targetFile}\0default`, kit);
  }
  // Named imports: each imported name maps (file, name) -> kit.
  for (const nis of imp.getNamedImports()) {
    const imported = nis.getName(); // the imported (source) name
    namedReexports.set(`${targetFile}\0${imported}`, kit);
  }
}

/**
 * Record a re-export (`export { X } from './y'` / `export * from './y'`) the
 * same way an import would be: it binds the target file's export(s) to this
 * kit. `export { a as b }` attributes the source name `a`.
 */
function recordExport(
  exp: ExportDeclaration,
  targetFile: string,
  kit: string,
  nsImportKits: Map<string, string>,
  namedReexports: Map<string, string>,
): void {
  // `export * from './y'` -> whole file belongs to kit.
  const ns = exp.getNamespaceExport?.();
  if (ns) {
    if (!nsImportKits.has(targetFile)) nsImportKits.set(targetFile, kit);
    return;
  }
  // `export { a, b as c } from './y'` -> each source name maps (file, name).
  // (`a as b`: the target file exports `a`; read it from the compiler node.)
  for (const ex of exp.getNamedExports()) {
    const source = ex.compilerNode.propertyName?.getText() ?? ex.getName();
    namedReexports.set(`${targetFile}\0${source}`, kit);
  }
}
