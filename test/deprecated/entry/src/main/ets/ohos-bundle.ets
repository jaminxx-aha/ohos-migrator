import bundle from '@ohos.bundle';

// --- Enum classifiers (bundle module enums, all @deprecated since 9) ---

function describeAbilityType(type: bundle.AbilityType): string {
  switch (type) {
    case bundle.AbilityType.PAGE: return 'page (UI ability)';
    case bundle.AbilityType.DATA: return 'data-share ability';
    case bundle.AbilityType.SERVICE: return 'background service ability';
    case bundle.AbilityType.UNKNOWN: return 'unknown ability kind';
    default: return 'other';
  }
}

function describeAbilitySubType(sub: bundle.AbilitySubType): string {
  switch (sub) {
    case bundle.AbilitySubType.CA: return 'capability template';
    case bundle.AbilitySubType.UNSPECIFIED: return 'unspecified subtype';
    default: return 'other';
  }
}

function describeOrientation(o: bundle.DisplayOrientation): string {
  switch (o) {
    case bundle.DisplayOrientation.PORTRAIT: return 'portrait';
    case bundle.DisplayOrientation.LANDSCAPE: return 'landscape';
    case bundle.DisplayOrientation.FOLLOW_RECENT: return 'follow recent';
    case bundle.DisplayOrientation.UNSPECIFIED: return 'unspecified';
    default: return 'other';
  }
}

function describeColorMode(mode: bundle.ColorMode): string {
  switch (mode) {
    case bundle.ColorMode.LIGHT_MODE: return 'light';
    case bundle.ColorMode.DARK_MODE: return 'dark';
    case bundle.ColorMode.AUTO_MODE: return 'auto';
    default: return 'other';
  }
}

function describeLaunchMode(mode: bundle.LaunchMode): string {
  switch (mode) {
    case bundle.LaunchMode.SINGLETON: return 'singleton';
    case bundle.LaunchMode.STANDARD: return 'standard';
    default: return 'other';
  }
}

function describeGrantStatus(status: bundle.GrantStatus): string {
  switch (status) {
    case bundle.GrantStatus.PERMISSION_GRANTED: return 'granted';
    case bundle.GrantStatus.PERMISSION_DENIED: return 'denied';
    default: return 'unknown';
  }
}

function interpretInstallError(code: bundle.InstallErrorCode): string {
  switch (code) {
    case bundle.InstallErrorCode.SUCCESS: return 'success';
    case bundle.InstallErrorCode.STATUS_INSTALL_FAILURE: return 'install failure';
    case bundle.InstallErrorCode.STATUS_INSTALL_FAILURE_ABORTED: return 'install aborted';
    case bundle.InstallErrorCode.STATUS_INSTALL_FAILURE_CONFLICT: return 'install conflict';
    case bundle.InstallErrorCode.STATUS_INSTALL_FAILURE_DOWNLOAD_FAILED: return 'download failed';
    case bundle.InstallErrorCode.STATUS_INSTALL_FAILURE_DOWNLOAD_TIMEOUT: return 'download timeout';
    case bundle.InstallErrorCode.STATUS_INSTALL_FAILURE_INCOMPATIBLE: return 'incompatible';
    case bundle.InstallErrorCode.STATUS_INSTALL_FAILURE_INVALID: return 'invalid package';
    case bundle.InstallErrorCode.STATUS_INSTALL_FAILURE_STORAGE: return 'storage failure';
    case bundle.InstallErrorCode.STATUS_INSTALL_PERMISSION_DENIED: return 'install permission denied';
    case bundle.InstallErrorCode.STATUS_UNINSTALL_FAILURE: return 'uninstall failure';
    case bundle.InstallErrorCode.STATUS_UNINSTALL_FAILURE_ABORTED: return 'uninstall aborted';
    case bundle.InstallErrorCode.STATUS_UNINSTALL_FAILURE_BLOCKED: return 'uninstall blocked';
    case bundle.InstallErrorCode.STATUS_UNINSTALL_FAILURE_CONFLICT: return 'uninstall conflict';
    case bundle.InstallErrorCode.STATUS_UNINSTALL_PERMISSION_DENIED: return 'uninstall permission denied';
    case bundle.InstallErrorCode.STATUS_ABILITY_NOT_FOUND: return 'ability not found';
    case bundle.InstallErrorCode.STATUS_BMS_SERVICE_ERROR: return 'bms service error';
    case bundle.InstallErrorCode.STATUS_FAILED_NO_SPACE_LEFT: return 'no space left';
    case bundle.InstallErrorCode.STATUS_GRANT_REQUEST_PERMISSIONS_FAILED: return 'grant permissions failed';
    case bundle.InstallErrorCode.STATUS_RECOVER_FAILURE_INVALID: return 'recover failure invalid';
    default: return 'unknown install error';
  }
}

