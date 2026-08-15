# harmony-deprecate

Scan a HarmonyOS / ArkTS project for deprecated `@ohos` SDK APIs and replace them
with their `@useinstead` successors.

This tool parses the SDK `.d.ts` declaration files directly (no DevEco Studio or
`ets_checker` required at runtime for scanning) to build a versioned deprecation
map, then walks your project's `.ts` / `.ets` sources to find deprecated usages
and auto-rewrites the safe import-level ones.

## Install

```bash
# from source
git clone <repo> && cd harmony_tools
npm install
npm run build      # tsc -> dist/

# use locally
node dist/cli.js --help
```

## Prerequisites

The `index`, `scan`, and `rewrite` commands all need the HarmonyOS SDK
declaration files (`.d.ts` under `<sdk>/openharmony/ets/api`) on disk: `index`
builds the map from them, and `scan`/`rewrite` run the TypeScript
LanguageService against them to resolve `@ohos.*` imports. If the SDK cannot be
resolved, `scan`/`rewrite` error out (no regex fallback). The SDK is
discovered from, in priority order:

1. `--sdk <path>` argument
2. `DEVECO_SDK_HOME` environment variable (`.../openharmony/ets/api` is appended)
3. `OHOS_SDK_HOME` environment variable (`.../ets/api` is appended)
4. Standard DevEco Studio install paths (Windows + macOS)

Node.js >= 18.

## Commands

### `index` — build the deprecation map cache

```bash
node dist/cli.js index                       # auto-detect SDK
node dist/cli.js index --sdk "E:\\DevEco Studio\\sdk\\default\\openharmony\\ets\\api"
```

Parses every `@ohos.*` / `@system.*` `.d.ts` / `.d.ets` in the SDK `api/` tree
(recursively, including subdirectory declaration files such as
`bundleManager/ApplicationInfo.d.ts`), extracting declarations annotated with
`@deprecated since N` and their `@useinstead` replacement tokens. `@system.*`
are the legacy (pre-API-9) system kits, also top-level importable modules.
Subdirectory files are not themselves importable kits; their owning kit is
resolved by tracing re-exports from a top-level `@ohos.*` / `@system.*` kit
*transitively to a fixpoint*: `import * as _X from './dir/file'`,
`import { Name } from './dir/file'`, and `export { Name } from './dir/file'`
/ `export * from './dir/file'`. A second-level type (e.g.
`@ohos.bundle` -> `bundle/bundleInfo` -> `bundle/hapModuleInfo`) is attributed
to the top-level kit, not left as an unresolved `@?` synthetic. The result is
cached to:

```
<project>/.harmony-deprecate/deprecation-map.<apiVersion>.json
```

The cache lives under this tool's project root (not the user home dir), so it
travels with the tool. The `apiVersion` is read from the SDK's sibling `oh-uni-package.json`, so caches
are version-pinned and the right one is selected automatically.

### `scan` — report deprecated usages

```bash
node dist/cli.js scan --project ./my_app
node dist/cli.js scan --project ./my_app --since 12   # only deprecations since <= 12
```

Member-level detection runs exclusively via the TypeScript LanguageService
(codes 6385/6387): the compiler flags every call site that resolves to a
`@deprecated` declaration — instance/indirected methods, `.ets` ArkUI files,
and deprecated *signatures* (overloads) — and never matches text inside
comments/strings. The SDK must be on disk so the LS can resolve `@ohos.*`
imports against the declaration files; if it is absent the command errors
out (no regex fallback).

The scan report shows **TS-LS member-level results only**:

- a specific deprecated method/property/enum-member (e.g. `router.pushUrl`)
  → `rename-member` (same-kit rename), `override` (data-driven recipe), or
  `manual` (cross-kit / no replacement).

Import-level rewrites (whole-kit moves / export renames / cross-kit drop-ins)
are **not** shown by `scan` — TS-LS emits no diagnostic on the import
statement, so it has no module-move signal — but `rewrite` still applies them
so the output compiles. A deprecated member whose whole kit moved (e.g.
`reminder.publishReminder` on `@ohos.reminderAgent` → `@ohos.reminderAgentManager`)
is suppressed in the report as redundant with that import rewrite; `rewrite`
re-points the specifier and the call site resolves on the new kit unchanged.

Prints a grouped summary with file:line, old → new symbol, and `since` version.

### `rewrite` — apply safe rewrites

```bash
node dist/cli.js rewrite --project ./my_app           # dry-run, prints +/- diffs
node dist/cli.js rewrite --project ./my_app --write   # write to disk
```

Runs TS-LS for member-level fixes (as `scan` does) **plus** the import-level
regex scanners — kit moves (`rewrite-import`), export renames (`rename-export`),
and cross-kit drop-ins — so rewritten imports stay in sync with every member
splice and the result compiles. The import-level findings are not surfaced by
`scan` but are applied here. `manual` findings are never auto-written — they're
reported for human review. Default is dry-run; pass `--write` to modify files.

## How it works

```
.d.ts ──index──▶ deprecation-map.json ──scan──▶ findings ──rewrite──▶ patched .ets
                                                    ▲
              .ets project ─────────────────────────┘
```

