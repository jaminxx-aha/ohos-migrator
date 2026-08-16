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
import { join } from "node:path";
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
  maxLines = 40,
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

  let declIdx = -1;
  for (let i = startFrom; i < endAt; i++) {
    if (declRe.test(lines[i])) {
      declIdx = i;
      break;
    }
  }
  if (declIdx < 0) return "";

  // Walk back to include a preceding JSDoc block (/** ... */ or ` * ` lines).
  let sliceStart = declIdx;
  if (declIdx > 0) {
    let j = declIdx - 1;
    while (j >= 0 && /^\s*(\*|\/\*\*|\*\/)/.test(lines[j])) {
      sliceStart = j;
      j--;
    }
  }
  // Walk forward to capture the full signature (until a `;` line or `}`).
  // Start AT the declaration line so a single-line decl terminates immediately
  // (otherwise we'd scan into the next member's JSDoc/decl).
  let sliceEnd = declIdx + 1;
  for (let j = declIdx; j < Math.min(endAt, declIdx + maxLines); j++) {
    sliceEnd = j + 1;
    if (/;\s*$/.test(lines[j]) || /^\s*\}/.test(lines[j])) break;
  }
  // Cap total span.
  return lines.slice(sliceStart, sliceEnd).slice(0, maxLines).join("\n");
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
      sdkSlices.push(
        `// ${t.label}: ${t.kit}${t.container ? `.${t.container}` : ""}${t.member ? `.${t.member}` : ""}\n${slice}`,
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
      const kit = bindingMap.get(binding);
      if (kit) {
        const segs = chain.split(".");
        out.push({
          kit,
          member: segs[segs.length - 1],
          container: segs.length > 1 ? segs[0] : undefined,
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
