/**
 * Indexer: parse SDK `.d.ts` declarations into a deprecation map.
 *
 * For every declaration carrying a `@deprecated since N` JSDoc we compute:
 *   - identity: kit (from filename) + enclosing namespace/interface/class chain
 *   - replacement: parsed `@useinstead` token (or null when absent)
 *   - kind: `module-move` when a `declare namespace` itself is deprecated and
 *     its `@useinstead` points to a different kit; `member` otherwise.
 *
 * Phase-1 scope: index `@ohos.*.d.ts` only (skip `@internal/**`, `*.d.ets`).
 */

import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind, type Node } from "ts-morph";
import { listFiles } from "../walk.js";
import { parseUseinstead, toReplSymbol } from "./useinstead-parser.js";
import type {
  DeprecationEntry,
  DeprecationMap,
  DepSymbol,
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
    throw new Error(`No @ohos.*.d.ts files under ${sdkApiDir}`);
  }

  // Build the known-kit set (ohos.x.y, no leading @) for useinstead parsing.
  const knownKits = new Set<string>();
  for (const f of files) knownKits.add(kitFromFile(basename(f)));

  const entries: DeprecationEntry[] = [];
  const kitIndex: Record<string, KitDepInfo> = {};

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    let sourceFile;
    try {
      sourceFile = project.createSourceFile(filePath, content);
    } catch {
      // Skip files that fail to parse (e.g. exotic syntax) rather than abort.
      continue;
    }
    const ownKit = "@" + kitFromFile(basename(filePath));

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
        ? toReplSymbol(parseUseinstead(useToken, knownKits, ownKit))
        : null;

      const newKit = repl?.kit;
      const isModuleMove =
        isNamespaceLevel && !!newKit && newKit !== ownKit;

      if (isModuleMove) {
        mergeKit(kitIndex, ownKit, since, { newKit: newKit! });
      } else if (isNamespaceLevel) {
        // Namespace deprecated but no cross-kit replacement -> manual.
        mergeKit(kitIndex, ownKit, since, { manual: true });
      }

      const sourceLine = node.getStartLineNumber() ?? 0;
      entries.push({
        dep,
        since,
        repl,
        kind: isModuleMove ? "module-move" : "member",
        source: { file: filePath, line: sourceLine },
      });
    });
  }

  return {
    apiVersion,
    sdkPath: sdkApiDir,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    entries,
    kitIndex,
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

/** Collect `@ohos.*.d.ts` files (skip @internal and .d.ets in phase 1). */
function collectDeclFiles(sdkApiDir: string): string[] {
  return listFiles(sdkApiDir, (name) => {
    return name.startsWith("@ohos.") && name.endsWith(".d.ts");
  });
}

/** `@ohos.ability.dataUriUtils.d.ts` -> `ohos.ability.dataUriUtils`. */
function kitFromFile(fileName: string): string {
  return fileName.replace(/\.d\.ts$/, "").replace(/^@/, "");
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
