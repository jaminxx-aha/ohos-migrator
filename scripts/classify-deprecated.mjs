import { readFileSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";

const map = JSON.parse(readFileSync(".harmony-deprecate/deprecation-map.24.json", "utf8"));
const byFile = new Map();
for (const e of map.entries) {
  if (!byFile.has(e.source.file)) byFile.set(e.source.file, []);
  byFile.get(e.source.file).push(e);
}

const project = new Project();

// kinds that carry a name we can classify by
const NAMED_KINDS = [
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.MethodDeclaration, SyntaxKind.MethodSignature,
  SyntaxKind.PropertyDeclaration, SyntaxKind.PropertySignature,
  SyntaxKind.GetAccessor, SyntaxKind.SetAccessor,
  SyntaxKind.EnumMember,
  SyntaxKind.EnumDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.ModuleDeclaration,
  SyntaxKind.VariableDeclaration,
  SyntaxKind.Constructor, SyntaxKind.ConstructSignature,
  SyntaxKind.CallSignature,
];

function classify(node) {
  switch (node.getKind()) {
    case SyntaxKind.FunctionDeclaration: return "function";
    case SyntaxKind.MethodDeclaration:
    case SyntaxKind.MethodSignature:
    case SyntaxKind.CallSignature: return "method";
    case SyntaxKind.Constructor:
    case SyntaxKind.ConstructSignature: return "ctor";
    case SyntaxKind.GetAccessor:
    case SyntaxKind.SetAccessor:
    case SyntaxKind.PropertyDeclaration:
    case SyntaxKind.PropertySignature: return "property";
    case SyntaxKind.EnumMember: return "enumMember";
    case SyntaxKind.EnumDeclaration: return "enum";
    case SyntaxKind.ClassDeclaration: return "class";
    case SyntaxKind.InterfaceDeclaration: return "interface";
    case SyntaxKind.ModuleDeclaration: return "namespace";
    case SyntaxKind.VariableDeclaration: return "variable";
    default: return "other";
  }
}

const CALLABLE = new Set(["function", "method", "ctor"]);
const stats = {};
function bump(k) { stats[k] = (stats[k] || 0) + 1; }

let memberCallable = 0, exportCallable = 0, callableEntries = 0;
let memberEntries = 0, exportEntries = 0, unclassified = 0;
// callable deprecated *symbols* (unique by kit+exportName+member)
const callableSymbols = new Set();

for (const [file, entries] of byFile) {
  let sf;
  try { sf = project.addSourceFileAtPath(file); }
  catch { continue; }

  // name -> kind (first occurrence wins; overloads share a kind)
  const nameToKind = new Map();
  for (const k of NAMED_KINDS) {
    for (const d of sf.getDescendantsOfKind(k)) {
      let name;
      try { name = d.getName?.(); } catch { name = undefined; }
      if (!name) continue;
      if (!nameToKind.has(name)) nameToKind.set(name, classify(d));
    }
  }

  for (const e of entries) {
    const members = e.dep.members;
    if (members && members.length) {
      memberEntries++;
      const name = members[0];
      const kind = nameToKind.get(name) ?? "unclassified";
      bump(kind);
      if (CALLABLE.has(kind)) {
        memberCallable++;
        callableEntries++;
        callableSymbols.add(`${e.dep.kit}::${e.dep.exportName}::${name}`);
      }
    } else {
      exportEntries++;
      const name = e.dep.exportName;
      const kind = nameToKind.get(name) ?? "unclassified";
      bump(kind);
      if (CALLABLE.has(kind)) {
        exportCallable++;
        callableEntries++;
        callableSymbols.add(`${e.dep.kit}::${name}`);
      }
    }
    if ((members?.length ? nameToKind.get(members[0]) : nameToKind.get(e.dep.exportName)) === undefined) unclassified++;
  }
}

console.log("== declaration-kind distribution of deprecated map entries ==");
for (const k of Object.keys(stats).sort()) console.log(`  ${k}: ${stats[k]}`);
console.log("\n== callable deprecated (function / method / ctor) ==");
console.log("  member-level callable entries:", memberCallable);
console.log("  whole-export callable entries:", exportCallable);
console.log("  TOTAL callable deprecated entries:", callableEntries);
console.log("  unique callable deprecated symbols:", callableSymbols.size);
console.log("\n  member entries:", memberEntries, "| export entries:", exportEntries, "| unclassified:", unclassified);
