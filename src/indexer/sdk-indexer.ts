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

import { basename, dirname, relative, resolve, sep } from "node:path";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind, type Node, type SourceFile, type ImportDeclaration, type ExportDeclaration } from "ts-morph";
import { walkFiles } from "../walk.js";
import { parseUseinstead, toReplSymbol } from "./useinstead-parser.js";
import type {
  DeprecationEntry,
  DeprecationMap,
  DepSymbol,
  ExportIndex,
  CrossKitDropin,
  CrossKitRenameExport,
  ReplSymbol,
  KitDepInfo,
} from "../rules/types.js";

const DEPRECATED_RE = /@deprecated\s+since\s+(\d+)/;
const USEINSTEAD_RE = /@useinstead\s+(\S+)/;
/** A clean JS identifier — used to reject @useinstead parse artifacts. */
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

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

  // Per-kit top-level export-name set, used to verify cross-kit equal-length
  // member moves: the replacement's first segment (the leaf for a 1-seg move,
  // the container for a 2-seg path-preserving move) must be a top-level export
  // of repl.kit for the scanner to safely inject `import * as <b> from
  // '<repl.kit>'` and rebind the receiver. Built in a first pass so repl.kit
  // (possibly a different file) is available regardless of iteration order.
  const kitTopLevelExports = new Map<string, Set<string>>();
  // Parallel map: a kit's parsed SourceFile, so post-loop verifiers can
  // descend into a kit's container declarations (e.g. check that a moved
  // member is still declared in the new kit's `Flags` enum / `Stat` interface).
  const kitSourceFiles = new Map<string, SourceFile>();
  for (const f of topLevelFiles) {
    let content: string;
    try {
      content = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const sf = getOrCreateSourceFile(project, f, content);
    if (!sf) continue;
    const set = collectKitTopLevelExports(sf);
    const kitKey = "@" + kitFromFile(basename(f));
    if (set.size > 0) kitTopLevelExports.set(kitKey, set);
    kitSourceFiles.set(kitKey, sf);
  }

  const entries: DeprecationEntry[] = [];
  const kitIndex: Record<string, KitDepInfo> = {};
  const exportIndex: ExportIndex = {};
  const crossKitDropin: CrossKitDropin = {};
  const crossKitRenameExport: CrossKitRenameExport = {};
  const fileKit: Record<string, string> = {};

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
    fileKit[toRelPath(filePath, sdkApiDir)] = ownKit;

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
      const rawRepl = useToken
        ? toReplSymbol(parseUseinstead(useToken, knownKits, ownKit, kitLookup))
        : null;
      const repl = normalizeRedundantNamespacePrefix(dep, rawRepl);

      // Only top-level kits can drive import-level module moves; nested files
      // never produce kitIndex entries (they are re-exported, not imported).
      // NB: `isNamespaceLevel` is also true for a *nested* namespace declaration
      // inside a kit file (e.g. `namespace BLE` inside `@ohos.bluetoothManager`),
      // so we additionally require the namespace to be the file's outermost (kit-
      // level) one — no enclosing ModuleDeclaration — otherwise a deprecated
      // sub-namespace's `@useinstead` would wrongly register a kit-level move
      // for the whole kit (it once falsely moved `@ohos.bluetoothManager` to
      // `@ohos.bluetooth.ble`).
      const newKit = repl?.kit;
      const isKitLevelNamespace =
        isNamespaceLevel && !node.getFirstAncestorByKind(SyntaxKind.ModuleDeclaration);
      const isModuleMove =
        isTopLevel(filePath) && isKitLevelNamespace && !!newKit && newKit !== ownKit;

      if (isTopLevel(filePath)) {
        if (isModuleMove) {
          mergeKit(kitIndex, ownKit, since, { newKit: newKit! });
        } else if (isKitLevelNamespace) {
          // Kit namespace deprecated but no cross-kit replacement -> manual.
          mergeKit(kitIndex, ownKit, since, { manual: true });
        }
      }

      const sourceLine = node.getStartLineNumber() ?? 0;
      const instanceSafe = verifyInstanceSafe(node, dep, repl, ownKit, kitIndex);
      const isCrossKitMemberDropin = verifyCrossKitMemberDropin(
        dep, repl, ownKit, kitIndex, kitTopLevelExports,
      );
      entries.push({
        dep,
        since,
        repl,
        kind: isModuleMove ? "module-move" : "member",
        source: { file: filePath, line: sourceLine },
        ...(instanceSafe ? { instanceSafe: true } : {}),
        ...(isCrossKitMemberDropin ? { crossKitMemberDropin: true } : {}),
      });

      // Same-kit export-name rename (e.g. @ohos.UiTest `By` -> `On`): a
      // memberless declaration whose @useinstead resolves to a single new
      // name within the same kit. These drive the rename-export scanner rule.
      // The replacement name comes from either a member-chain repl
      // (`@useinstead ohos.x/Y`) or a whole-export repl
      // (`@useinstead ohos.x.x/Y` -> repl.exportName, no members).
      //
      // The declaration need NOT live in the kit's top-level file: many kits
      // split their public API across re-exported nested `.d.ts` files (e.g.
      // `@ohos.arkui.modifier` re-exports `NavigatorModifier` from
      // `arkui/NavigatorModifier.d.ts`; `@ohos.ability.featureAbility` re-exports
      // `ElementName`/`CustomizeData`/`ModuleInfo` from `bundle/*.d.ts`). Since
      // `resolveOwnKit` only attributes a nested file to a kit when the kit
      // re-exports from it, `ownKit` is a real importable kit (never the `@?`
      // orphan sentinel) for exactly the re-exported declarations we want.
      // Gate on `!ownKit.startsWith("@?")` (not `isTopLevel(filePath)`) so these
      // nested-file exports get the same export-rename / cross-kit drop-in /
      // cross-kit rename-export treatment as top-file exports, while genuine
      // orphans (no re-exporter) stay out. Namespace-level declarations
      // (`declare namespace X` inside a kit namespace, e.g. `BLE` inside
      // `@ohos.bluetoothManager`) are still excluded by `!isNamespaceLevel`.
      if (!ownKit.startsWith("@?") && !isNamespaceLevel && !dep.members?.length && dep.exportName && repl) {
        const newName = repl.members?.length === 1
          ? repl.members[0]
          : repl.exportName;
        if (!newName) {
          // no-op below
        } else {
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
          // Default-export move (e.g. `export default class Want` ->
          // @ohos.app.ability.Want): a default import `import Want from '...'
          // only needs its specifier rewritten (the local binding is the
          // default export regardless of its class name), so key it under the
          // sentinel "default" rather than the class name.
          if (repl.kit && repl.kit !== ownKit && hasDefaultModifier(node) && !kitIndex[ownKit]?.newKit) {
            crossKitDropin[`${ownKit}\0default`] = repl.kit;
          }
          // Cross-kit different-name move (e.g. @ohos.fileio.fstat ->
          // @ohos.file.fs.stat): the export moved to another kit under a new
          // name. A named-import clause rewrites its specifier AND aliases each
          // such binding (`stat as fstat`) when every binding moves to the same
          // target kit. Same skip for module-level moves.
          if (repl.kit && repl.kit !== ownKit && newName !== dep.exportName && !kitIndex[ownKit]?.newKit) {
            crossKitRenameExport[`${ownKit}\0${dep.exportName}`] = `${repl.kit}\0${newName}`;
          }
        }
      }
    });
  }

  // Resolve cross-kit member drop-in ambiguity. A deprecated symbol that maps
  // to MORE than one replacement kit is ambiguous at the call site: the binding
  // scanner matches the symbol only (e.g. `bluetoothManager.on`) and cannot
  // read the event-name string arg that picks the target, so auto-rebinding
  // would pick an arbitrary target and corrupt the call. The classic case is
  // `@ohos.bluetoothManager.on` whose @useinstead splits by event into
  // `@ohos.bluetooth.connection.on` / `.access.on` / `.socket.on`. Unflag every
  // ambiguous entry (manual) — only symbols with a UNIQUE replacement kit stay
  // drop-in. (Path-preserving 2-seg moves like `bluetoothManager.A2dpSource
  // Profile.on` -> `bluetooth.a2dp.A2dpSourceProfile.on` are unaffected: the
  // profile member determines the target, so all entries for that symbol agree.)
  resolveCrossKitMemberAmbiguity(entries);

  // Resolve cross-kit member drop-in vs. export-level same-name drop-in
  // conflict. A 1-seg member move whose LEAF is itself a top-level export
  // with a same-name cross-kit drop-in (e.g. `@ohos.fileio`'s module-level
  // `read` -> `@ohos.file.fs.read`) is the authoritative replacement for the
  // symbol `fileio.read`: the export-level rule re-points `import {read}` to
  // the new kit under the SAME name. A member entry for the same symbol that
  // rebinds to a DIFFERENT leaf (e.g. `Dir.read` -> `file.fs.listFile`, a
  // semantic redirect) would, for namespace usage `fileio.read(...)`, splice
  // the wrong leaf (`listFile`) and corrupt the call. Such 1-seg entries are
  // semantic redirects, not drop-ins — unflag them so they fall back to
  // manual. Only applies to 1-seg moves where the leaf collides with a
  // same-name export drop-in AND the replacement leaf differs; 2-seg
  // path-preserving moves (container as members[0]) are untouched — the
  // member rebind's container/leaf are both unchanged, consistent with the
  // export drop-in.
  resolveCrossKitMemberExportConflict(entries, crossKitDropin);

  // Flag NO-`@useinstead` members that are nonetheless covered by an
  // enclosing kit relocation (`kitIndex[dep.kit].newKit`) or a cross-kit
  // same-name export drop-in (`crossKitDropin`), PROVIDED the member chain is
  // verified to still exist in the new kit/container. The import-specifier
  // rewrite (or named-import drop-in) already re-points the binding to where
  // the member lives, so the member finding is redundant. Members that were
  // removed (not preserved) are left unflagged -> manual: the re-pointed binding
  // would reference a kit that no longer declares them. This distinguishes, in
  // the same relocated kit, preserved members (suppress) from removed ones
  // (manual) — e.g. `wantConstant.Flags.FLAG_AUTH_READ_URI_PERMISSION` is
  // preserved in the new `Flags` enum (suppress), while
  // `wantConstant.Action.ACTION_HOME` is not (`Action` was dropped — manual).
  verifyMembersPreservedByMove(
    entries, kitIndex, crossKitDropin, kitTopLevelExports, kitSourceFiles,
  );

  return {
    apiVersion,
    sdkPath: sdkApiDir,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    entries,
    kitIndex,
    exportIndex,
    crossKitDropin,
    crossKitRenameExport,
    fileKit,
  };
}

