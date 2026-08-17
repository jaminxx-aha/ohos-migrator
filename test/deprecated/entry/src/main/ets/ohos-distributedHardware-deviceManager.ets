import deviceManager from '@ohos.distributedHardware.deviceManager';

// Scenario: surface a legacy distributed device manager handle for a
// cross-device collaboration feature. The @ohos.distributedHardware.deviceManager
// module (and its DeviceManager interface) is deprecated since API 11 in favor
// of ohos.distributedDeviceManager, but legacy integrations still resolve a
// handle here before migrating.
type LegacyDeviceManager = deviceManager.DeviceManager;

async function acquireLegacyDeviceManager(): Promise<LegacyDeviceManager | null> {
  try {
    // The legacy module exposes no creation API in this SDK surface; the handle
    // is typed against the deprecated DeviceManager interface for compatibility.
    const dm: LegacyDeviceManager = {} as LegacyDeviceManager;
    console.info('deviceManager: legacy handle acquired', dm !== null);
    return dm;
  } catch (e) {
    console.error('deviceManager: acquire legacy handle failed', e);
    return null;
  }
}

async function runDeviceManagerScenario(): Promise<void> {
  const dm = await acquireLegacyDeviceManager();
  if (dm === null) {
    console.warn('deviceManager: no legacy handle; feature disabled');
    return;
  }
  console.info('deviceManager: legacy scenario complete');
}

runDeviceManagerScenario();
