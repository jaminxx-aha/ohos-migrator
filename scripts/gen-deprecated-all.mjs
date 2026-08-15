#!/usr/bin/env node
/**
 * Generate a single `.ets` fixture that references every *resolvable* deprecated
 * symbol in the cached deprecation map, so the migrator's scanner/rewriter
 * pipeline can be exercised against the full real-SDK surface in one shot.
 *
 * How each scanner detects an entry (the fixture mirrors this):
 *  - rewrite-import (kitIndex module-move): the import specifier itself is the
 *    trigger → emit `import <local> from '<oldKit>'` (default/namespace form).
 *  - rename-export / cross-kit same-name drop-in / cross-kit rename-export:
 *    import-clause driven → emit `import { <exportName> [as <local>] } from '<kit>'`.
 *  - default-export move (crossKitDropin `kit\0default`): `import <local> from '<kit>'`.
 *  - member entries (members length >= 1): the regex scanner matches
 *    `<localBinding>.<memberChain>` for any local binding mapped to the entry's
 *    kit (the entry's `exportName` is *not* part of the matched pattern) → emit
 *    one body reference `<local>.<memberChain>;` per entry.
 *
 * Import form (named vs default) is derived from the map: module-move entries
 * carry the kit's default binding name → default import; kits whose default
 * export moved (crossKitDropin `kit\0default`) → default import; everything
 * else → named import.
 *
 * Name collisions: several kits export the same name (e.g. `Context`, `Want`).
 * A single file cannot bind one local name to two kits, so colliding names are
 * aliased: `import { Context as Context__featureAbility } from '...'`. The
 * member scanner keys on `local→kit` and the export-rename scanner reads the
 * pre-`as` `imported` name, so aliasing preserves detection on both paths.
 *
 * Orphans: entries on synthetic `@?` kits have no importable specifier and are
 * skipped (they are undetectable by design); a trailing comment tallies them.
 *
 * Run:   node scripts/gen-deprecated-all.mjs [apiVersion] > out.ets
 *        (default apiVersion = 24)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const NUL = "\0";

const apiVersion = process.argv[2] ?? "24";
const mapPath = join(ROOT, ".harmony-deprecate", `deprecation-map.${apiVersion}.json`);
/** @type {any} */
const map = JSON.parse(readFileSync(mapPath, "utf8"));

const entries = map.entries ?? [];
const kitIndex = map.kitIndex ?? {};
const exportIndex = map.exportIndex ?? {};
const crossKitDropin = map.crossKitDropin ?? {};
const crossKitRenameExport = map.crossKitRenameExport ?? {};

// module-move (kit-level) default binding per kit, e.g. "@ohos.ability.dataUriUtils" -> "dataUriUtils".
const mmDefaultBinding = {};
for (const e of entries) if (e.kind === "module-move") mmDefaultBinding[e.dep.kit] = e.dep.exportName;

const isOrphan = (kit) => kit.startsWith("@?");

