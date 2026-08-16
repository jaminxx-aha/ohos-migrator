/**
 * Build the AI prompt context for one file's residual deprecated-API findings.
 *
 * For each finding we try to locate, in the SDK `.d.ts` on disk, BOTH the
 * deprecated declaration (what the call site currently uses) and the
 * `@useinstead` replacement declaration (what it should become), and render a
 * bounded slice of each — NOT the whole kit file (the largest are ~0.5MB).
 *
 * The Finding does not carry a reference back to its `DeprecationEntry`
 * (its `oldSymbol` is the call-site text `binding.chain`, not SDK identity),
 * so targets are recovered heuristically from the finding's `oldSymbol` /
 * `newSymbol` / `note` plus the file's import binding→kit map. Anything we
 * can't resolve still reaches the AI via the finding's `note` (which the
 * scanner fills with a human-readable target description), so the model is
 * never left with zero signal.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { extractBindingMap } from "../scanner/member-scanner.js";
import type { Finding, DeprecationMap } from "../rules/types.js";

export interface FindingBrief {
  line: number;
  oldSymbol: string;
  newSymbol: string | null;
  rule: string;
  note: string;
  replacement?: string;
}

export interface FileContext {
  fileContent: string;
  findingBriefs: FindingBrief[];
  /** Deduped SDK declaration slices (deprecated + replacement decls). */
  sdkSlices: string[];
}

/** Resolve a kit specifier to its on-disk declaration file path. */
export function kitFile(sdkPath: string, kit: string): string {
  // @ohos.router / @system.router / @ohos.arkui.UIContext → "<sdk>/<kit>.d.ts"
  return join(sdkPath, `${kit}.d.ts`);
}

interface DeclTarget {
  kit: string;
  member?: string;
  container?: string;
  label: "deprecated" | "replacement";
}

/**
 * Extract a bounded declaration slice for a symbol from a `.d.ts` file.
 * Returns the member's declaration line plus any preceding JSDoc, capped at
 * `maxLines`. Returns "" when the file is missing or the member isn't found.
 */
export function extractDeclSlice(
  file: string,
  member: string,
  container?: string,
  maxLines = 60,
): string {
  if (!member) return "";
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const lines = text.split("\n");

  // Optionally scope the search to a container's body.
  let startFrom = 0;
  let endAt = lines.length;
  if (container) {
    const containerRe = new RegExp(
      `\\b(class|interface|declare\\s+namespace|namespace)\\s+${escapeRe(container)}\\b`,
    );
    const ci = lines.findIndex((l) => containerRe.test(l));
    if (ci >= 0) {
      startFrom = ci;
      // body ends at the next top-level closing brace at column 0 after ci
      for (let j = ci + 1; j < lines.length; j++) {
        if (/^\}/.test(lines[j])) {
          endAt = j;
          break;
        }
      }
    }
  }

  // A declaration line names the member in a declaration position.
  const declRe = new RegExp(
    `(^|\\s)(export\\s+)?(declare\\s+)?(static\\s+|async\\s+|function\\s+|get\\s+|set\\s+|readonly\\s+)*` +
      `${escapeRe(member)}\\s*[(<:=?]`,
  );

  // Collect EVERY overload of `member` within the container scope. A tightened
  // signature is often visible only by comparing overloads — e.g.
  // verifyAccessToken has both a `permissionName: Permissions` overload and a
  // deprecated `permissionName: string` overload; taking only the first match
  // would hide the deprecated overload the call site actually resolves to, so
  // the AI would see the deprecated and replacement sides as identical and
  // wrongly conclude the signature is unchanged.
  const declIndices: number[] = [];
  for (let i = startFrom; i < endAt; i++) {
    if (declRe.test(lines[i])) declIndices.push(i);
  }
  if (declIndices.length === 0) return "";

  const sliceLines: string[] = [];
  const used = new Set<number>();
  for (const di of declIndices) {
    // Walk back to this overload's preceding JSDoc (`/** … */` / ` * ` lines).
    // Stop at a non-JSDoc line so we never bleed into the previous overload's
    // signature or a neighbouring member.
    let s = di;
    if (di > 0) {
      let j = di - 1;
      while (j >= 0 && /^\s*(\*|\/\*\*|\*\/)/.test(lines[j]) && !used.has(j)) {
        s = j;
        j--;
      }
    }
    // Walk forward to capture the full signature (until a `;` line or `}`).
    // Start AT the declaration line so a single-line decl terminates
    // immediately (otherwise we'd scan into the next member's JSDoc/decl).
    let e = di + 1;
    for (let j = di; j < Math.min(endAt, di + maxLines); j++) {
      e = j + 1;
      if (/;\s*$/.test(lines[j]) || /^\s*\}/.test(lines[j])) break;
    }
    for (let k = s; k < e; k++) {
      if (used.has(k)) continue;
      used.add(k);
      sliceLines.push(lines[k]);
    }
    if (sliceLines.length >= maxLines) break;
  }
  return sliceLines.slice(0, maxLines).join("\n");
}

