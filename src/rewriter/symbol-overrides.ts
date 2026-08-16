/**
 * Per-symbol curated override table.
 *
 * The structural auto rules (rewrite-import, rename-member, crossKitDropin,
 * crossKitMemberDropin, nestedContainerInsert, instanceSafe,
 * memberPreservedByMove, and the UIContext/Window `override` recipe) all derive
 * their replacement from the SDK's parsed `@useinstead` token. They cannot
 * cover the `no_replacement` entries — members the SDK marked `@deprecated`
 * but gave no `@useinstead` for. Most of those are genuinely removed APIs with
 * no successor, but a meaningful subset has a *known* replacement the SDK
 * didn't document:
 *
 *   - `@ohos.ability.wantConstant.Action.ACTION_HOME` (and the rest of the
 *     `Action` / `Entity` enums). The successor kit
 *     `@ohos.app.ability.wantConstant` DROPPED both enums; their members were
 *     string constants whose value IS the migration target
 *     (`ACTION_HOME = 'ohos.want.action.home'` -> use the literal). The kit
 *     itself moved (`kitIndex.newKit`), so `rewrite-import` re-points the
 *     binding while these overrides splice the literal at each enum-member
 *     access site.
 *
 * This table is the human-curated counterpart of `overrides.ts`' recipe table:
 * each entry maps a deprecated symbol's identity (kit + exportName + member
 * chain) to the EXACT text to splice at the matched `<binding>.<members>` span.
 * Because the data is curated (not inferred), it bypasses the structural verify
 * gates — same trust level as the UIContext/Window recipe. The rewriter already
 * splices `override` findings at their match offsets, so a curated entry just
 * needs to produce an `override` finding with `replacement` set.
 *
 * Extend by adding to `BUILTIN` below, or ship a JSON file and load it via
 * `--symbol-overrides <path>` (merged over the builtin).
 */

import { readFileSync, existsSync } from "node:fs";
import type { SymbolOverride, SymbolOverrideTable } from "../rules/types.js";

/** Build the table key `${kit}\0${exportName}\0${members.join(".")}`. */
export function symbolOverrideKey(
  kit: string,
  exportName: string | undefined,
  members: string[] | undefined,
): string {
  return [kit, exportName ?? "", (members ?? []).join(".")].join("\0");
}

/**
 * `@ohos.ability.wantConstant` `Action` enum — each member is a string literal
 * whose value is the migration target. Verified against the SDK
 * `@ohos.ability.wantConstant.d.ts` `export enum Action` body (the enum value
 * IS the replacement string). The successor kit
 * `@ohos.app.ability.wantConstant` dropped the `Action` enum entirely.
 */
const ACTION_LITERALS: Record<string, string> = {
  ACTION_HOME: "'ohos.want.action.home'",
  ACTION_DIAL: "'ohos.want.action.dial'",
  ACTION_SEARCH: "'ohos.want.action.search'",
  ACTION_WIRELESS_SETTINGS: "'ohos.settings.wireless'",
  ACTION_MANAGE_APPLICATIONS_SETTINGS: "'ohos.settings.manage.applications'",
  ACTION_APPLICATION_DETAILS_SETTINGS: "'ohos.settings.application.details'",
  ACTION_SET_ALARM: "'ohos.want.action.setAlarm'",
  ACTION_SHOW_ALARMS: "'ohos.want.action.showAlarms'",
  ACTION_SNOOZE_ALARM: "'ohos.want.action.snoozeAlarm'",
  ACTION_DISMISS_ALARM: "'ohos.want.action.dismissAlarm'",
  ACTION_DISMISS_TIMER: "'ohos.want.action.dismissTimer'",
  ACTION_SEND_SMS: "'ohos.want.action.sendSms'",
  ACTION_CHOOSE: "'ohos.want.action.choose'",
  ACTION_IMAGE_CAPTURE: "'ohos.want.action.imageCapture'",
  ACTION_VIDEO_CAPTURE: "'ohos.want.action.videoCapture'",
  ACTION_SELECT: "'ohos.want.action.select'",
  ACTION_SEND_DATA: "'ohos.want.action.sendData'",
  ACTION_SEND_MULTIPLE_DATA: "'ohos.want.action.sendMultipleData'",
  ACTION_SCAN_MEDIA_FILE: "'ohos.want.action.scanMediaFile'",
  ACTION_VIEW_DATA: "'ohos.want.action.viewData'",
  ACTION_EDIT_DATA: "'ohos.want.action.editData'",
  INTENT_PARAMS_INTENT: "'ability.want.params.INTENT'",
  INTENT_PARAMS_TITLE: "'ability.want.params.TITLE'",
  ACTION_FILE_SELECT: "'ohos.action.fileSelect'",
  PARAMS_STREAM: "'ability.params.stream'",
  ACTION_APP_ACCOUNT_OAUTH: "'ohos.account.appAccount.action.oauth'",
};

