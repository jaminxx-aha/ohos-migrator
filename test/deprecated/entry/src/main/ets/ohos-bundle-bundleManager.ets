import bundleManager from '@ohos.bundle.bundleManager';

/**
 * Read the calling app's own metadata map (e.g. customize-data declared in
 * module.json5) so a feature module can branch on configured flags.
 */
async function readSelfApplicationMetadata(): Promise<void> {
  try {
    const flag: number =
      bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT |
      bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION;
    const info: bundleManager.BundleInfo =
      await bundleManager.getBundleInfoForSelf(flag);
    const appInfo: bundleManager.ApplicationInfo = info.appInfo;

    // legacy per-module metadata map (deprecated since 10; prefer metadataArray)
    const meta: Map<string, Array<bundleManager.Metadata>> = appInfo.metadata;
    meta.forEach((entries, moduleName) => {
      console.info(`module ${moduleName} declares ${entries.length} metadata entries`);
    });
  } catch (e) {
    console.error('readSelfApplicationMetadata failed', e);
  }
}

async function run(): Promise<void> {
  await readSelfApplicationMetadata();
}

run();
