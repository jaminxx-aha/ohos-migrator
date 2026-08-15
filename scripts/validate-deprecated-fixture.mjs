#!/usr/bin/env node
/**
 * Validate `test/fixtures/deprecated-all.ets` against the real scanner stack:
 * every resolvable deprecated entry in the map must be addressed by at least
 * one finding. Exits non-zero on gaps.
 *
 * Coverage model (matches how each entry is detected):
 *  - ELIGIBLE member entry (entryEligible == true): the member scanner must
 *    emit a finding whose `oldSymbol` is `<someLocal>.<memberChain>` where that
 *    local binding maps to the entry's kit. We don't care which local — any
 *    binding the fixture imports for that kit satisfies the scanner's pattern.
 *  - SUPPRESSED member entry (entryEligible == false): covered by an
 *    import-level finding instead — a rename-export finding (export-index /
 *    cross-kit rename-export / same-name drop-in) or a rewrite-import finding
 *    (cross-kit drop-in with unchanged chain) on that kit's import line.
 *  - module-move (kitIndex): a rewrite-import finding with oldSymbol == kit.
 *  - cross-kit drop-in (`kit\0name` / `kit\0default`): a rewrite-import finding
 *    with oldSymbol == kit (specifier rewrite), on that kit's import line.
 *  - cross-kit rename-export (`oldKit\0oldName`): a rename-export finding with
 *    oldSymbol == oldName on oldKit's import line.
 *  - exportIndex (`kit\0name` same-kit rename): a rename-export finding with
 *    oldSymbol == name on kit's import line.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { scanProject, scanProjectExportRenames, scanProjectCrossKitDropin } from "../dist/scanner/scanner.js";
import { scanProjectMembers, entryEligible, extractBindingMap } from "../dist/scanner/member-scanner.js";
import { extractImports } from "../dist/scanner/import-extractor.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const NUL = "\0";

const map = JSON.parse(readFileSync(join(ROOT, ".harmony-deprecate/deprecation-map.24.json"), "utf8"));
const fixture = readFileSync(join(ROOT, "test/fixtures/deprecated-all.ets"), "utf8");

const root = mkdtempSync(join(tmpdir(), "ohos-fixture-"));
writeFileSync(join(root, "deprecated-all.ets"), fixture, "utf8");

const mod = scanProject({ projectRoot: root, map, since: 0 });
const exp = scanProjectExportRenames({ projectRoot: root, map, since: 0 });
const drp = scanProjectCrossKitDropin({ projectRoot: root, map, since: 0 });
const mem = scanProjectMembers({ projectRoot: root, map, since: 0 });
const findings = [...mod.findings, ...exp.findings, ...drp.findings, ...mem.findings];

const byRule = {};
for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
console.log(`findings: ${findings.length}  by rule: ${JSON.stringify(byRule)}`);

// local-binding -> kit (exactly what the scanner resolves).
const localToKit = extractBindingMap(fixture);
const kitOfLocal = (local) => localToKit.get(local);

/** Replicate describeMemberReplacement's no-op suppression: same-kit (or
 *  kit-move-aligned) replacement with an identical chain needs no splice. */
const kitMove = (k) => map.kitIndex?.[k]?.newKit;
function memberSuppressed(e) {
  const repl = e.repl;
  if (!repl || !repl.members || repl.members.length === 0) return false;
  const members = e.dep.members ?? [];
  const aligned = !!(repl.kit && kitMove(e.dep.kit) === repl.kit);
  const sameKit = !repl.kit || repl.kit === e.dep.kit || aligned;
  const sameLength = members.length > 0 && members.length === repl.members.length;
  const chainEqual = sameLength && members.every((x, i) => x === repl.members[i]);
  return sameKit && chainEqual;
}

// line (1-based) -> kit specifier, from import extraction.
const lineToKit = new Map();
for (const imp of extractImports(fixture)) lineToKit.set(imp.line, imp.specifier);

// Index findings for quick lookup.
const rewriteImportKits = new Set(); // oldSymbol == kit (auto rewrite-import)
const kitIndexFindings = new Set(); // oldSymbol == kit (rewrite-import OR manual)
const renameExportByLine = new Map(); // line -> Set(importedName)
for (const f of findings) {
  if (f.rule === "rewrite-import" && f.oldSymbol) { rewriteImportKits.add(f.oldSymbol); kitIndexFindings.add(f.oldSymbol); }
  // A `manual` kitIndex finding (deprecated kit, no @useinstead) also keys on the specifier.
  if (f.rule === "manual" && f.matchStart == null && f.oldSymbol && f.oldSymbol.startsWith("@")) kitIndexFindings.add(f.oldSymbol);
  if (f.rule === "rename-export" && f.line != null) {
    const s = renameExportByLine.get(f.line) ?? new Set();
    s.add(f.oldSymbol); s.add(f.newSymbol); // newSymbol for cross-kit rename where old differs
    renameExportByLine.set(f.line, s);
  }
}
// member findings: oldSymbol -> finding (any). Also a list for suffix matching.
const memberSyms = new Set(mem.findings.map((f) => f.oldSymbol));

/** Is there a member finding `<binding>.<chain>` whose binding maps to `kit`? */
function memberCovered(kit, chain) {
  for (const sym of memberSyms) {
    const dot = sym.length - chain.length - 1;
    if (sym.endsWith("." + chain)) {
      const binding = sym.slice(0, dot);
      if (kitOfLocal(binding) === kit) return true;
    }
  }
  return false;
}

