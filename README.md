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

Parses every `@ohos.*.d.ts` / `.d.ets` in the SDK `api/` tree (recursively,
including subdirectory declaration files such as `bundleManager/ApplicationInfo.d.ts`),
extracting declarations annotated with `@deprecated since N` and their
`@useinstead` replacement tokens. Subdirectory files are not themselves
importable kits; their owning kit is resolved by tracing the re-export from a
top-level `@ohos.*` kit (`import * as _X from './dir/file'` or
`import { Name } from './dir/file'`). The result is cached to:

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
    (e.g. `@ohos.reminderAgent` -> `@ohos.reminderAgentManager`).
  - `rename-member` — same-kit member renames (e.g.
    `Window.create` -> `Window.createWindow`, or a multi-segment leaf rename
    `AtManager.verifyAccessToken` -> `AtManager.checkAccessToken`).
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
  if only the leaf changes it is a `rename-member` on the re-pointed binding
  (e.g. `@ohos.bluetooth` -> `@ohos.bluetoothManager` kit move plus
  `bluetooth.getProfileConnState` -> `bluetooth.getProfileConnectionState`).

- **Case-insensitive kit resolution.** The SDK occasionally uses a wrong-cased
  kit qualifier in `@useinstead` (e.g. `ohos.uitest.Component` for
  `@ohos.UiTest`). The parser resolves kit prefixes case-insensitively so such
  targets resolve to the real kit and surface as clean `rename-export` aliases
  instead of being misclassified as unresolved manuals.

  Other cross-kit replacements whose chain also changes (FA-model -> stageless
  migrations, where both the kit and the call convention move) are still manual
  — they require wiring changes. A replacement chain whose kit prefix could not
  be resolved, or whose leaf is identical to the deprecated symbol (a no-op),
  is also left manual.

  Note: the member scanner resolves deprecated members only through
  *imported bindings* (e.g. `router.pushUrl` where `router` is an import).
  Instance methods reached through a runtime value — such as
  `featureAbility.getContext().setShowOnLockScreen()` — are not detected
  because the receiver is a local, not an import. The window recipe is
  correct and unit-tested, but firing it on real FAModel code needs a
  type-aware scanner upgrade (resolving `getContext()`'s return type).

## Development

```bash
npm run build       # tsc
npm test            # tsc + node:test (unit + integration, no mocks)
```

Tests live under `src/**/*.test.ts` and run against compiled output in `dist/`.
Integration tests use the fixture project under `test/fixtures/mini/`.

## License

MIT
