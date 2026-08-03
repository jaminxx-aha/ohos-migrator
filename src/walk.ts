/**
 * Tiny recursive file walker (avoids depending on fs.globSync, which only
 * landed in Node 22). Collects files with a given extension under a root,
 * skipping ignore directories.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_IGNORE = new Set([
  "node_modules",
  "oh_modules",
  ".preview",
  "build",
  ".cxx",
  ".git",
  "entry/src/ohosTest/build",
]);

export interface WalkOptions {
  extensions: string[]; // e.g. [".ts", ".ets"]
  ignoreDirs?: Set<string>;
}

export function walkFiles(root: string, opts: WalkOptions): string[] {
  const ignore = opts.ignoreDirs ?? DEFAULT_IGNORE;
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!ignore.has(name)) stack.push(full);
        continue;
      }
      if (st.isFile()) {
        const lower = name.toLowerCase();
        if (opts.extensions.some((e) => lower.endsWith(e))) out.push(full);
      }
    }
  }
  return out;
}

/** Flat directory listing filtered by a name predicate (used for SDK api/). */
export function listFiles(dir: string, predicate: (name: string) => boolean): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter(predicate)
    .map((n) => join(dir, n))
    .filter((f) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    });
}