- **Indexer** uses `ts-morph` (TypeScript compiler API) for accurate AST-level
  JSDoc and symbol-identity extraction from the standard `.d.ts` / `.d.ets`
  files, recursively across the `api/` tree. Nested declaration files are
  attributed to their owning top-level kit via re-export tracing.
- **Scanner** (member-level) runs the TypeScript LanguageService (`getSuggestionDiagnostics`,
  codes 6385/6387): the compiler resolves every call site against the SDK
  declarations and flags deprecated symbols/signatures. ArkUI `.ets` is fed to
  the LS as a virtual `.ts` root file — `@Component`/`struct`/`build()` become
  harmless "Cannot find name" semantics that do not block 6385/6387. The SDK
  must be on disk; without it `scan`/`rewrite` error out rather than fall back.
  (Import-level detection — kit moves, export renames, cross-kit drop-ins —
  stays regex/offset based: TS-LS emits nothing on the import statement, so the
  specifier is matched against the indexed `kitIndex`/export tables.)
- **Rewriter** splices the quoted import specifier literal at exact offsets,
  applying edits bottom-up within each file.

## Limitations

- **`.d.ets` is indexed** alongside `.d.ts` (parsed as TS declarations). Note
  that only a handful of ArkUI component `.d.ets` files carry `@deprecated`
  markers today; the bulk of deprecations live in `.d.ts`.
- **Member-level detection is type-checked via the compiler** (TS-LS 6385/6387),
  so false positives on comments/strings and most shadowing are eliminated.
  Computed member access (`router["pushUrl"]`), dynamic-import receivers
  (`const r = await import('@ohos.X'); r.foo()`), and a handful of declaration
  shapes the indexer doesn't attribute still slip through — treat scan output
  as a review report, not an authoritative linter verdict.
- **`scan` reports TS-LS member-level results only.** Import-level rewrites
  (kit moves / export renames / cross-kit drop-ins) are applied by `rewrite`
  but not shown by `scan` — TS-LS has no module-move signal at the import.
- **What is auto-rewritten.** The rewriter applies these rule kinds:
  - `rewrite-import` — replace the quoted import specifier when a kit moved
    (e.g. `@ohos.reminderAgent` -> `@ohos.reminderAgentManager`), or when a
    named-import clause's every binding is an export that moved to another kit
    *under the same name* (cross-kit drop-in, e.g.
    `import { RouterOptions } from '@system.router'` ->
    `from '@ohos.router'`). The per-clause check leaves mixed-target or
    removed-export clauses untouched so nothing breaks.
  - `rename-export` — export renames applied as a *safe alias* that preserves
    the local binding. Same-kit: `import { By }` -> `import { On as By }`
    (e.g. `@ohos.UiTest` `By`->`On`, `UiComponent`->`Component`,
    `@ohos.worker` `EventListener`->`WorkerEventListener`). Cross-kit,
    different name: the export moved to another kit under a new name, so the
    specifier is rewritten AND the binding aliased —
    `import { fstat } from '@ohos.fileio'` ->
    `import { stat as fstat } from '@ohos.file.fs'` — leaving call sites
    (`fstat(...)`) untouched. Per-clause: every binding in the clause must move
    to the same target kit (same- or different-name) or the clause is left
    alone so a mixed clause never breaks.
  - `rename-member` — same-kit (or kit-move-aligned) chain renames where the
    replacement chain has the **same length** as the deprecated one. The
    matched `binding.<old chain>` is spliced to `binding.<new chain>`. This
    covers a leaf-only rename (`Window.create` -> `Window.createWindow`), a
    container/mid-segment rename (`rpc.MessageParcel.create` ->
    `rpc.MessageSequence.create`), or both (`media.MediaErrorCode.MSERR_OK` ->
    `media.AVErrorCode.AVERR_OK`). When the chain length differs the call shape
    changed and the finding stays manual.
  - `override` — the data-driven `@ohos.arkui.UIContext` and `@ohos.window`
    recipes. The UIContext recipe rewrites any deprecated member whose
    `@useinstead` points at a UIContext sub-object — `Router`, `PromptAction`,
    `Font`, `Animator`, `DragController`, `ComponentSnapshot`, `ComponentUtils`,
    `MeasureUtils`, `MediaQuery`, `UIInspector`, ... — to
    `<uiContextExpr>.get<Head>().<member>` (e.g.
    `prompt.showToast` -> `this.getUIContext().getPromptAction().showToast`),
    using the `get<Head>()` accessor pattern. The `@ohos.window` recipe
    rewrites `WindowStage` / `Window` instance-method targets (e.g. FAModel
    `Context.setShowOnLockScreen` -> `WindowStage.setShowOnLockScreen`) to
    `<windowStageExpr>.<member>` / `<windowExpr>.<member>`, using caller-supplied
    `--window-stage-expr` / `--window-expr` (there is no universal accessor — a
    WindowStage comes from the UIAbility lifecycle, a Window from
    `getLastWindow()`).