/** Tail segment of a kit specifier, used as a fallback default-import binding. */
function kitTail(kit) {
  const seg = kit.replace(/^@/, "").split(".").pop();
  return seg || "ns";
}
/** Sanitize a kit into an identifier-safe suffix. */
function kitTag(kit) {
  return kit.replace(/^@/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// -------------------------------------------------------------- collect items
// Each item is a distinct (kit, form, exportName) the fixture must import.
// form ∈ {"named","default"}. default items with no exportName use a kit-tail.
const items = []; // {kit, form, exportName?}
const itemKey = (it) => `${it.kit}\0${it.form}\0${it.exportName ?? ""}`;
const seenItem = new Set();
const addItem = (it) => {
  const k = itemKey(it);
  if (seenItem.has(k)) return;
  seenItem.add(k);
  items.push(it);
};

// (1) entries: member + module-move + length-0 export-level.
let orphanCount = 0;
const kitHasEntryDefault = new Set(); // kits whose default export has an entry (Want), vs kits whose default export has no entry (cipher)
for (const e of entries) {
  const { kit, exportName } = e.dep;
  if (!exportName) continue;
  if (isOrphan(kit)) { orphanCount++; continue; }
  // An entry's export is the kit's DEFAULT export only when the kit has a
  // `kit\0default` move AND that same export has a same-name drop-in
  // (`kit\0export`). Otherwise the entry is a named export (e.g. cipher's
  // `CipherResponse`, which moved via crossKitRenameExport, not as default).
  const hasDefMove = crossKitDropin[`${kit}${NUL}default`] !== undefined;
  const isDefExport = hasDefMove && crossKitDropin[`${kit}${NUL}${exportName}`] !== undefined;
  let form;
  if (mmDefaultBinding[kit] === exportName || isDefExport) {
    form = "default";
    kitHasEntryDefault.add(kit);
  } else {
    form = "named";
  }
  addItem({ kit, form, exportName });
}

// (2) cross-kit same-name drop-in named keys not already covered by entries.
for (const key of Object.keys(crossKitDropin)) {
  if (key.endsWith(NUL + "default")) continue;
  const [kit, name] = key.split(NUL);
  if (isOrphan(kit) || mmDefaultBinding[kit] === name) continue;
  addItem({ kit, form: "named", exportName: name });
}

// (3) cross-kit rename-export: old binding imported from the OLD kit, by name.
for (const key of Object.keys(crossKitRenameExport)) {
  const [kit, name] = key.split(NUL);
  if (isOrphan(kit) || mmDefaultBinding[kit] === name) continue;
  addItem({ kit, form: "named", exportName: name });
}

// (4) exportIndex (same-kit rename) named keys not already covered.
for (const key of Object.keys(exportIndex)) {
  const [kit, name] = key.split(NUL);
  if (isOrphan(kit) || mmDefaultBinding[kit] === name) continue;
  addItem({ kit, form: "named", exportName: name });
}

// (5) default-export moves: crossKitDropin `kit\0default`. Only synthesize a
// kit-tail default binding when no entry already covered the default export
// (e.g. cipher's default has no entry; its named exports moved via rename).
for (const key of Object.keys(crossKitDropin)) {
  if (!key.endsWith(NUL + "default")) continue;
  const kit = key.slice(0, -("default".length + 1));
  if (isOrphan(kit) || kitHasEntryDefault.has(kit)) continue;
  addItem({ kit, form: "default", exportName: undefined });
}

// A kit can record the same export as both a default-export move (`kit\0default`)
// and a same-name named drop-in (`kit\0Export`). One import covers both detection
// paths; keep only the default item and drop the redundant named item.
const defaultPairs = new Set(items.filter((i) => i.form === "default").map((i) => `${i.kit}\0${i.exportName ?? ""}`));
for (let i = items.length - 1; i >= 0; i--) {
  const it = items[i];
  if (it.form === "named" && it.exportName && defaultPairs.has(`${it.kit}\0${it.exportName}`)) {
    items.splice(i, 1);
  }
}

// -------------------------------------------------------------- assign locals
// Globally-unique local binding per item, aliasing on collision.
const usedLocal = new Set();
const localOf = {}; // itemKey -> local binding
for (const it of items) {
  const base = it.form === "default" ? (it.exportName ?? kitTail(it.kit)) : it.exportName;
  let local = base;
  if (usedLocal.has(local)) local = `${base}__${kitTag(it.kit)}`;
  let n = 2;
  while (usedLocal.has(local)) local = `${base}__${kitTag(it.kit)}${n++}`;
  usedLocal.add(local);
  localOf[itemKey(it)] = local;
}

// -------------------------------------------------------------- body lines
// One member reference per member entry (members length >= 1), non-orphan,
// using the assigned local for its (kit, exportName).
const bodyLines = [];
const seenBody = new Set();
for (const e of entries) {
  const members = e.dep.members ?? [];
  if (members.length === 0) continue;
  const { kit, exportName } = e.dep;
  if (!exportName || isOrphan(kit)) continue;
  const hasDefMove = crossKitDropin[`${kit}${NUL}default`] !== undefined;
  const isDefExport = hasDefMove && crossKitDropin[`${kit}${NUL}${exportName}`] !== undefined;
  const form = (mmDefaultBinding[kit] === exportName || isDefExport) ? "default" : "named";
  const local = localOf[itemKey({ kit, form, exportName })];
  if (!local) continue;
  const line = `  ${local}.${members.join(".")};`;
  if (seenBody.has(line)) continue;
  seenBody.add(line);
  bodyLines.push(`${line}  // since ${e.since ?? "?"}`);
}

// -------------------------------------------------------------- emit imports
const kitItems = {}; // kit -> {named:[{exportName,local}], default:[{local}]}
for (const it of items) {
  (kitItems[it.kit] ??= { named: [], default: [] });
  if (it.form === "default") {
    kitItems[it.kit].default.push({ local: localOf[itemKey(it)] });
  } else {
    kitItems[it.kit].named.push({ exportName: it.exportName, local: localOf[itemKey(it)] });
  }
}

/** Cross-kit move target for a named binding, or undefined when it did not move
 *  cross-kit. `scanProjectCrossKitDropin` rewrites a clause only when EVERY
 *  binding moved to the SAME target kit, so bindings must be grouped by target. */
function crossKitTarget(kit, name) {
  const dk = crossKitDropin[`${kit}${NUL}${name}`];
  if (dk) return dk;
  const rk = crossKitRenameExport[`${kit}${NUL}${name}`];
  if (rk) { const i = rk.indexOf(NUL); return i > 0 ? rk.slice(0, i) : rk; }
  return undefined;
}

const kits = Object.keys(kitItems).sort();
const out = [];
out.push("// Auto-generated by scripts/gen-deprecated-all.mjs — do not edit.");
out.push(`// Covers ${entries.length} deprecated entries across ${kits.length} resolvable kits (API ${map.apiVersion}).`);
out.push("// Each deprecated symbol is referenced exactly once so the scanner can");
out.push("// detect it; the file is a scan/rewrite fixture, not a compiling module.");
out.push("// Named imports are split by cross-kit target so each clause is homogeneous");
out.push("// (the drop-in scanner leaves a mixed clause untouched).");
if (orphanCount) out.push(`// ${orphanCount} entries on unimportable @? orphan kits were skipped.`);
out.push("");
for (const kit of kits) {
  const { named, default: def } = kitItems[kit];
  for (const d of def) out.push(`import ${d.local} from '${kit}';`);
  // Group named bindings by cross-kit target (undefined => no cross-kit move),
  // so each clause is homogeneous — the drop-in scanner rewrites a clause only
  // when every binding moved to the same target kit.
  const groups = new Map();
  for (const n of named) {
    const t = crossKitTarget(kit, n.exportName) ?? "__none__";
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(n);
  }
  for (const [, group] of groups) {
    const parts = group
      .map((n) => (n.local === n.exportName ? n.exportName : `${n.exportName} as ${n.local}`))
      .sort();
    out.push(`import { ${parts.join(", ")} } from '${kit}';`);
  }
}
out.push("");
out.push("// Deprecated symbol references (member access / call sites).");
out.push(bodyLines.join("\n"));
out.push("");

process.stdout.write(out.join("\n"));
