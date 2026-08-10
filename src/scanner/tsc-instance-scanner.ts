/**
 * Type-aware instance-method scanner (increment 2).
 *
 * The regex instance scanner (`scanProjectInstanceMembers`) only resolves
 * *explicitly-typed* receivers (`let v: T`. ...`). It misses the common case of
 * an *untyped* local whose type comes from a factory call, e.g.
 *
 *   import featureAbility from '@ohos.ability.featureAbility';
 *   import window from '@ohos.window';
 *   const ctx = featureAbility.getContext();   // ctx: Context (untyped)
 *   const win = await window.getLastWindow();  // win: Window (Promise unwrapped)
 *   ctx.setShowOnLockScreen(true);              // deprecated -> WindowStage.setShowOnLockScreen
 *   win.setWakeUpScreen(true);                  // deprecated -> Window.setWakeUpScreen
 *
 * Resolving these needs real type information, so this pass uses the TypeScript
 * compiler (ts-morph) to type-check the project's `.ts` files against the SDK
 * declaration files. It is scoped to `.ts` only: ArkUI `.ets` uses
 * `struct` / `@Component` / `build()` syntax `tsc` cannot parse, so `.ets`
 * keeps falling back to the regex pass.
 *
 * Kit attribution is free: a resolved type's symbol is declared inside some
 * `declare module '@ohos.X'` block in the SDK; ts-morph walks to that enclosing
 * module declaration and reads its name. No persisted file→kit map is needed.
 *
 * The pass degrades gracefully: if the SDK is no longer on disk (e.g. the map
 * cache was copied without the SDK) or no `.ts` files exist, it returns nothing
 * and the regex scanner remains the source of truth.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, sep } from "node:path";
import { Project, SyntaxKind, type PropertyAccessExpression, type SourceFile, type TypeChecker } from "ts-morph";
import { walkFiles } from "../walk.js";
import {
  buildInstanceIndex,
  dedupeOverlappingSpans,
  instanceFinding,
  type ContainerDropinResolver,
  type KitMoveResolver,
  type MemberScanOptions,
} from "./member-scanner.js";
import type { Finding } from "../rules/types.js";

export interface TscInstanceScanResult {
  findings: Finding[];
  filesScanned: number;
  /** True when the pass actually ran (SDK present + .ts files found). */
  ran: boolean;
}

/**
 * Scan `.ts` files for deprecated instance methods reached through a typed
 * (explicitly or inferred) receiver. Mirrors the regex instance scanner's
 * classification (`instanceSafe` -> rename-member; else manual) but resolves
 * the receiver's type via the TypeScript compiler instead of a type annotation.
 */
