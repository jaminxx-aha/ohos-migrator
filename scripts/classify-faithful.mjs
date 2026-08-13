// Faithful re-derivation of the auto/manual split for the deprecation map.
//
// Mirrors the scanner+indexer decision tree so the manual list can be
// re-derived at any time (the original classify-*.mjs scratch scripts were
// deleted, leaving the doc's bucket numbers un-reproducible). Run:
//
//   node scripts/classify-faithful.mjs
//
// Models: indexer flags (instanceSafe / crossKitMemberDropin /
// memberPreservedByMove / nestedContainerInsert), exportIndex suppression
// (member-scanner.ts:144), memberCoveredByContainerDropin (sym + asym,
// member-scanner.ts:419 with the repl.kit===dropin guard), kit module-move
// coverage for export-level entries, and describeMemberReplacement
// (member-scanner.ts:464 — no-op/aligned suppress, same-kit rename-member,
// cross-kit manual, unresolved manual). toReplSymbol strips colon-bearing
// segments. The result is ~within a few dozen of the doc's recorded split;
// the doc's own buckets are known-inaccurate (deleted classifier), so this
// script is the source of truth for the manual SHAPE breakdown used to hunt
// the next sound lever.

import { readFileSync } from "node:fs";

const map = JSON.parse(readFileSync(".harmony-deprecate/deprecation-map.24.json","utf8"));
const E = map.entries;
const kitIndex = map.kitIndex || {};
const exportIndex = map.exportIndex || {};
const crossKitDropin = map.crossKitDropin || {};
const crossKitRenameExport = map.crossKitRenameExport || {};
const kitMove = k => kitIndex[k]?.newKit;

const toRepl = repl => {
  if (!repl || !repl.members) return null;
  const m = repl.members.filter(s => !s.includes(":"));
  return m.length ? { ...repl, members: m } : null;
};

// faithful memberCoveredByContainerDropin (member-scanner.ts:419)
function memberCovered(exportName, depMembers, repl, dropin) {
  if (!exportName || !dropin || !repl) return false;
  const rm = repl.members;
  if (!repl.kit || repl.kit !== dropin || !rm) return false;
  if (rm.length === depMembers.length) return depMembers.every((m,i)=>m===rm[i]);
  if (rm.length === depMembers.length+1 && rm[0]===exportName) return depMembers.every((m,i)=>m===rm[i+1]);
  return false;
}

let auto = 0, manual = 0;
const buckets = {};
const mlist = [];
// auto-by-path accounting (single pass; mirrors the scanner branches)
const path = {
  flag: 0,            // indexer flag set
  exportIndex: 0,      // container same-kit renamed -> member suppressed
  memberCovered: 0,    // container crossKitDropin'd -> member resolves on rebind
  noop: 0,            // sameKit (incl. aligned kit-move) && chain unchanged
  renameMember: 0,     // sameKit && trustworthy && same-length chain change
  exportLvl_auto: 0,  // export-level (no members) covered by some rewrite
  exportLvl_manual: 0,
};

for (const e of E) {
  // ---- export-level (no dep.members) ----
  if (!e.dep.members || e.dep.members.length === 0) {
    const k = e.dep.kit, ex = e.dep.exportName;
    if (exportIndex[`${k}\0${ex}`]) { auto++; path.exportLvl_auto++; continue; }
    if (crossKitDropin[`${k}\0${ex}`] || crossKitDropin[`${k}\0default`]) { auto++; path.exportLvl_auto++; continue; }
    if (crossKitRenameExport[`${k}\0${ex}`]) { auto++; path.exportLvl_auto++; continue; }
    if (kitIndex[k]?.newKit) { auto++; path.exportLvl_auto++; continue; }
    manual++; path.exportLvl_manual++; buckets["export-other"]=(buckets["export-other"]||0)+1; mlist.push({e,why:"export-other"}); continue;
  }
  const depKit = e.dep.kit;
  const dMembers = e.dep.members;
  const repl = toRepl(e.repl);
  const ownKit = depKit;
  if (e.instanceSafe || e.crossKitMemberDropin || e.memberPreservedByMove || e.nestedContainerInsert) { auto++; path.flag++; continue; }
  if (e.dep.exportName && exportIndex[`${ownKit}\0${e.dep.exportName}`]) { auto++; path.exportIndex++; continue; }
  if (e.dep.exportName && repl && e.dep.members) {
    const dropin = crossKitDropin[`${ownKit}\0${e.dep.exportName}`] ?? crossKitDropin[`${ownKit}\0default`];
    if (memberCovered(e.dep.exportName, e.dep.members, repl, dropin)) { auto++; path.memberCovered++; continue; }
  }
  if (!repl || !repl.members || repl.members.length===0) {
    manual++; buckets["no_replacement"]=(buckets["no_replacement"]||0)+1; mlist.push({e,why:"no_repl"}); continue;
  }
  const rMembers = repl.members;
  const aligned = !!(repl.kit && kitMove(depKit)===repl.kit);
  const sameKit = !repl.kit || repl.kit===depKit || aligned;
  const trustworthy = repl.kit ? true : rMembers.length===1;
  const sameLength = dMembers.length>0 && dMembers.length===rMembers.length;
  const chainEqual = sameLength && dMembers.every((x,i)=>x===rMembers[i]);
  if (sameKit && chainEqual) { auto++; path.noop++; continue; }
  if (sameKit && trustworthy && sameLength) { auto++; path.renameMember++; continue; }
  let why, bucket;
  if (repl.kit && !sameKit) { why="cross_kit"; bucket="cross-kit"; }
  else if (!sameLength) { why="chain_mismatch"; bucket="chain-length-mismatch"; }
  else { why="unresolved"; bucket="unresolved"; }
  manual++; buckets[bucket]=(buckets[bucket]||0)+1;
  mlist.push({e, why, repl});
}

console.log("auto:", auto, "manual:", manual, "total:", auto+manual);
console.log("buckets:", JSON.stringify(buckets));
console.log("auto by path:", JSON.stringify(path));
console.log("member-auto:", path.flag+path.exportIndex+path.memberCovered+path.noop+path.renameMember,
  "(flag", path.flag, "+ exportIndex", path.exportIndex, "+ memberCovered", path.memberCovered,
  "+ noop", path.noop, "+ renameMember", path.renameMember, ")");
console.log("export-level: auto", path.exportLvl_auto, "+ manual", path.exportLvl_manual);

const shapes = {};
for (const {e, why, repl} of mlist) {
  const d=e.dep, r=repl||toRepl(e.repl);
  const dl=(d.members||[]).length, rl=r?r.members.length:0;
  const skit = !r?.kit || r.kit===d.kit || kitMove(d.kit)===r.kit;
  const leafPres = r && dl>0 && rl>0 && d.members[dl-1]===r.members[rl-1];
  const key = `${why} d${dl}->r${rl} ${skit?"skit":"xkit"} leafPres=${leafPres?1:0}`;
  shapes[key] = (shapes[key]||0)+1;
}
console.log("\n=== manual shapes (why dLen->rLen skit/xkit leafPres) ===");
for (const [k,v] of Object.entries(shapes).sort((a,b)=>b[1]-a[1])) console.log(`  ${v}\t${k}`);
