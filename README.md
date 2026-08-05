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

The `index` command needs the HarmonyOS SDK declaration files (`.d.ts` under
`<sdk>/openharmony/ets/api`). The SDK is discovered from, in priority order:

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

Two passes:

- **Module-level**: an `import` of a whole deprecated kit that moved to a new
  specifier → `rewrite-import` (auto-fixable), or `manual` (deprecated with no
  `@useinstead`).
- **Member-level**: a specific deprecated method/property/enum-member inside a
  non-deprecated kit (e.g. `router.pushUrl`) → `rename-member` (same-kit rename)
  or `manual` (cross-kit / no replacement).

Prints a grouped summary with file:line, old → new symbol, and `since` version.

### `rewrite` — apply safe import rewrites

```bash
node dist/cli.js rewrite --project ./my_app           # dry-run, prints +/- diffs
node dist/cli.js rewrite --project ./my_app --write   # write to disk
```

Only `rewrite-import` findings are auto-applied (old kit specifier → new kit
specifier, leaving bindings and call sites untouched). `manual` findings are
never auto-written — they're reported for human review. Default is dry-run; pass
`--write` to modify files.

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
- **Scanner** is deliberately regex/offset based and tolerant: ArkUI `.ets`
  uses `struct` / `@Component` / `build()` syntax that `tsc` cannot parse, so a
  full AST parse is avoided. Import specifiers and member accesses are matched
  via binding-resolution from imports.
- **Rewriter** splices the quoted import specifier literal at exact offsets,
  applying edits bottom-up within each file.

## Limitations

- **`.d.ets` is indexed** alongside `.d.ts` (parsed as TS declarations). Note
  that only a handful of ArkUI component `.d.ets` files carry `@deprecated`
  markers today; the bulk of deprecations live in `.d.ts`.
- **Member-level detection is heuristic, not type-checked.** Binding resolution
  from imports keeps false positives low, but shadowing can still occur. Treat
  scan output as a review report, not an authoritative linter verdict.
- **What is auto-rewritten.** The rewriter applies these rule kinds:
  - `rewrite-import` — replace the quoted import specifier when a kit moved
    (e.g. `@ohos.reminderAgent` -> `@ohos.reminderAgentManager`), or when a
    named-import clause's every binding is an export that moved to another kit
    *under the same name* (cross-kit drop-in, e.g.
    `import { RouterOptions } from '@system.router'` ->
    `from '@ohos.router'`). The per-clause check leaves mixed-target or
    removed-export clauses untouched so nothing breaks.
  - `rename-member` — same-kit (or kit-move-aligned) chain renames where the
    replacement chain has the **same length** as the deprecated one. The
    matched `binding.<old chain>` is spliced to `binding.<new chain>`. This
    covers a leaf-only rename (`Window.create` -> `Window.createWindow`), a
    container/mid-segment rename (`rpc.MessageParcel.create` ->
    `rpc.MessageSequence.create`), or both (`media.MediaErrorCode.MSERR_OK` ->
    `media.AVErrorCode.AVERR_OK`). When the chain length differs the call shape
    changed and the finding stays manual.
  - `rename-export` — same-kit export/class renames, applied as a *safe alias*
    that preserves the local binding: `import { By }` ->
    `import { On as By }` so every `By.text` / `new By()` reference resolves to
    `On` with no body rewrite (e.g. `@ohos.UiTest` `By`->`On`,
    `UiComponent`->`Component`, `@ohos.worker` `EventListener`->`WorkerEventListener`).
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
  missed. FA-model -> stageless receiver changes (`ctx.setShowOnLockScreen` ->
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