/**
 * `@ohos.ability.wantConstant` `Entity` enum — same shape as `Action` above.
 * The successor kit dropped `Entity` too; each member's value is the target.
 */
const ENTITY_LITERALS: Record<string, string> = {
  ENTITY_DEFAULT: "'entity.system.default'",
  ENTITY_HOME: "'entity.system.home'",
  ENTITY_VOICE: "'entity.system.voice'",
  ENTITY_BROWSABLE: "'entity.system.browsable'",
  ENTITY_VIDEO: "'entity.system.video'",
};

/**
 * `@ohos.commonEventManager` `Support` enum — each member is a string literal
 * whose value is the stable common-event name. The SDK marks these
 * `@deprecated` with no `@useinstead`; the member still exists in the current
 * SDK with the SAME value (so the event name hasn't been renamed — the literal
 * is the canonical, version-stable replacement). Verified against
 * `@ohos.commonEventManager.d.ts` `export enum Support`. Members that DID get a
 * renamed successor (e.g. `..._CURRENT_DEVICE_UPDATE` -> `..._CONNECT_STATE_CHANGE`)
 * carry `@useinstead` and are NOT here — they're handled by the rename rules.
 * Only LEAF members are seeded; the `Support` container itself is left manual.
 */
const COMMON_EVENT_LITERALS: Record<string, string> = {
  COMMON_EVENT_USER_PRESENT: "'usual.event.USER_PRESENT'",
  COMMON_EVENT_BLUETOOTH_HANDSFREE_AG_CURRENT_DEVICE_UPDATE: "'usual.event.bluetooth.handsfree.ag.CURRENT_DEVICE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_HANDSFREE_AG_AUDIO_STATE_UPDATE: "'usual.event.bluetooth.handsfree.ag.AUDIO_STATE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_A2DPSOURCE_CURRENT_DEVICE_UPDATE: "'usual.event.bluetooth.a2dpsource.CURRENT_DEVICE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_A2DPSOURCE_PLAYING_STATE_UPDATE: "'usual.event.bluetooth.a2dpsource.PLAYING_STATE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_DISCOVERED: "'usual.event.bluetooth.remotedevice.DISCOVERED'",
  COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_CLASS_VALUE_UPDATE: "'usual.event.bluetooth.remotedevice.CLASS_VALUE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_NAME_UPDATE: "'usual.event.bluetooth.remotedevice.NAME_UPDATE'",
  COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_BATTERY_VALUE_UPDATE: "'usual.event.bluetooth.remotedevice.BATTERY_VALUE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_SDP_RESULT: "'usual.event.bluetooth.remotedevice.SDP_RESULT'",
  COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_UUID_VALUE: "'usual.event.bluetooth.remotedevice.UUID_VALUE'",
  COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_PAIRING_REQ: "'usual.event.bluetooth.remotedevice.PAIRING_REQ'",
  COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_PAIRING_CANCEL: "'usual.event.bluetooth.remotedevice.PAIRING_CANCEL'",
  COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_CONNECT_REQ: "'usual.event.bluetooth.remotedevice.CONNECT_REQ'",
  COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_CONNECT_REPLY: "'usual.event.bluetooth.remotedevice.CONNECT_REPLY'",
  COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_CONNECT_CANCEL: "'usual.event.bluetooth.remotedevice.CONNECT_CANCEL'",
  COMMON_EVENT_BLUETOOTH_HANDSFREEUNIT_CONNECT_STATE_UPDATE: "'usual.event.bluetooth.handsfreeunit.CONNECT_STATE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_HANDSFREEUNIT_AUDIO_STATE_UPDATE: "'usual.event.bluetooth.handsfreeunit.AUDIO_STATE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_HANDSFREEUNIT_AG_COMMON_EVENT: "'usual.event.bluetooth.handsfreeunit.AG_COMMON_EVENT'",
  COMMON_EVENT_BLUETOOTH_HANDSFREEUNIT_AG_CALL_STATE_UPDATE: "'usual.event.bluetooth.handsfreeunit.AG_CALL_STATE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_HOST_STATE_UPDATE: "'usual.event.bluetooth.host.STATE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_HOST_REQ_DISCOVERABLE: "'usual.event.bluetooth.host.REQ_DISCOVERABLE'",
  COMMON_EVENT_BLUETOOTH_HOST_REQ_ENABLE: "'usual.event.bluetooth.host.REQ_ENABLE'",
  COMMON_EVENT_BLUETOOTH_HOST_REQ_DISABLE: "'usual.event.bluetooth.host.REQ_DISABLE'",
  COMMON_EVENT_BLUETOOTH_HOST_SCAN_MODE_UPDATE: "'usual.event.bluetooth.host.SCAN_MODE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_HOST_DISCOVERY_STARTED: "'usual.event.bluetooth.host.DISCOVERY_STARTED'",
  COMMON_EVENT_BLUETOOTH_HOST_DISCOVERY_FINISHED: "'usual.event.bluetooth.host.DISCOVERY_FINISHED'",
  COMMON_EVENT_BLUETOOTH_HOST_NAME_UPDATE: "'usual.event.bluetooth.host.NAME_UPDATE'",
  COMMON_EVENT_BLUETOOTH_A2DPSINK_CONNECT_STATE_UPDATE: "'usual.event.bluetooth.a2dpsink.CONNECT_STATE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_A2DPSINK_PLAYING_STATE_UPDATE: "'usual.event.bluetooth.a2dpsink.PLAYING_STATE_UPDATE'",
  COMMON_EVENT_BLUETOOTH_A2DPSINK_AUDIO_STATE_UPDATE: "'usual.event.bluetooth.a2dpsink.AUDIO_STATE_UPDATE'",
};