/** Built-in / ubiquitous type names we never try to resolve cross-file. */
const BUILTIN_TYPES = new Set([
  "number", "string", "boolean", "void", "undefined", "null", "object",
  "any", "unknown", "never", "Promise", "Record", "Array", "Map", "Set",
  "ReadonlyArray", "ReadonlyMap", "ReadonlySet", "Object", "Function",
  "Date", "Error", "RegExp", "Uint8Array", "ArrayBuffer", "JSON", "PromiseLike",
]);

/**
 * Best-effort one-line summary of a cross-file type referenced by a decl slice.
 *
 * The decl slice for a member carries only the *name* of a parameter type
 * (e.g. `permissionName: Permissions`), not the type's definition — which lives
 * in another `.d.ts` reached via an `import`. The AI therefore can't tell
 * whether `Permissions` is a loose `string` alias (a bare-literal argument
 * like `''` would be fine) or a restricted literal union (it would NOT). This
 * resolves the import, reads the type definition, and returns a one-line hint
 * classifying it: "literal union (restricted, no bare string)" vs "contains
 * string (loose)" vs nothing when the definition can't be found.
 *
 * Focused on the one question that decides argument compatibility — is this
 * type a restricted literal union or does it admit a bare `string`? — so it
 * never dumps a 2978-line union into the prompt; it counts the literals and
 * reports the shape only.
 */
