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

Parses every `@ohos.*.d.ts` in the SDK `api/` directory, extracting declarations
annotated with `@deprecated since N` and their `@useinstead` replacement tokens.
The result is cached to:

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
  JSDoc and symbol-identity extraction from the standard `.d.ts` files.
- **Scanner** is deliberately regex/offset based and tolerant: ArkUI `.ets`
  uses `struct` / `@Component` / `build()` syntax that `tsc` cannot parse, so a
  full AST parse is avoided. Import specifiers and member accesses are matched
  via binding-resolution from imports.
- **Rewriter** splices the quoted import specifier literal at exact offsets,
  applying edits bottom-up within each file.

## Limitations

- **`.d.ets` is not indexed** (phase 1 covers `@ohos.*.d.ts` only). ArkUI
  component-related API deprecations in `.d.ets` are not detected.
- **Member-level detection is heuristic, not type-checked.** Binding resolution
  from imports keeps false positives low, but shadowing can still occur. Treat
  scan output as a review report, not an authoritative linter verdict.
- **Only import specifiers are auto-rewritten.** Same-kit member renames
  (`rename-member`) are reported but not yet auto-applied; cross-kit
  replacements are always manual (they require wiring changes).

## Development

```bash
npm run build       # tsc
npm test            # tsc + node:test (unit + integration, no mocks)
```

Tests live under `src/**/*.test.ts` and run against compiled output in `dist/`.
Integration tests use the fixture project under `test/fixtures/mini/`.

## License

MIT