- **Kit-move alignment (cross-kit members on a moved binding).** When a
  deprecated member's `@useinstead` kit equals the deprecated kit's *indexed
  module move* (`kitMove(dep.kit) === repl.kit`), the member lives on the same
  binding that `rewrite-import` re-points. The scanner then treats it as
  effectively same-kit: if the member chain is unchanged the finding is
  *suppressed* (redundant with the import rewrite — no false-positive manual);
  if the chain changes with the same length it is a `rename-member` on the
  re-pointed binding (e.g. `@ohos.bluetooth` -> `@ohos.bluetoothManager` kit
  move plus `bluetooth.getProfileConnState` ->
  `bluetooth.getProfileConnectionState`).

- **Nested-match overlap dedup.** The SDK often deprecates both a class
  (`rpc.MessageParcel` -> `rpc.MessageSequence`) and its members
  (`rpc.MessageParcel.create` -> `rpc.MessageSequence.create`). Both
  regex-match the same call site; the scanner keeps only the longer (more
  specific) finding per span, and the rewriter drops overlapping edits, so the
  text is spliced once without corruption.

- **Case-insensitive kit resolution.** The SDK occasionally uses a wrong-cased
  kit qualifier in `@useinstead` (e.g. `ohos.uitest.Component` for
  `@ohos.UiTest`). The parser resolves kit prefixes case-insensitively so such
  targets resolve to the real kit and surface as clean `rename-export` aliases
  instead of being misclassified as unresolved manuals.

- **Instance-method scanner (typed receiver).** The binding-only member
  scanner sees `router.pushUrl` (receiver = import) but misses
  `rm.getString()` where `rm` is a *typed local variable*
  (`let rm: resourceManager.ResourceManager`). A second pass resolves
  variable types from imports (`ns.Type` qualified or `T` named-import) via
  regex (works on `.ts` and `.ets` alike, no tsc) and matches deprecated
  instance members on the resolved receiver. An entry is auto-spliced
  (`rename-member`, e.g. `rm.getString` -> `rm.getStringValue`) only when the
  indexer has **verified** the replacement leaf is a sibling member of the same
  enclosing interface/class in the SDK (`instanceSafe`) — otherwise the
  replacement is a namespace function / different receiver and the call site is
  reported manual (naming the `@useinstead` target) rather than silently
  missed. The sibling check covers both a single-segment replacement
  (`getString` -> `getStringValue`) and a type-preserving two-segment
  replacement (`Window.show` -> `Window.showWindow` — the type is restated in
  the replacement chain but only the leaf changes). FA-model -> stageless
  receiver changes (`ctx.setShowOnLockScreen` ->
  `windowStage.setShowOnLockScreen`) are detected this way.

  Other cross-kit replacements whose chain also changes (FA-model -> stageless
  migrations, where both the kit and the call convention move) are still manual
  — they require wiring changes. A replacement chain whose kit prefix could not
  be resolved, or whose leaf is identical to the deprecated symbol (a no-op),
  is also left manual. Receivers reached through a runtime value with no
  explicit type annotation (`const ctx = featureAbility.getContext()`) are
  still missed — a later tsc-based increment would resolve them.

  Note: instance methods reached through an *explicitly-typed* local
  (`let ctx: Context; ctx.setShowOnLockScreen()`) are detected by the
  instance-method scanner above. Receivers reached through a runtime value
  with no type annotation — such as `featureAbility.getContext().setShowOnLockScreen()`
  — are still not detected; resolving those needs a type-aware (tsc) scanner
  upgrade that infers `getContext()`'s return type.

- **Type-aware instance scanner (`.ts`, tsc).** The regex instance scanner only
  resolves *explicitly-typed* receivers (`let v: T`). It misses the common case
  of an *untyped* local whose type comes from a factory call, e.g.
  `const ctx = featureAbility.getContext()` (sync, returns `Context`) or
  `const win = await window.getLastWindow()` (a `Promise<Window>` unwrapped by
  `await`). A second pass runs the TypeScript compiler (ts-morph) over the
  project's `.ts` files — `.ets` is excluded, since ArkUI `struct` / `build()`
  syntax `tsc` cannot parse — type-checking them against the SDK declaration
  files. For each property access it resolves the receiver's type, maps the
  type's declaration file back to its owning kit via the indexer's persisted
  file→kit attribution, then reuses the instance index and the same
  `instanceSafe`/manual classification as the regex pass. This turns previously
  *silent misses* into reported findings (manual for cross-kit FA→stageless and
  Window instance methods; auto `rename-member` for verified `instanceSafe`
  renames like `rm.getString` -> `rm.getStringValue`), and handles `Promise`
  unwrapping on `await` for free. The pass degrades gracefully: if the SDK is
  no longer on disk or the project has no `.ts` files, it returns nothing and
  the regex scanner remains the source of truth.

## Development

```bash
npm run build       # tsc
npm test            # tsc + node:test (unit + integration, no mocks)
```

Tests live under `src/**/*.test.ts` and run against compiled output in `dist/`.
Integration tests use the fixture project under `test/fixtures/mini/`.

## License

MIT