export function summarizeTypeRef(hostFile: string, typeName: string): string {
  if (!typeName || BUILTIN_TYPES.has(typeName)) return "";

  let hostText: string;
  try {
    hostText = readFileSync(hostFile, "utf8");
  } catch {
    return "";
  }
  // Resolve the import that brings `typeName` in:
  // `import { … typeName … } from './path'` (named) — default imports are out
  // of scope (default-imported types are the namespace itself, not a param type).
  const importRe = new RegExp(
    `import\\s+(?:type\\s+)?\\{[^}]*\\b${escapeRe(typeName)}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`,
  );
  const im = importRe.exec(hostText);
  if (!im) return "";
  const spec = im[1];
  // Only resolve relative specifiers; kit-level bare re-exports are out of scope.
  if (!spec.startsWith(".")) return "";

  const dir = dirname(hostFile);
  // Try the specifier as-is, then with the common declaration extensions.
  const candidates = [spec, `${spec}.d.ts`, `${spec}.d.ets`, `${spec}.ts`];
  let srcFile = "";
  for (const c of candidates) {
    const p = join(dir, c);
    if (existsSync(p)) { srcFile = p; break; }
  }
  if (!srcFile) return "";

  let srcText: string;
  try {
    srcText = readFileSync(srcFile, "utf8");
  } catch {
    return "";
  }
  const srcLines = srcText.split("\n");
  // Locate `export type typeName =` (a large literal union may span far).
  const defRe = new RegExp(`^\\s*export\\s+type\\s+${escapeRe(typeName)}\\s*=`);
  let defStart = -1;
  for (let i = 0; i < srcLines.length; i++) {
    if (defRe.test(srcLines[i])) { defStart = i; break; }
  }
  if (defStart < 0) return "";

  // Gather the full definition until the terminating `;`. Only the
  // classification needs the text, not the content, so cap the scan to stay
  // bounded even for a 2978-line union.
  const defParts: string[] = [];
  for (let i = defStart; i < Math.min(srcLines.length, defStart + 4000); i++) {
    defParts.push(srcLines[i]);
    if (/;\s*$/.test(srcLines[i])) break;
  }
  const def = defParts.join("\n");

  // Quoted literals anywhere in the union (the actual members).
  const literals = def.match(/'[^']*'/g) ?? [];
  // A bare `string` keyword used as a type — i.e. `string` outside quotes,
  // like `= string` or `| string |` — means the type admits any string.
  const hasBareString = /\bstring\b/.test(def);

  if (literals.length > 0 && !hasBareString) {
    // Representative prefix from the first literal, e.g.
    // 'ohos.permission.ACCESS_BIOMETRIC' -> "ohos.permission.*".
    const first = literals[0]!;
    const captured = first.match(/^'([^.]+)/)?.[1];
    const prefix = captured ? `${captured}.*` : "...";
    return `// ${typeName} = literal union (${literals.length} literals like '${prefix}', no bare string — restricted)`;
  }
  if (hasBareString) {
    return `// ${typeName} = contains string (loose — bare 'string' member present)`;
  }
  return `// ${typeName} = interface/alias (not a literal union — see ${spec})`;
}

/** Build the full context payload for one file. */
export function buildFileContext(
  projectRoot: string,
  file: string,
  findings: Finding[],
  map: DeprecationMap,
): FileContext {
  const abs = join(projectRoot, ...file.split("/"));
  let fileContent: string;
  try {
    fileContent = readFileSync(abs, "utf8");
  } catch {
    fileContent = "";
  }

  const briefs: FindingBrief[] = findings.map((f) => ({
    line: f.line,
    oldSymbol: f.oldSymbol,
    newSymbol: f.newSymbol,
    rule: f.rule,
    note: f.note,
    replacement: f.replacement,
  }));

  const bindingMap = extractBindingMap(fileContent);
  const targets = new Map<string, DeclTarget>();
  for (const f of findings) {
    for (const t of resolveTargets(f, bindingMap, map)) {
      targets.set(`${t.label}\0${t.kit}\0${t.member ?? ""}\0${t.container ?? ""}`, t);
    }
  }

  const sdkSlices: string[] = [];
  for (const t of targets.values()) {
    if (!map.sdkPath) continue;
    const file = kitFile(map.sdkPath, t.kit);
    if (!existsSync(file)) continue;
    const slice = extractDeclSlice(file, t.member ?? "", t.container);
    if (slice) {
      // Attach one-line summaries for cross-file type references the slice
      // names but doesn't define (e.g. `permissionName: Permissions` -> where
      // `Permissions` lives and whether it's a restricted literal union), so
      // the AI can judge argument compatibility without dumping whole type
      // files into the prompt.
      const refNames = new Set<string>();
      for (const m of slice.matchAll(/:\s*([A-Z][A-Za-z0-9_]*)/g)) {
        const n = m[1];
        if (!BUILTIN_TYPES.has(n)) refNames.add(n);
      }
      const summaries: string[] = [];
      for (const n of refNames) {
        const s = summarizeTypeRef(file, n);
        if (s) summaries.push(s);
      }
      const body = summaries.length ? `${slice}\n${summaries.join("\n")}` : slice;
      sdkSlices.push(
        `// ${t.label}: ${t.kit}${t.container ? `.${t.container}` : ""}${t.member ? `.${t.member}` : ""}\n${body}`,
      );
    } else if (t.member == null) {
      // No member (import-level): list the kit's importable exports instead.
      const exp = map.kitExports?.[t.kit];
      if (exp && exp.length) {
        sdkSlices.push(`// ${t.label} kit exports: ${t.kit}\n${exp.join(", ")}`);
      }
    }
  }

  return { fileContent, findingBriefs: briefs, sdkSlices };
}

/**
 * Recover declaration targets from a finding (deprecated + replacement).
 * Best-effort; returns [] for shapes we can't parse (the finding's `note`
 * still carries a human description for the model).
 */
function resolveTargets(
  f: Finding,
  bindingMap: Map<string, string>,
  map: DeprecationMap,
): DeclTarget[] {
  const out: DeclTarget[] = [];
  const kitIndex = map.kitIndex ?? {};

  // --- Deprecated side: binding.chain → (binding's kit, chain leaf) ---
  if (f.rule === "rename-member" || f.rule === "override" || f.rule === "inject-import" || f.rule === "manual") {
    const dot = f.oldSymbol.indexOf(".");
    if (dot > 0) {
      const binding = f.oldSymbol.slice(0, dot);
      const chain = f.oldSymbol.slice(dot + 1);
      // Prefer the import binding's kit; fall back to the finding's `kit`
      // (set by the scanner for instance calls whose binding is a `declare let`
      // variable, NOT an import — bindingMap can't resolve those).
      const kit = bindingMap.get(binding) ?? f.kit;
      if (kit) {
        const segs = chain.split(".");
        out.push({
          kit,
          member: segs[segs.length - 1],
          container: segs.length > 1 ? segs[0] : f.container,
          label: "deprecated",
        });
      }
    }
  }

  // --- Replacement side ---
  // Case 1: newSymbol is "<kit>/<memberPath>" (cross-kit / module target).
  if (f.newSymbol) {
    const slash = f.newSymbol.indexOf("/");
    if (slash > 0 && f.newSymbol.startsWith("@")) {
      const kit = f.newSymbol.slice(0, slash);
      const memberPath = f.newSymbol.slice(slash + 1);
      const segs = memberPath.split(".");
      out.push({
        kit,
        member: segs[segs.length - 1],
        container: segs.length > 1 ? segs[0] : undefined,
        label: "replacement",
      });
      return out;
    }
    // Case 2: newSymbol is a bare kit specifier (import-level rewrite-import).
    if (f.newSymbol.startsWith("@") && !f.newSymbol.includes(".")) {
      out.push({ kit: f.newSymbol, label: "replacement" });
      return out;
    }
    if (f.newSymbol.startsWith("@ohos.") || f.newSymbol.startsWith("@system.")) {
      // newSymbol is a kit specifier like "@ohos.router" (rewrite-import).
      out.push({ kit: f.newSymbol, label: "replacement" });
      return out;
    }
    // Case 3: newSymbol is "binding.leaf" (same-kit rename). Kit from binding.
    const dot = f.newSymbol.indexOf(".");
    if (dot > 0) {
      const binding = f.newSymbol.slice(0, dot);
      const chain = f.newSymbol.slice(dot + 1);
      const kit = bindingMap.get(binding) ?? bindingMap.get(f.oldSymbol.split(".")[0]);
      if (kit) {
        const segs = chain.split(".");
        out.push({
          kit,
          member: segs[segs.length - 1],
          container: segs.length > 1 ? segs[0] : undefined,
          label: "replacement",
        });
      }
      return out;
    }
    // Case 3b: newSymbol is a bare member name — a same-kit instance rename
    // from a curated override that set only the leaf (e.g. "checkAccessToken"),
    // so there is no binding to resolve. Kit + container come from the finding
    // itself (the scanner set them from the deprecated entry's identity).
    if (f.kit) {
      out.push({
        kit: f.kit,
        member: f.newSymbol,
        container: f.container,
        label: "replacement",
      });
      return out;
    }
  }

  // Case 4: note names a target kit/member (manual cross-kit / instance).
  const kitMatch = f.note.match(/@(?:ohos|system)\.[\w.]+/);
  if (kitMatch) {
    const token = kitMatch[0];
    // Try to peel a member off the token's tail (e.g. "@ohos.X.Y.leaf" → kit @ohos.X.Y, member leaf).
    const parts = token.split(".");
    // Heuristic: member is the last segment if kit is known via kitIndex/kitExports.
    const knownKit = pickKnownKit(parts, map);
    if (knownKit) {
      const rest = token.slice(knownKit.length + 1); // after "kit."
      out.push({
        kit: knownKit,
        member: rest || undefined,
        label: "replacement",
      });
    } else {
      out.push({ kit: token, label: "replacement" });
    }
  }

  return out;
}

/** Given a dotted `@ohos.a.b.c`, find the longest prefix that is a real kit. */
function pickKnownKit(parts: string[], map: DeprecationMap): string | undefined {
  const kitExports = map.kitExports ?? {};
  const kitIndex = map.kitIndex;
  // Try longest first: @ohos.a.b.c, @ohos.a.b, @ohos.a
  for (let i = parts.length; i >= 1; i--) {
    const candidate = parts.slice(0, i).join(".");
    if (kitExports[candidate] || kitIndex[candidate]) return candidate;
  }
  return undefined;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
