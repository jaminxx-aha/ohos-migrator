/**
 * deprecation-map.js — 装载预建的 SDK 废弃映射（data/deprecation-map.<apiVersion>.json）
 * + 建 O(1) 查表索引。map 由参考工程 indexer 预生成（ts-morph），本工具只消费。
 *
 * 查表键：entry.dep.{kit, exportName, members[]}。scan.js 的 record() 用 computeIdentity
 * 从废弃声明节点走 getParent() 收集容器名，产出同形状的 {kit, exportName, members}。
 * kit 来自 declFileToModule（SDK 声明文件名），exportName/members 来自 computeIdentity。
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MAP_RE = /^deprecation-map\.(\d+)\.json$/;

/** 读 SDK apiVersion：sdkApiDir/../oh-uni-package.json 的 "apiVersion":"N"。读不到返回 null。 */
function readApiVersion(sdkApiDir) {
  if (!sdkApiDir) return null;
  const pkg = path.join(sdkApiDir, '..', 'oh-uni-package.json');
  let content;
  try { content = fs.readFileSync(pkg, 'utf8'); } catch (_) { return null; }
  const m = content.match(/"apiVersion"\s*:\s*"(\d+)"/);
  return m ? Number(m[1]) : null;
}

function shippedMapPath(apiVersion) {
  const p = path.join(DATA_DIR, `deprecation-map.${apiVersion}.json`);
  return fs.existsSync(p) ? p : null;
}

/** 列出 shipped map 的 apiVersion（升序）。data/ 无 map 返回 []。 */
function shippedVersions() {
  let names;
  try { names = fs.readdirSync(DATA_DIR); } catch (_) { return []; }
  return names
    .filter((n) => MAP_RE.test(n))
    .map((n) => Number(n.match(MAP_RE)[1]))
    .sort((a, b) => a - b);
}

/**
 * 装载 map。优先级：opts.mapPath 显式覆盖 > SDK apiVersion 对应 shipped map >
 * 最高版本 shipped map（带 warn，可能不匹配 SDK）。无任何 map 返回 null（调用方降级）。
 */
function loadMap(opts = {}) {
  if (opts.mapPath && fs.existsSync(opts.mapPath)) {
    return JSON.parse(fs.readFileSync(opts.mapPath, 'utf8'));
  }
  const v = readApiVersion(opts.sdkPath);
  if (v) {
    const p = shippedMapPath(v);
    if (p) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  const shipped = shippedVersions();
  if (shipped.length === 0) return null;
  if (v && !shippedMapPath(v)) {
    const top = shipped[shipped.length - 1];
    console.warn(`[map] 无 apiVersion=${v} 的 shipped map，回退最高版本 ${top}（可能不匹配 SDK，建议重新生成）`);
    return JSON.parse(fs.readFileSync(shippedMapPath(top), 'utf8'));
  }
  // 无 SDK 信息（如 CI 单测无 DevEco）：用最高版本
  const top = shipped[shipped.length - 1];
  return JSON.parse(fs.readFileSync(shippedMapPath(top), 'utf8'));
}

/**
 * 建 O(1) 查表索引：Map<kit, Map<exportName, Map<members.join('.'), entry>>>。
 * 同时透出 kitIndex（kit 迁移）/ kitExports（各 kit 真实顶层导出）/ kitDefaultExport
 * （default 导出的 kit，inject-import 据此选 import 形态）。
 */
function buildIndex(map) {
  const byKEM = new Map();
  for (const e of (map.entries || [])) {
    const kit = e.dep && e.dep.kit;
    const exp = e.dep && e.dep.exportName;
    const members = (e.dep && e.dep.members) || [];
    // 无 members 的 entry 是 module-move/export 级，不进成员查表（由 kitIndex/exportIndex 覆盖）
    if (!kit || !exp || members.length === 0) continue;
    const chain = members.join('.');
    if (!byKEM.has(kit)) byKEM.set(kit, new Map());
    const byExp = byKEM.get(kit);
    if (!byExp.has(exp)) byExp.set(exp, new Map());
    byExp.get(exp).set(chain, e);
  }
  return {
    byKEM,
    kitIndex: map.kitIndex || {},
    kitExports: map.kitExports || {},
    kitDefaultExport: map.kitDefaultExport || {},
  };
}

/** O(1) 查 entry。members 为空数组时查 module/export 级（chain=''）。未命中返回 null。 */
function lookupEntry(index, kit, exportName, members) {
  const chain = (members || []).join('.');
  const byExp = index.byKEM.get(kit);
  if (!byExp) return null;
  const byChain = byExp.get(exportName);
  if (!byChain) return null;
  return byChain.get(chain) || null;
}

module.exports = { readApiVersion, loadMap, buildIndex, lookupEntry, shippedVersions, DATA_DIR };