function listBundleFlags(): bundle.BundleFlag[] {
  return [
    bundle.BundleFlag.GET_BUNDLE_DEFAULT,
    bundle.BundleFlag.GET_BUNDLE_WITH_ABILITIES,
    bundle.BundleFlag.GET_BUNDLE_WITH_REQUESTED_PERMISSION,
    bundle.BundleFlag.GET_ALL_APPLICATION_INFO,
    bundle.BundleFlag.GET_APPLICATION_INFO_WITH_DISABLE,
    bundle.BundleFlag.GET_APPLICATION_INFO_WITH_METADATA,
    bundle.BundleFlag.GET_APPLICATION_INFO_WITH_PERMISSION,
    bundle.BundleFlag.GET_ABILITY_INFO_SYSTEMAPP_ONLY,
    bundle.BundleFlag.GET_ABILITY_INFO_WITH_APPLICATION,
    bundle.BundleFlag.GET_ABILITY_INFO_WITH_DISABLE,
    bundle.BundleFlag.GET_ABILITY_INFO_WITH_METADATA,
    bundle.BundleFlag.GET_ABILITY_INFO_WITH_PERMISSION,
  ];
}

// --- Async bundle queries (function APIs, all @deprecated since 9) ---

async function fetchBundleOverview(bundleName: string, hapPath: string, uid: number): Promise<void> {
  const options: bundle.BundleOptions = { userId: 100 };
  const targetUser = options.userId; // exercises deprecated BundleOptions.userId
  try {
    await bundle.getBundleInfo(bundleName, bundle.BundleFlag.GET_BUNDLE_DEFAULT, options);
    await bundle.getApplicationInfo(
      bundleName,
      bundle.BundleFlag.GET_APPLICATION_INFO_WITH_PERMISSION,
      targetUser,
    );
    const allBundles = await bundle.getAllBundleInfo(bundle.BundleFlag.GET_BUNDLE_WITH_ABILITIES);
    const allApps = await bundle.getAllApplicationInfo(bundle.BundleFlag.GET_ALL_APPLICATION_INFO, targetUser);
    await bundle.getBundleArchiveInfo(hapPath, bundle.BundleFlag.GET_BUNDLE_WITH_REQUESTED_PERMISSION);
    const launchWant = await bundle.getLaunchWantForBundle(bundleName);
    const uidName = await bundle.getNameForUid(uid);
    console.info(
      `bundle=${bundleName} appCount=${allApps.length} allBundles=${allBundles.length}` +
        ` wantAction=${launchWant.action ?? ''} uidName=${uidName}`,
    );
  } catch (e) {
    console.error('fetchBundleOverview failed', e);
  }
}

async function fetchAbilityMetadata(bundleName: string, abilityName: string): Promise<void> {
  try {
    const info = await bundle.getAbilityInfo(bundleName, abilityName);
    const label = await bundle.getAbilityLabel(bundleName, abilityName);
    const icon = await bundle.getAbilityIcon(bundleName, abilityName);
    const appEnabled = await bundle.isApplicationEnabled(bundleName);
    const abilityEnabled = await bundle.isAbilityEnabled(info);
    const matches = await bundle.queryAbilityByWant(
      { action: 'ohos.want.action.home' } as Record<string, string>,
      bundle.BundleFlag.GET_ABILITY_INFO_WITH_METADATA,
      100,
    );
    console.info(
      `ability=${abilityName} label=${label} icon=${icon ? 'ok' : 'none'} appEnabled=${appEnabled}` +
        ` abilityEnabled=${abilityEnabled} matches=${matches.length}`,
    );
  } catch (e) {
    console.error('fetchAbilityMetadata failed', e);
  }
}

async function run(): Promise<void> {
  console.info(describeAbilityType(bundle.AbilityType.PAGE));
  console.info(describeAbilitySubType(bundle.AbilitySubType.UNSPECIFIED));
  console.info(describeOrientation(bundle.DisplayOrientation.PORTRAIT));
  console.info(describeColorMode(bundle.ColorMode.LIGHT_MODE));
  console.info(describeLaunchMode(bundle.LaunchMode.STANDARD));
  console.info(describeGrantStatus(bundle.GrantStatus.PERMISSION_GRANTED));
  console.info(interpretInstallError(bundle.InstallErrorCode.STATUS_INSTALL_FAILURE_CONFLICT));
  console.info(`bundleFlags=${JSON.stringify(listBundleFlags())}`);
  await fetchBundleOverview('com.example.demo', '/data/storage/el2/haps/entry/entry.hap', 9999);
  await fetchAbilityMetadata('com.example.demo', 'EntryAbility');
}

run().catch((e) => console.error('bundle probe run failed', e));
