/**
 * "Obviously-correct" edit subset filter for the `rewrite` command.
 *
 * The full scanner+rewriter pipeline can apply many edit kinds (kit import
 * swap, rename-member, UIContext override expressions, inject-import, cross-kit
 * member dropin, rename-export). Most are mechanical text splices that are NOT
 * guaranteed to compile. To honor "only change what is provably correct, leave
 * the rest untouched" (the rest goes to `--use-ai`), the CLI gate keeps ONLY the
 * edits that are correct by construction:
 *
 *   A. **Same-kit member rename** — `binding.old` → `binding.new` on the SAME
 *      binding, where the deprecated kit is NOT module-moved (so the binding is
 *      not about to be re-pointed), the chains are equal-length, and the new
 *      leaf is a real export of the same kit (`kitExports`). A pure text swap
 *      on one binding; if a signature/arity edge case slips through, hvigor
 *      catches it and the gate reverts.
 *   B. **Whole-kit import swap** — `import X from '@ohos.old'` → `'@ohos.new'`
 *      where `kitIndex[old].newKit === new` (a real module move), the import is
 *      default/namespace (single binding), and EVERY member accessed on that
 *      binding in the file is a real export of the new kit. Then the swap can't
 *      break any usage.
 *
 * Everything else (override, inject-import, cross-kit member dropin,
 * rename-export, reverse-dropin, manual, cross-kit dropin, aligned renames
 * whose kit moved) is dropped here and left for `--use-ai`.
 *
 * The filter works on flattened `Finding`s but re-reads each file to recover
 * the binding→kit map and the binding's usage — the scanner already knew this,
 * but the flattened finding doesn't carry it, and re-deriving keeps the
 * scanners and `rewriter.ts` untouched.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractBindingMap } from "../scanner/member-scanner.js";
import { extractImports } from "../scanner/import-extractor.js";
import type { Finding, DeprecationMap } from "../rules/types.js";

export function filterObviousSubset(
  findings: Finding[],
  projectRoot: string,
  map: DeprecationMap,
): Finding[] {
  const kitExports = map.kitExports ?? {};
  const kitIndex = map.kitIndex;

  // Group by file so each file is read once.
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }

  const kept: Finding[] = [];
  for (const [relFile, fileFindings] of byFile) {
    const abs = join(projectRoot, ...relFile.split("/"));
    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      // Can't read -> can't verify -> drop everything in this file.
      continue;
    }
    const bindingMap = extractBindingMap(content);
    const imports = extractImports(content);

    for (const f of fileFindings) {
      if (isSameKitRename(f, bindingMap, kitExports, kitIndex)) {
        kept.push(f);
        continue;
      }
      if (isWholeKitSwap(f, imports, content, kitExports, kitIndex)) {
        kept.push(f);
        continue;
      }
      // dropped — left for --use-ai
    }
  }
  return kept;
}

/** A. Same-kit member rename, correct by construction. */
function isSameKitRename(
  f: Finding,
  bindingMap: Map<string, string>,
  kitExports: Record<string, string[]>,
  kitIndex: DeprecationMap["kitIndex"],
): boolean {
  if (f.rule !== "rename-member") return false;
  if (f.needsManual) return false; // reverse-dropin / manual — leave for use-ai
  if (f.replacement == null || f.matchStart == null) return false;
  const bOld = f.oldSymbol.split(".")[0];
  const bNew = f.replacement.split(".")[0];
  if (!bOld || bOld !== bNew) return false; // a rebind to a different binding (cross-kit dropin) — not "same binding"
  const kit = bindingMap.get(bOld);
  if (!kit) return false; // binding's kit unknown — can't verify
  if (kitIndex[kit]?.newKit) return false; // kit moved → this is an aligned rename that depends on the import swap; not standalone-correct
  const newChain = f.replacement.slice(bNew.length + 1);
  const firstSeg = newChain.split(".")[0];
  if (!firstSeg) return false;
  if (!(kitExports[kit] ?? []).includes(firstSeg)) return false; // new leaf not a real export of the same kit
  return true;
}

/** B. Whole-kit import swap where every used member exists in the new kit. */
function isWholeKitSwap(
  f: Finding,
  imports: ReturnType<typeof extractImports>,
  content: string,
  kitExports: Record<string, string[]>,
  kitIndex: DeprecationMap["kitIndex"],
): boolean {
  if (f.rule !== "rewrite-import") return false;
  if (!f.newSymbol) return false;
  if (kitIndex[f.oldSymbol]?.newKit !== f.newSymbol) return false; // not a kitIndex module move (excludes cross-kit dropin)
  const imp = imports.find((i) => i.line === f.line && i.specifier === f.oldSymbol);
  if (!imp) return false;
  // Only default / namespace imports (single binding used as `binding.x`).
  // Named-import clauses (`import {A,B}`) are left for use-ai — their per-binding
  // resolution after a wholesale specifier swap is more involved.
  if (imp.bindings.length !== 1) return false;
  const b = imp.bindings[0];
  if (b.imported !== "default" && b.imported !== "*") return false;
  const binding = b.local;
  const exports = kitExports[f.newSymbol] ?? [];
  if (exports.length === 0) return false; // can't verify the new kit's exports — don't claim correctness
  const used = accessedMembers(content, binding);
  // No member usage (e.g. default import used only as a constructor / type) —
  // the swap is vacuously safe.
  if (used.size === 0) return true;
  for (const ident of used) {
    if (!exports.includes(ident)) return false; // a used member is missing in the new kit -> swap would break it
  }
  return true;
}

/** All `binding.<ident>` accesses in the file (value-position member reads). */
function accessedMembers(content: string, binding: string): Set<string> {
  const out = new Set<string>();
  if (!binding) return out;
  const re = new RegExp(`\\b${escapeRe(binding)}\\.([A-Za-z_$][\\w$]*)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.add(m[1]);
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
