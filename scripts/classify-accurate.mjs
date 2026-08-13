// Faithful auto/manual split modeling the ACTUAL memberFinding decision:
//   symbolOverride(cur)  -> override (auto)
//   else recipe override(findMemberOverride)  -> override (auto)
//   else structural (flag/exportIndex/memberCovered/noop/renameMember)  -> auto
//   else manual
// Plus export-level + the symbol-override table (wantConstant/commonEventManager).
// Uses the COMPILED overrides modules so recipe + symbol-override logic is exact.
import { readFileSync } from "node:fs";
import { findMemberOverride } from "../dist/rewriter/overrides.js";
import { findSymbolOverride } from "../dist/rewriter/symbol-overrides.js";

const map = JSON.parse(readFileSync(".harmony-deprecate/deprecation-map.24.json", "utf8"));
const kitIndex = map.kitIndex || {};
const exportIndex = map.exportIndex || {};
const crossKitDropin = map.crossKitDropin || {};
const crossKitRenameExport = map.crossKitRenameExport || {};
const kitMove = (k) => kitIndex[k]?.newKit;
const toRepl = (repl) => {
  if (!repl || !repl.members) return null;
  const m = repl.members.filter((s) => !s.includes(":"));
  return m.length ? { ...repl, members: m } : null;
};
const ctx = {
  uiContextExpr: "this.getUIContext()",
  windowStageExpr: "this.windowStage",
  windowExpr: "this.window",
};

function memberCovered(exportName, depMembers, repl, dropin) {
  if (!exportName || !dropin || !repl) return false;
  const rm = repl.members;
  if (!repl.kit || repl.kit !== dropin || !rm) return false;
  if (rm.length === depMembers.length) return depMembers.every((m, i) => m === rm[i]);
  if (rm.length === depMembers.length + 1 && rm[0] === exportName)
    return depMembers.every((m, i) => m === rm[i + 1]);
  return false;
}

let auto = 0, manual = 0;
const mWhy = {};
const recipes = { uicontext: 0, window: 0 };
for (const e of map.entries) {
  // ---- export-level ----
  if (!e.dep.members || e.dep.members.length === 0) {
    const k = e.dep.kit, ex = e.dep.exportName;
    if (exportIndex[`${k}\0${ex}`] || crossKitDropin[`${k}\0${ex}`] || crossKitDropin[`${k}\0default`] || crossKitRenameExport[`${k}\0${ex}`] || kitIndex[k]?.newKit) { auto++; continue; }
    manual++; mWhy["export-other"] = (mWhy["export-other"] || 0) + 1; continue;
  }
  // ---- member-level ----
  const repl = toRepl(e.repl);
  // 1. symbol-override table
  if (findSymbolOverride(e.dep.kit, e.dep.exportName, e.dep.members)) { auto++; mWhy["symbol-override"] = (mWhy["symbol-override"] || 0) + 1; continue; }
  // flags
  if (e.instanceSafe || e.crossKitMemberDropin || e.memberPreservedByMove || e.nestedContainerInsert) { auto++; mWhy["flag"] = (mWhy["flag"] || 0) + 1; continue; }
  // exportIndex suppression
  if (e.dep.exportName && exportIndex[`${e.dep.kit}\0${e.dep.exportName}`]) { auto++; mWhy["exportIndex"] = (mWhy["exportIndex"] || 0) + 1; continue; }
  // memberCovered
  if (e.dep.exportName && repl) {
    const dropin = crossKitDropin[`${e.dep.kit}\0${e.dep.exportName}`] ?? crossKitDropin[`${e.dep.kit}\0default`];
    if (memberCovered(e.dep.exportName, e.dep.members, repl, dropin)) { auto++; mWhy["memberCovered"] = (mWhy["memberCovered"] || 0) + 1; continue; }
  }
  // 2. recipe override (UIContext / window)
  if (repl && repl.kit && repl.kit !== e.dep.kit) {
    const ov = findMemberOverride(e.dep.kit, e.dep.members, repl, ctx);
    if (ov) {
      auto++;
      if (repl.kit === "@ohos.arkui.UIContext") recipes.uicontext++;
      else if (repl.kit === "@ohos.window") recipes.window++;
      mWhy["recipe"] = (mWhy["recipe"] || 0) + 1;
      continue;
    }
  }
  // no_replacement
  if (!repl || !repl.members || repl.members.length === 0) { manual++; mWhy["no_replacement"] = (mWhy["no_replacement"] || 0) + 1; continue; }
  // structural same-kit
  const r = repl, d = e.dep.members;
  const aligned = !!(r.kit && kitMove(e.dep.kit) === r.kit);
  const sameKit = !r.kit || r.kit === e.dep.kit || aligned;
  const sameLength = d.length === r.members.length;
  const chainEqual = sameLength && d.every((x, i) => x === r.members[i]);
  const trustworthy = r.kit ? true : r.members.length === 1;
  if (sameKit && chainEqual) { auto++; mWhy["noop"] = (mWhy["noop"] || 0) + 1; continue; }
  if (sameKit && trustworthy && sameLength) { auto++; mWhy["renameMember"] = (mWhy["renameMember"] || 0) + 1; continue; }
  let why;
  if (r.kit && !sameKit) why = "cross_kit";
  else if (!sameLength) why = "chain_mismatch";
  else why = "unresolved";
  manual++; mWhy[why] = (mWhy[why] || 0) + 1;
}

console.log("auto:", auto, "manual:", manual, "total:", auto + manual);
console.log("auto%:", ((auto / (auto + manual)) * 100).toFixed(1) + "%");
console.log("\nauto by path:", JSON.stringify(mWhy));
console.log("  recipe UIContext:", recipes.uicontext, "| recipe window:", recipes.window);
console.log("\nmanual by why:", JSON.stringify(Object.fromEntries(Object.entries(mWhy).filter(([k]) => ["no_replacement","cross_kit","chain_mismatch","unresolved","export-other"].includes(k)))));
