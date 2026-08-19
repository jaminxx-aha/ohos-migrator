import wifiManagerExt from '@ohos.wifiManagerExt';

// Scenario: provisionally power down the Wi-Fi hotspot radio for maintenance,
// then bring it back up into a low-power sleeping state.

async function performHotspotMaintenance(): Promise<void> {
  try {
    wifiManagerExt.disableHotspot();
  } catch (e) {
    console.error('Failed to disable Wi-Fi hotspot during maintenance', e);
  }

  try {
    wifiManagerExt.setPowerMode(wifiManagerExt.PowerMode.SLEEPING);
  } catch (e) {
    console.error('Failed to set sleeping power mode', e);
  }

  try {
    wifiManagerExt.enableHotspot();
  } catch (e) {
    console.error('Failed to re-enable Wi-Fi hotspot after maintenance', e);
  }
}

async function run(): Promise<void> {
  await performHotspotMaintenance();
}

run();