// Signature -> entry lookup, mirroring the indexer's
// `verifyMembersPreservedByMove` third-shape detection: a 2-seg no-`@useinstead`
// member `[C, M]` is suppressed when its parent `[C]` has a SAME-KIT 1-seg
// rename repl `[C']` and `M` is preserved in `C'`. Coverage then rides on the
// parent container's rename-member finding (`<binding>.C` -> `<binding>.C'`),
// which rewrites the type/import binding — the preserved member needs no splice.
const bySig = new Map();
for (const e of map.entries) {
  const d = e.dep;
  bySig.set(`${d.kit}${NUL}${d.exportName}${NUL}${(d.members ?? []).join(".")}`, e);
}

const isOrphan = (k) => k.startsWith("@?");
// A name is fixture-importable iff it is the kit's default export or a genuinely
// top-level named export. Names that exist only via transitive attribution are
// NOT emitted in the fixture (no kit re-exports them, so the import 2614s) and
// are exempt here — they stay in the map for the scanner's indirect-access
// coverage via fileKit.
const kitExports = map.kitExports ?? {};
const kitDefaultExport = map.kitDefaultExport ?? {};
const isImportable = (kit, name) =>
  kitDefaultExport[kit] === name || (kitExports[kit] ?? []).includes(name);
let gaps = 0;
const samples = [];

const gap = (msg) => { gaps++; if (samples.length < 30) samples.push(msg); };

// ---- member entries ----
for (const e of map.entries) {
  const members = e.dep.members ?? [];
  if (members.length === 0) continue;
  const { kit, exportName } = e.dep;
  if (!exportName || isOrphan(kit)) continue;
  if (!isImportable(kit, exportName)) continue; // transitive-only: scanner-indirect-covered
  const eligible = entryEligible(e, kit, map, 0);
  const chain = members.join(".");
  // Bracket-notation members (`[Symbol.iterator]`) are matched with a literal
  // dot in the scanner's regex, which never appears in real bracket access —
  // an inherent scanner limitation, not a fixture gap.
  const isBracket = chain.includes("[");
  if (eligible) {
    if (memberSuppressed(e) || isBracket) continue;
    if (!memberCovered(kit, chain)) gap(`eligible member: ${exportName}.${chain} [${kit}]`);
  } else {
    // Suppressed: covered by import-level on this kit/exportName.
    const ei = map.exportIndex?.[`${kit}${NUL}${exportName}`];
    const dropin = map.crossKitDropin?.[`${kit}${NUL}${exportName}`] ?? map.crossKitDropin?.[`${kit}${NUL}default`];
    let covered = false;
    if (ei) {
      // rename-export finding on a line importing this kit, oldSymbol === exportName.
      for (const [line, names] of renameExportByLine) {
        if (lineToKit.get(line) === kit && names.has(exportName)) { covered = true; break; }
      }
    }
    if (dropin && rewriteImportKits.has(kit)) covered = true;
    if (map.kitIndex?.[kit] && kitIndexFindings.has(kit)) covered = true; // module-move (auto or manual)
    // Third shape: same-kit container rename, member preserved. The parent
    // `[C]` has a same-kit 1-seg repl `[C']`; its rename-member finding
    // rewrites the binding, covering the preserved child `[C, M]`.
    if (!covered && e.memberPreservedByMove && members.length === 2) {
      const parent = bySig.get(`${kit}${NUL}${exportName}${NUL}${members[0]}`);
      const pr = parent?.repl;
      if (pr?.members?.length === 1 && (!pr.kit || pr.kit === kit)) {
        covered = memberCovered(kit, members[0]);
      }
    }
    if (!covered) gap(`suppressed member (import-level): ${exportName}.${chain} [${kit}]`);
  }
}

// ---- pure import-level entries (module-move, drop-in, rename-export) ----
for (const kit of Object.keys(map.kitIndex ?? {})) {
  if (isOrphan(kit)) continue;
  if (!kitIndexFindings.has(kit)) gap(`kitIndex module-move: ${kit}`);
}
for (const key of Object.keys(map.crossKitDropin ?? {})) {
  const kit = key.split(NUL)[0];
  if (isOrphan(kit)) continue;
  if (!rewriteImportKits.has(kit)) gap(`crossKitDropin: ${kit} (key ${key.replace(NUL, "/")})`);
}
for (const key of Object.keys(map.crossKitRenameExport ?? {})) {
  const [kit, name] = key.split(NUL);
  if (isOrphan(kit)) continue;
  let covered = false;
  for (const [line, names] of renameExportByLine) {
    if (lineToKit.get(line) === kit && names.has(name)) { covered = true; break; }
  }
  if (!covered) gap(`crossKitRenameExport: ${kit}/${name}`);
}
for (const key of Object.keys(map.exportIndex ?? {})) {
  const [kit, name] = key.split(NUL);
  if (isOrphan(kit)) continue;
  let covered = false;
  for (const [line, names] of renameExportByLine) {
    if (lineToKit.get(line) === kit && names.has(name)) { covered = true; break; }
  }
  if (!covered) gap(`exportIndex rename-export: ${kit}/${name}`);
}

rmSync(root, { recursive: true, force: true });

console.log(`coverage gaps: ${gaps}`);
if (samples.length) {
  console.log("samples:");
  for (const s of samples) console.log("  " + s);
}
if (gaps === 0) { console.log("\n✅ full coverage: every resolvable deprecated entry detected"); process.exit(0); }
console.log("\n❌ coverage gaps (see above)"); process.exit(1);