const WANT_CONSTANT = "@ohos.ability.wantConstant";
const WANT_CONSTANT_NS = "wantConstant";
const COMMON_EVENT_MANAGER = "@ohos.commonEventManager";
const COMMON_EVENT_MANAGER_NS = "commonEventManager";
const ABILITY_ACCESS_CTRL = "@ohos.abilityAccessCtrl";
const ABILITY_ACCESS_CTRL_NS = "abilityAccessCtrl";

/**
 * Build a sub-table of literal-substitution overrides for one deprecated
 * container's enum members. Each entry maps the full
 * `${kit}\0${exportName}\0${container}.${member}` identity to its string
 * literal replacement. Only LEAF members are seeded — the container itself
 * (e.g. `wantConstant.Action` used as a type) is left manual, since a string
 * literal cannot stand in for a type reference.
 */
function literalSubTable(
  kit: string,
  exportName: string,
  container: string,
  literals: Record<string, string>,
): SymbolOverrideTable {
  const out: SymbolOverrideTable = {};
  for (const [member, literal] of Object.entries(literals)) {
    out[symbolOverrideKey(kit, exportName, [container, member])] = {
      replacement: literal,
      note: `use string literal (enum ${container} removed in successor kit; value was ${literal})`,
    };
  }
  return out;
}