export function scanProjectInstanceMembersTsc(opts: MemberScanOptions): TscInstanceScanResult {
  const { projectRoot, map } = opts;
  const since = opts.since ?? 0;
  const sdkApiDir = map.sdkPath;
  const empty: TscInstanceScanResult = { findings: [], filesScanned: 0, ran: false };
  if (!sdkApiDir || !existsDir(sdkApiDir)) return empty;

  const tsFiles = walkFiles(projectRoot, { extensions: [".ts"] });
  if (tsFiles.length === 0) return empty;

  const instanceIndex = buildInstanceIndex(map);
  if (instanceIndex.size === 0) return empty;
  const kitMove: KitMoveResolver = (k) => map.kitIndex[k]?.newKit;
  const dropinMap = map.crossKitDropin ?? {};
  const containerDropin: ContainerDropinResolver = (k, n) =>
    dropinMap[`${k}\0${n}`] ?? dropinMap[`${k}\0default`];

  // Load the SDK ambient-module declarations + the project's .ts sources. The
  // SDK `.d.ts` are self-contained `declare module '@ohos.X'` blocks; loading
  // them makes `import X from '@ohos.X'` in user code resolve. `.d.ets` are
  // skipped (declaration-only, not needed for type resolution here).
  const project = new Project({
    // `@ohos.*` / `@system.*` are not ambient `declare module` blocks in the
    // real SDK — they're module *files* (`@ohos.X.d.ts` exporting a namespace).
    // Path mapping with baseUrl = the SDK api dir makes `import x from
    // '@ohos.X'` resolve to `@ohos.X.d.ts`, the same resolution a HarmonyOS
    // project's tsconfig performs. esModuleInterop lets user code default-
    // import a module that only has named exports (common in HarmonyOS apps).
    compilerOptions: {
      allowJs: false,
      skipLibCheck: true,
      strict: false,
      esModuleInterop: true,
      baseUrl: sdkApiDir,
      paths: {
        "@ohos.*": ["./@ohos.*.d.ts"],
        "@system.*": ["./@system.*.d.ts"],
      },
    },
  });
  const sdkAdded = addSdkDecls(project, sdkApiDir);
  if (!sdkAdded) return empty;

  const userFiles: { abs: string; sf: SourceFile }[] = [];
  for (const abs of tsFiles) {
    try {
      userFiles.push({ abs, sf: project.addSourceFileAtPath(abs) });
    } catch {
      continue;
    }
  }
  if (userFiles.length === 0) return { findings: [], filesScanned: 0, ran: true };

  const checker = project.getTypeChecker();
  const findings: Finding[] = [];
  const dedupe = new Map<string, Finding>();

  for (const { abs, sf } of userFiles) {
    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const fileRel = relative(projectRoot, abs).split(sep).join("/");

    for (const node of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const hit = resolveReceiver(node, checker, map, sdkApiDir);
      if (!hit) continue;
      const { kit, typeHead } = hit;
      const entries = instanceIndex.get(`${kit}\0${typeHead}`);
      if (!entries || entries.length === 0) continue;
      const leaf = node.getName();
      const receiverText = node.getExpression().getText();
      // Match only entries whose single-segment access chain equals this leaf.
      for (const { accessChain, entry: e } of entries) {
        if (accessChain.length !== 1 || accessChain[0] !== leaf) continue;
        if (since && e.since > since) continue;
        const start = node.getStart();
        const end = node.getEnd();
        const f = instanceFinding(
          fileRel, start, end, content, receiverText, accessChain, e, kitMove,
          containerDropin,
        );
        if (!f) continue; // suppressed (no-op)
        const key = `${f.file}:${f.line}:${f.oldSymbol}`;
        const prev = dedupe.get(key);
        if (!prev || (prev.needsManual && !f.needsManual)) dedupe.set(key, f);
      }
    }
  }

  const deduped = dedupeOverlappingSpans([...dedupe.values()]);
  return { findings: deduped, filesScanned: userFiles.length, ran: true };
}

/**
 * Resolve the (kit, typeHead) of a property-access receiver's type.
 *
 * Kit attribution mirrors the indexer: prefer the persisted file→kit map (a
 * resolved type's declaration file → owning kit, the same attribution the dep
 * entries use). Fall back to an enclosing `declare module '@ohos.X'` block —
 * this is how synthetic test fixtures declare ambient modules without a
 * file→kit map. Returns undefined for built-in / anonymous / unresolved types
 * (no false positive).
 */
function resolveReceiver(
  node: PropertyAccessExpression,
  checker: TypeChecker,
  map: MemberScanOptions["map"],
  sdkApiDir: string,
): { kit: string; typeHead: string } | undefined {
  const expr = node.getExpression();
  const type = checker.getTypeAtLocation(expr);
  const sym = type.getSymbol() ?? type.getAliasSymbol();
  if (!sym) return undefined;
  const typeHead = sym.getName();
  if (!typeHead || isReservedName(typeHead)) return undefined;
  const fileKit = map.fileKit;
  for (const decl of sym.getDeclarations()) {
    // Primary path: declaration file -> kit via the indexer's file→kit map.
    if (fileKit) {
      const sf = decl.getSourceFile();
      if (sf) {
        const rel = relative(sdkApiDir, sf.getFilePath()).split(sep).join("/");
        const kit = fileKit[rel];
        if (kit && !kit.startsWith("@?")) return { kit, typeHead };
      }
    }
    // Fallback: an enclosing `declare module '@ohos.X'` (ambient fixtures).
    const mod = decl.getFirstAncestorByKind(SyntaxKind.ModuleDeclaration);
    if (mod) {
      const name = mod.getName();
      if (name) {
        const kit = stripQuotes(name);
        if (kit.startsWith("@ohos.") || kit.startsWith("@system.")) {
          return { kit, typeHead };
        }
      }
    }
  }
  return undefined;
}

/** Add the SDK `.d.ts` declaration files to the project. Returns false if none. */
function addSdkDecls(project: Project, sdkApiDir: string): boolean {
  let added = 0;
  const files = walkFiles(sdkApiDir, { extensions: [".d.ts"] });
  for (const f of files) {
    try {
      project.addSourceFileAtPath(f);
      added++;
    } catch {
      // skip unreadable / duplicate
    }
  }
  return added > 0;
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
  return name === "" || name === "Array" || name === "Promise" ||
    name === "Object" || name === "Function" || name === "undefined" ||
    name === "string" || name === "number" || name === "boolean";
}