/** SDK api-tree path (forward slashes, relative to sdkApiDir). */
function toRelPath(filePath: string, sdkApiDir: string): string {
  return relative(sdkApiDir, filePath).split(sep).join("/");
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

/** True when the node is a default export (`export default ...`). */
function hasDefaultModifier(node: Node): boolean {
  type WithModifiers = Node & { getModifiers?: () => { getKind: () => SyntaxKind }[] };
  try {
    const mods = (node as WithModifiers).getModifiers?.() ?? [];
    return mods.some((m) => m.getKind() === SyntaxKind.DefaultKeyword);
  } catch {
    return false;
  }
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
 * Verify an instance-method single-leaf rename is safe to splice on a typed
 * receiver: the replacement leaf must be declared as a (sibling) member of
 * the same enclosing interface/class. Without this, splicing `var.<leaf>` ->
 * `var.<repl leaf>` could write a namespace-function name onto an instance
 * and break (e.g. `i18n.I18NUtil.getUnicodeWrappedFilePath` -> the namespace
 * function `getUnicodeWrappedFilePath`, which is NOT an instance member).
 *
 * Conservative: only same-kit (or kit-move-aligned) single-leaf renames on a
 * directly-enclosing named type whose name matches dep.members[0].
 */
/**
 * Verify an instance-method leaf rename is safe to splice on a typed receiver:
 * the replacement leaf must be declared as a (sibling) member of the same
 * enclosing interface/class. Without this, splicing `var.<leaf>` ->
 * `var.<repl leaf>` could write a namespace-function name onto an instance
 * and break (e.g. `i18n.I18NUtil.getUnicodeWrappedFilePath` -> the namespace
 * function `getUnicodeWrappedFilePath`, which is NOT an instance member).
 *
 * Two shapes are verified (the type the method lives on is preserved — only
 * the leaf changes):
 *   - single-leaf:  `repl = [newLeaf]`                  (e.g. getString->getStringValue)
 *   - type+leaf:    `repl = [Type, newLeaf]`, Type===dep.members[0]
 *                   (e.g. Window.show -> Window.showWindow)
 *   - asymmetric:   dep = `[leaf]` (1-seg, the container/class is `dep.exportName`),
 *                   `repl = [Type, newLeaf]`, Type===dep.exportName
 *                   (e.g. Router.getLength -> Router.getStackSize, where the
 *                   `Router` export holds both the deprecated `getLength` and the
 *                   new `getStackSize` as sibling members)
 *
 * Conservative: only same-kit (or kit-move-aligned) renames on a directly-
 * enclosing named type whose name matches the receiver type (`typeHead`:
 * `dep.members[0]` for the symmetric shapes, `dep.exportName` for the
 * asymmetric shape). Multi-seg repls that change the type, deeper chains, and
 * cross-kit targets are left unverified (the scanner reports them manual
 * rather than risk a bad splice).
 */
/**
 * Strip a redundant kit-namespace prefix from a 2-segment replacement.
 *
 * Some `@useinstead` targets are authored as `ohos.<kit>.<namespace>#<member>`
 * (JSDoc `Class#member` notation), e.g. `ohos.pasteboard.pasteboard#createData`
 * or `ohos.router.router#pushUrl`. The parser resolves the kit
 * (`@ohos.pasteboard` / `@ohos.router`) and keeps the `#`-stripped remainder as
 * `repl.members = [<namespace>, <member>]`. But when `<namespace>` is the kit's
 * OWN namespace name (== `repl.kit`'s last segment) and the deprecated symbol
 * is also namespace-level (`dep.exportName === <namespace>`, `dep.members`
 * 1-seg — a namespace function, not a class method), that leading segment is
 * NOT a member: it is the binding itself (implied by the import). Keeping it
 * makes the repl a 2-seg chain, so the same-kit leaf rename lands in the
 * chain-length-mismatch bucket instead of the same-kit rename-member path.
 *
 * Stripping `members[0]` yields a 1-seg repl the binding scanner's same-kit
 * same-length branch handles (e.g. `pasteboard.createHtmlData` ->
 * `pasteboard.createData`, `router.push` -> `router.pushUrl`). This is purely a
 * shape normalization — the same trust level as same-kit leaf renames already
 * auto-fixed; no new assumption is made about call shapes (the @useinstead
 * asserts the replacement, as it does for every other auto path).
 *
 * NOT applied when `members[0]` is a genuine class/interface name (it differs
 * from the kit's last segment), e.g. `ohos.arkui.UIContext.Router#getStackSize`
 * (kit UIContext, members[0]=Router != UIContext) — that is an instance-method
 * rename handled by `verifyInstanceSafe` (the asymmetric branch), left 2-seg.
 */
function normalizeRedundantNamespacePrefix(
  dep: DepSymbol,
  repl: ReplSymbol | null,
): ReplSymbol | null {
  if (!repl || !repl.members || repl.members.length !== 2 || !repl.kit) return repl;
  const kitLast = repl.kit.split(".").pop();
  if (!kitLast || repl.members[0] !== kitLast) return repl;
  // Only namespace-level symbols (dep.exportName is the namespace, 1-seg leaf):
  // a 2-seg dep means members[0] is a real nested class, not the kit namespace.
  if (!dep.exportName || dep.exportName !== repl.members[0]) return repl;
  if (dep.members?.length !== 1) return repl;
  return { ...repl, members: [repl.members[1]] };
}

function verifyInstanceSafe(
  node: Node,
  dep: DepSymbol,
  repl: ReplSymbol | null,
  ownKit: string,
  kitIndex: Record<string, KitDepInfo>,
): boolean {
  if (!repl || !repl.members || repl.members.length === 0) return false;
  if (!dep.members || dep.members.length === 0 || !dep.exportName) return false;
  // The receiver type: for a symmetric 2-seg dep `[Type, leaf]` it is
  // `dep.members[0]`; for an asymmetric 1-seg dep `[leaf]` the container/class
  // lives in `dep.exportName` (e.g. `Router.getLength` where `Router` is the
  // export and `getLength` the leaf, repl `[Router, getStackSize]`).
  const typeHead = dep.members.length >= 2 ? dep.members[0] : dep.exportName;
  // Resolve the replacement leaf: either a single-segment repl, or a
  // two-segment repl whose first segment restates the (unchanged) type.
  let newLeaf: string;
  if (repl.members.length === 1) {
    newLeaf = repl.members[0];
  } else if (repl.members.length === 2 && repl.members[0] === typeHead) {
    newLeaf = repl.members[1];
  } else {
    return false;
  }
  const oldLeaf = dep.members[dep.members.length - 1];
  if (newLeaf === oldLeaf) return false; // no-op
  const sameKit = !repl.kit || repl.kit === ownKit;
  const aligned = !!(repl.kit && kitIndex[ownKit]?.newKit === repl.kit);
  if (!sameKit && !aligned) return false;
  // Nearest enclosing interface/class; its name must match the receiver type
  // (`typeHead` — dep.members[0] for symmetric, dep.exportName for asymmetric).
  const typeAncestor =
    node.getFirstAncestorByKind(SyntaxKind.InterfaceDeclaration) ??
    node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  if (!typeAncestor) return false;
  type Named = Node & { getName?: () => string | undefined };
  if (typeAncestor.getName?.() !== typeHead) return false;
  const members = (typeAncestor as unknown as { getMembers?: () => Named[] }).getMembers?.() ?? [];
  for (const m of members) {
    if (m.getName?.() === newLeaf) return true;
  }
  return false;
}

/**
 * Collect the names of declarations directly inside a kit file's outermost
 * `declare namespace`/`declare module` body — the kit's top-level exports,
 * i.e. the symbols reachable as `binding.<name>` after
 * `import * as binding from '<kit>'`. Used to verify cross-kit equal-length
 * member moves: the replacement's first segment (leaf or container) must
 * exist as a top-level export of `repl.kit` before the scanner injects a new
 * import and rebinds.
 *
 * Two correctness concerns, both arising from how SDK `.d.ts` files are
 * authored:
 *   1. Some kits declare top-level functions/constants OUTSIDE any namespace,
 *      as module-level `declare function`/`declare const` siblings of a
 *      `declare namespace` (e.g. `@ohos.file.fs` has `declare namespace fileIo`
 *      for its OO API and module-level `declare function moveFile` for the
 *      procedural API). Those siblings are top-level exports too
 *      (`import * as fs` exposes `fs.moveFile`), but the previous code only
 *      descended into the first namespace body and missed them entirely — so
 *      the cross-kit verification of `system.file.move -> file.fs.moveFile`
 *      wrongly failed and the safe rename stayed manual.
 *   2. A kit's namespace may be declared across SEVERAL
 *      `declare namespace X { ... }` blocks in one file (declaration merging).
 *      Iterating only the first block would miss every name in the later
 *      blocks. (Handled defensively even though the current SDK's kit files
 *      each use a single block.)
 *
 * Therefore we iterate EVERY top-level statement: each `ModuleDeclaration`
 * contributes the names in its body (first nesting level only — members of
 * nested classes/namespaces are NOT kit top-level exports), and every other
 * named statement (module-level `declare function`, `declare const`,
 * `interface`, `class`, `enum`) contributes its own name. The kit namespace's
 * own name is intentionally NOT added — `import * as b` exposes the namespace
 * contents as `b.<member>`, not as `b.<namespaceName>`.
 */
function collectKitTopLevelExports(sourceFile: Node): Set<string> {
  const names = new Set<string>();
  type Named = Node & { getName?: () => string | undefined };
  const tryName = (child: Node): void => {
    try {
      const name = (child as Named).getName?.();
      if (name) names.add(name);
      // VariableStatement carries the name on its first VariableDeclaration.
      if (child.getKind() === SyntaxKind.VariableStatement) {
        const decls = (child as unknown as {
          getDeclarationList?: () => { getDeclarations?: () => Named[] };
        }).getDeclarationList?.();
        const first = decls?.getDeclarations?.()[0];
        const vn = first?.getName?.();
        if (vn) names.add(vn);
      }
    } catch {
      // ignore non-nameable / unreadable nodes
    }
  };
  const collectBody = (md: Node): void => {
    const body = md.getFirstChildByKind(SyntaxKind.ModuleBlock);
    const stmts = (body as unknown as { getStatements?: () => Node[] } | undefined)?.getStatements?.();
    if (stmts) for (const s of stmts) tryName(s);
    else for (const c of md.getChildren()) tryName(c);
  };
  // `getStatements()` yields the file's top-level declarations (a .d.ts kit
  // file may hold several `declare namespace X {}` blocks via declaration
  // merging PLUS module-level `declare function`/`const` siblings). Descend
  // into every namespace block's body; name everything else in place.
  const topStmts =
    (sourceFile as unknown as { getStatements?: () => Node[] }).getStatements?.() ??
    sourceFile.getChildren();
  for (const child of topStmts) {
    if (child.getKind() === SyntaxKind.ModuleDeclaration) {
      collectBody(child); // a kit namespace may span several blocks
    } else {
      tryName(child); // module-level declare function/const/class/enum
    }
  }
  return names;
}

/**
 * Verify a cross-kit equal-length member move is safe to auto-replace by
 * injecting a new import and rebinding the receiver: the replacement chain
 * must be the same length as the deprecated chain (call shape preserved) and
 * its FIRST segment must be a top-level export of `repl.kit` (a different,
 * real, non-aligned kit). For a 1-seg move that first segment is the leaf
 * (e.g. `startBackgroundRunning`); for a 2-seg path-preserving move it is the
 * container (e.g. `A2dpSourceProfile` in `bluetoothManager.A2dpSourceProfile.connect`
 * -> `bluetooth.a2dp.A2dpSourceProfile.connect`). The remaining segments are
 * trusted from @useinstead at the same trust level as the shipped 1-seg leaf.
 * Without verification, the entry stays manual so the scanner never splices an
 * unverified (possibly non-existent) target. Unequal-length moves are rejected
 * (call-shape change: instance<->static, container flatten/extend).
 */
function verifyCrossKitMemberDropin(
  dep: DepSymbol,
  repl: ReplSymbol | null,
  ownKit: string,
  kitIndex: Record<string, KitDepInfo>,
  kitTopLevelExports: Map<string, Set<string>>,
): boolean {
  if (!repl || !repl.members || repl.members.length === 0) return false;
  if (!dep.members || dep.members.length !== repl.members.length) return false;
  if (!repl.kit || repl.kit === ownKit) return false;
  // A target that lines up with the deprecated kit's indexed module move is
  // already covered by rewrite-import (the binding is re-pointed) — leave it.
  if (kitIndex[ownKit]?.newKit === repl.kit) return false;
  // Every repl segment must be a clean JS identifier. The first is verified
  // against the kit's top-level exports below; the rest are trusted from
  // @useinstead and must not carry parse artifacts (e.g. `on`'s @useinstead
  // `ble.on.event:BLEDeviceFind` leaks a `name:value` event hint into the
  // chain — splicing `ble.on.event:BLEDeviceFind` would emit invalid code).
  if (!repl.members.every((m) => IDENT_RE.test(m))) return false;
  const set = kitTopLevelExports.get(repl.kit);
  if (!set) return false;
  return set.has(repl.members[0]);
}

/**
 * Collect the names of the DIRECT members of a top-level container declaration
 * named `containerName` in a kit source file. The container may be an enum
 * (enum members), an interface/class (property + method signatures), or a
 * namespace (its body's direct declaration names). Declaration merging may
 * spread a namespace across several blocks, so members are unioned across all
 * declarations with a matching name. Used by `verifyMembersPreservedByMove`
 * to confirm a deprecated member still exists in the new kit/container after a
 * wholesale kit relocation or a container drop-in.
 */
function collectContainerMembers(sf: SourceFile, containerName: string): Set<string> {
  const names = new Set<string>();
  type Named = Node & { getName?: () => string | undefined };
  const add = (n: Named | undefined | null): void => {
    const nm = n?.getName?.();
    if (nm) names.add(nm);
  };
  // Search declarations of any container kind, anywhere in the file, named
  // `containerName` (kits rarely reuse a name at different depths, so a broad
  // descendant scan is precise enough and tolerates declaration merging).
  const candidates =
    (sf as unknown as { getDescendantsOfKind?: (k: SyntaxKind) => Node[] }).getDescendantsOfKind?.(
      SyntaxKind.EnumDeclaration,
    ) ?? [];
  const ifaces =
    (sf as unknown as { getDescendantsOfKind?: (k: SyntaxKind) => Node[] }).getDescendantsOfKind?.(
      SyntaxKind.InterfaceDeclaration,
    ) ?? [];
  const classes =
    (sf as unknown as { getDescendantsOfKind?: (k: SyntaxKind) => Node[] }).getDescendantsOfKind?.(
      SyntaxKind.ClassDeclaration,
    ) ?? [];
  const modules =
    (sf as unknown as { getDescendantsOfKind?: (k: SyntaxKind) => Node[] }).getDescendantsOfKind?.(
      SyntaxKind.ModuleDeclaration,
    ) ?? [];
  for (const d of [...candidates, ...ifaces, ...classes, ...modules]) {
    if ((d as Named).getName?.() !== containerName) continue;
    collectMembersOfContainer(d, names, add);
  }
  return names;
}

function collectMembersOfContainer(
  d: Node,
  names: Set<string>,
  add: (n: (Node & { getName?: () => string | undefined }) | undefined | null) => void,
): void {
  type Named = Node & { getName?: () => string | undefined };
  switch (d.getKind()) {
    case SyntaxKind.EnumDeclaration: {
      const ms =
        (d as unknown as { getMembers?: () => Named[] }).getMembers?.() ?? [];
      for (const m of ms) add(m);
      break;
    }
    case SyntaxKind.InterfaceDeclaration:
    case SyntaxKind.ClassDeclaration: {
      const props =
        (d as unknown as { getProperties?: () => Named[] }).getProperties?.() ?? [];
      for (const p of props) add(p);
      const methods =
        (d as unknown as { getMethods?: () => Named[] }).getMethods?.() ?? [];
      for (const m of methods) add(m);
      break;
    }
    case SyntaxKind.ModuleDeclaration: {
      const body = d.getFirstChildByKind(SyntaxKind.ModuleBlock);
      const stmts =
        (body as unknown as { getStatements?: () => Named[] } | undefined)?.getStatements?.();
      if (stmts) for (const s of stmts) add(s);
      break;
    }
  }
}

/**
 * Does `member` resolve as a direct child of `containerName` in `kit`? When
 * `containerName` is undefined, `member` must be a top-level export of the kit
 * (a direct member of the kit namespace). Used to verify a deprecated member
 * chain still exists in the new kit after a kit/container move.
 */
function memberResolvesInKit(
  kit: string,
  containerName: string | undefined,
  member: string,
  kitTopLevelExports: Map<string, Set<string>>,
  kitSourceFiles: Map<string, SourceFile>,
): boolean {
  const top = kitTopLevelExports.get(kit);
  if (!top) return false;
  if (!containerName) return top.has(member);
  if (!top.has(containerName)) return false;
  const sf = kitSourceFiles.get(kit);
  if (!sf) return false;
  return collectContainerMembers(sf, containerName).has(member);
}

/**
 * Set `memberPreservedByMove` on every NO-`@useinstead` member entry whose
 * enclosing kit was relocated wholesale (`kitIndex[dep.kit].newKit`) OR whose
 * enclosing export moved as a cross-kit same-name drop-in, PROVIDED the member
 * chain is verified to still exist in the new kit/container. Run after the full
 * index loop so `kitIndex` and `crossKitDropin` are complete (they are populated
 * per-kit during the loop, so they are not reliably available at entry-push
 * time). Mirrors the post-loop fixups `resolveCrossKitMemberAmbiguity` /
 * `resolveCrossKitMemberExportConflict`.
 *
 * Two move shapes, each verified against the new kit's declarations:
 *   - kit move:   the whole kit relocated to `newKit`. The member chain is
 *                 relative to the kit namespace, so a 1-seg member is a
 *                 top-level export of `newKit`; a 2-seg member's first segment
 *                 is a top-level container and the leaf is its direct member.
 *   - drop-in:    the export `dep.exportName` moved cross-kit to `newKit`.
 *                 The container is `dep.exportName`; the leaf is the (single)
 *                 member. The container must be a top-level export of `newKit`
 *                 and the leaf its direct member.
 *
 * Members NOT preserved (genuinely removed in the new kit) are left unflagged
 * so the scanners still report them as manual — the re-pointed binding would
 * reference a kit that no longer declares them, so a human fix is still needed.
 * Deeper-than-2-seg kit-move chains and 2+-seg drop-in chains are left
 * unflagged (rare; the 1- and 2-seg shapes cover the SDK's actual cases).
 */
function verifyMembersPreservedByMove(
  entries: DeprecationEntry[],
  kitIndex: Record<string, KitDepInfo>,
  crossKitDropin: CrossKitDropin,
  kitTopLevelExports: Map<string, Set<string>>,
  kitSourceFiles: Map<string, SourceFile>,
): void {
  for (const e of entries) {
    // Only NO-`@useinstead` members (no resolved repl chain) are candidates.
    if (e.repl && e.repl.members && e.repl.members.length > 0) continue;
    const d = e.dep;
    if (!d.members || d.members.length === 0) continue;
    const ownKit = d.kit;
    let newKit: string | undefined;
    let container: string | undefined;
    let member: string | undefined;
    const kitNew = kitIndex[ownKit]?.newKit;
    if (kitNew) {
      // Kit relocated wholesale: member chain is relative to the kit namespace.
      newKit = kitNew;
      if (d.members.length === 1) {
        container = undefined;
        member = d.members[0];
      } else if (d.members.length === 2) {
        container = d.members[0];
        member = d.members[1];
      } else {
        continue; // deeper chains: leave for a future round
      }
    } else {
      // Else look for a cross-kit same-name drop-in of the enclosing export.
      const dropin = crossKitDropin[`${ownKit}\0${d.exportName}`] ??
        crossKitDropin[`${ownKit}\0default`];
      if (!dropin) continue;
      if (d.members.length === 1) {
        newKit = dropin;
        container = d.exportName;
        member = d.members[0];
      } else {
        continue; // 2+-seg drop-in: leave for a future round
      }
    }
    if (!newKit || !member) continue;
    if (memberResolvesInKit(newKit, container, member, kitTopLevelExports, kitSourceFiles)) {
      e.memberPreservedByMove = true;
    }
  }
}

/**
 * Resolve cross-kit member drop-in AMBIGUITY across all flagged entries. A
 * deprecated symbol (`dep.kit` + `dep.members`) whose @useinstead tokens split
 * it across MORE than one replacement kit is ambiguous at the call site: the
 * scanner matches the symbol (`bluetoothManager.on`) but cannot read the
 * event-name string arg that selects the target, so auto-rebinding would pick
 * an arbitrary target and corrupt the call. The classic case is
 * `@ohos.bluetoothManager.on`, whose per-event @useinstead tokens resolve to
 * `@ohos.bluetooth.connection.on` / `.access.on` / `.socket.on`. Unflag every
 * ambiguous entry so it falls back to manual; only symbols mapping to a UNIQUE
 * replacement kit remain drop-in. Path-preserving 2-seg moves (e.g.
 * `bluetoothManager.A2dpSourceProfile.on` -> `bluetooth.a2dp.A2dpSourceProfile.on`)
 * are unaffected: the profile member determines the target, so all entries for
 * that symbol agree on one kit.
 */
function resolveCrossKitMemberAmbiguity(entries: DeprecationEntry[]): void {
  // Build key -> set of target kits, considering only currently-flagged entries.
  const targetsByKey = new Map<string, Set<string>>();
  for (const e of entries) {
    if (!e.crossKitMemberDropin) continue;
    const depMembers = e.dep.members;
    if (!depMembers?.length || !e.repl?.kit) continue;
    const key = `${e.dep.kit}\0${depMembers.join(".")}`;
    let set = targetsByKey.get(key);
    if (!set) {
      set = new Set<string>();
      targetsByKey.set(key, set);
    }
    set.add(e.repl.kit);
  }
  // Unflag any entry whose key maps to more than one target kit.
  for (const e of entries) {
    if (!e.crossKitMemberDropin) continue;
    const depMembers = e.dep.members;
    if (!depMembers?.length || !e.repl?.kit) continue;
    const key = `${e.dep.kit}\0${depMembers.join(".")}`;
    const targets = targetsByKey.get(key);
    if (targets && targets.size > 1) {
      delete e.crossKitMemberDropin;
    }
  }
}

/**
 * Unflag 1-seg cross-kit member drop-ins whose leaf collides with a SAME-NAME
 * export-level drop-in AND whose replacement leaf differs. Such entries are
 * semantic redirects (the SDK's `@useinstead` points to a functionally
 * different replacement), not drop-ins: the export-level rule already claims
 * the symbol under its original name (e.g. `@ohos.fileio`'s module-level
 * `read` -> `@ohos.file.fs.read`), so a member entry rebinding `fileio.read`
 * to a different leaf (`Dir.read` -> `file.fs.listFile`) would, for namespace
 * usage `fileio.read(...)`, splice the wrong leaf and corrupt the call.
 *
 * Conditions (all required):
 *   - exactly 1-seg move (`dep.members.length === 1`);
 *   - the leaf has a same-name export drop-in: `crossKitDropin[dep.kit\0leaf]`;
 *   - the member replacement targets that SAME drop-in kit; AND
 *   - the replacement leaf differs from the deprecated leaf.
 * 2-seg path-preserving moves are skipped (members[0] is the container, and
 * the rebind's container+leaf are unchanged — consistent with the drop-in).
 */
function resolveCrossKitMemberExportConflict(
  entries: DeprecationEntry[],
  crossKitDropin: CrossKitDropin,
): void {
  for (const e of entries) {
    if (!e.crossKitMemberDropin) continue;
    const depMembers = e.dep.members;
    if (!depMembers || depMembers.length !== 1) continue;
    const leaf = depMembers[0];
    const dropin = crossKitDropin[`${e.dep.kit}\0${leaf}`];
    if (!dropin) continue;
    const repl = e.repl;
    if (!repl?.kit || !repl.members?.length) continue;
    if (repl.kit === dropin && repl.members[0] !== leaf) {
      delete e.crossKitMemberDropin;
    }
  }
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