/**
 * Same-kit instance-method renames whose SIGNATURE changed (param/return
 * type, arity) — `instanceSafe` only verifies the receiver type is preserved,
 * NOT that the call-site args still compile, so a blind `var.<newLeaf>` splice
 * breaks the call site. Each is `manual` (no splice — the deprecated API still
 * compiles, leave it for review) + `humanOnly` (don't send to the AI: the model
 * can't choose the now-required argument and would either guess a silent-wrong
 * value or trigger a file-level revert that takes down unrelated AI edits).
 *
 *   - `@ohos.abilityAccessCtrl` `AtManager.verifyAccessToken` ->
 *     `checkAccessToken`: param 2 tightened `string` -> `Permissions` (a
 *     literal union of permission-name strings). Verified against the SDK
 *     `@ohos.abilityAccessCtrl.d.ts` (both are instance methods on `AtManager`;
 *     `@useinstead ohos.abilityAccessCtrl.AtManager#checkAccessToken`). The
 *     map entry's `dep.exportName` is the namespace `abilityAccessCtrl` and
 *     `dep.members` is `[AtManager, verifyAccessToken]`, so the key uses that
 *     full chain (same convention as the wantConstant `[container, member]`
 *     literal entries).
 */
const MANUAL_SIGNATURE_CHANGES: SymbolOverrideTable = {
  [symbolOverrideKey(ABILITY_ACCESS_CTRL, ABILITY_ACCESS_CTRL_NS, ["AtManager", "verifyAccessToken"])]: {
    replacement: "checkAccessToken",
    note: "signature changed: param 2 type string -> Permissions; rename to checkAccessToken needs a human-chosen permission name (deprecated API still compiles — left for review)",
    manual: true,
    humanOnly: true,
  },
};

const BUILTIN: SymbolOverrideTable = {
  ...MANUAL_SIGNATURE_CHANGES,
  ...literalSubTable(WANT_CONSTANT, WANT_CONSTANT_NS, "Action", ACTION_LITERALS),
  ...literalSubTable(WANT_CONSTANT, WANT_CONSTANT_NS, "Entity", ENTITY_LITERALS),
  ...literalSubTable(COMMON_EVENT_MANAGER, COMMON_EVENT_MANAGER_NS, "Support", COMMON_EVENT_LITERALS),
};

/** The active table (builtin merged with any loaded JSON overrides). */
let active: SymbolOverrideTable = BUILTIN;

/** One entry in the JSON override file (NUL-free, human-readable form). */
export interface SymbolOverrideEntry {
  kit: string;
  exportName?: string;
  members?: string[];
  replacement: string;
  note: string;
  manual?: boolean;
  humanOnly?: boolean;
}

/**
 * Load a user-supplied JSON override file, merged OVER the builtin table (the
 * file wins on key collision, so callers can correct builtin entries). The
 * file is an ARRAY of `{ kit, exportName?, members?, replacement, note }`
 * entries — a structured form rather than a NUL-keyed object, because NUL
 * bytes are awkward to author in JSON. Each entry's identity is built with
 * `symbolOverrideKey` (NUL-joined internally) so lookup stays consistent with
 * the builtin table. Missing file -> builtin only. Returns the merged table.
 */
export function loadSymbolOverrides(path: string | undefined): SymbolOverrideTable {
  if (!path || !existsSync(path)) {
    active = BUILTIN;
    return active;
  }
  const entries = JSON.parse(readFileSync(path, "utf8")) as SymbolOverrideEntry[];
  const merged: SymbolOverrideTable = { ...BUILTIN };
  for (const e of entries) {
    merged[symbolOverrideKey(e.kit, e.exportName, e.members)] = {
      replacement: e.replacement,
      note: e.note,
      ...(e.manual ? { manual: true } : {}),
      ...(e.humanOnly ? { humanOnly: true } : {}),
    };
  }
  active = merged;
  return active;
}

/** @internal exposed for tests to restore the builtin table after a load. */
export function resetSymbolOverrides(): void {
  active = BUILTIN;
}

/**
 * Resolve a curated override for a deprecated symbol, or null when none.
 * The caller (member scanner) produces an `override` finding from the result;
 * null falls through to the structural rules / manual.
 */
export function findSymbolOverride(
  kit: string,
  exportName: string | undefined,
  members: string[] | undefined,
): SymbolOverride | null {
  return active[symbolOverrideKey(kit, exportName, members)] ?? null;
}
