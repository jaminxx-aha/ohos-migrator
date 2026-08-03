/**
 * SDK path detection and cache locations.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Default SDK probe roots (Windows + macOS standard installs). */
const SDK_PROBE_ROOTS = [
  // Windows
  "C:\\Program Files\\Huawei\\DevEco Studio\\sdk\\default\\openharmony\\ets\\api",
  "C:\\Program Files (x86)\\Huawei\\DevEco Studio\\sdk\\default\\openharmony\\ets\\api",
  // macOS
  "/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets/api",
];

/** Resolve an SDK api directory from --sdk or environment, else probe defaults. */
export function resolveSdkApiDir(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.DEVECO_SDK_HOME &&
      join(process.env.DEVECO_SDK_HOME, "openharmony", "ets", "api"),
    process.env.OHOS_SDK_HOME &&
      join(process.env.OHOS_SDK_HOME, "ets", "api"),
    ...SDK_PROBE_ROOTS,
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    const p = resolve(c);
    if (existsSync(p) && statSync(p).isDirectory()) return p;
  }
  throw new Error(
    "Could not locate the HarmonyOS SDK api directory. Pass --sdk <path> or set DEVECO_SDK_HOME.",
  );
}

/** Directory for cached deprecation maps. */
export function cacheDir(): string {
  return join(homedir(), ".harmony-deprecate");
}

/** Cache file for a given apiVersion. */
export function cacheFile(apiVersion: number): string {
  return join(cacheDir(), `deprecation-map.${apiVersion}.json`);
}

/** Read the SDK apiVersion from the sibling `oh-uni-package.json`. */
export function readApiVersion(sdkApiDir: string): number {
  const pkg = join(sdkApiDir, "..", "oh-uni-package.json");
  const content = readTextSafe(pkg);
  const m = content.match(/"apiVersion"\s*:\s*"(\d+)"/);
  if (!m) throw new Error(`Could not read apiVersion from ${pkg}`);
  return Number(m[1]);
}

function readTextSafe(p: string): string {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
