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
const exportAuto = { exportIndex:0, crossKitDropin:0, crossKitRenameExport:0, kitMove:0, memberlessManual:0 };

for (const e of E) {
  // ---- export-level (no dep.members) ----
  if (!e.dep.members || e.dep.members.length === 0) {
    const k = e.dep.kit, ex = e.dep.exportName;
    if (exportIndex[`${k}\0${ex}`]) { auto++; exportAuto.exportIndex++; continue; }
    if (crossKitDropin[`${k}\0${ex}`] || crossKitDropin[`${k}\0default`]) { auto++; exportAuto.crossKitDropin++; continue; }
    if (crossKitRenameExport[`${k}\0${ex}`]) { auto++; exportAuto.crossKitRenameExport++; continue; }
    // kit module-move: rewrite-import re-points specifier -> all exports auto
    if (kitIndex[k]?.newKit) { auto++; exportAuto.kitMove++; continue; }
    manual++; exportAuto.memberlessManual++; buckets["export-other"]=(buckets["export-other"]||0)+1; mlist.push({e,why:"export-other"}); continue;
  }
  const depKit = e.dep.kit;
  const dMembers = e.dep.members;
  const repl = toRepl(e.repl);
  const ownKit = depKit;
  if (e.instanceSafe || e.crossKitMemberDropin || e.memberPreservedByMove || e.nestedContainerInsert) { auto++; continue; }
  if (e.dep.exportName && exportIndex[`${ownKit}\0${e.dep.exportName}`]) { auto++; continue; }
  if (e.dep.exportName && repl && e.dep.members) {
    const dropin = crossKitDropin[`${ownKit}\0${e.dep.exportName}`] ?? crossKitDropin[`${ownKit}\0default`];
    if (memberCovered(e.dep.exportName, e.dep.members, repl, dropin)) { auto++; continue; }
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
  if (sameKit && chainEqual) { auto++; continue; }
  if (sameKit && trustworthy && sameLength) { auto++; continue; }
  let why, bucket;
  if (repl.kit && !sameKit) { why="cross_kit"; bucket="cross-kit"; }
  else if (!sameLength) { why="chain_mismatch"; bucket="chain-length-mismatch"; }
  else { why="unresolved"; bucket="unresolved"; }
  manual++; buckets[bucket]=(buckets[bucket]||0)+1;
  mlist.push({e, why, repl});
}

console.log("auto:", auto, "manual:", manual, "total:", auto+manual);
console.log("exportAuto:", JSON.stringify(exportAuto));
console.log("buckets:", JSON.stringify(buckets));

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
