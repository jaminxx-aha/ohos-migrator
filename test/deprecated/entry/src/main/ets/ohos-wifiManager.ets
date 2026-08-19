import wifiManager from '@ohos.wifiManager';

// Scenario: discover nearby Wi-Fi hotspots and read the scan results.

async function discoverNearbyHotspots(): Promise<void> {
  // Trigger a Wi-Fi scan (deprecated since 10 -> wifiManager.startScan).
  wifiManager.scan();

  // Async path: obtain scanned hotspot list as a promise.
  try {
    const results = await wifiManager.getScanResults();
    console.info('scan results count: ' + results.length);
  } catch (e) {
    console.error('getScanResults failed', e);
  }

  // Sync path: obtain the same list synchronously.
  try {
    const syncResults = wifiManager.getScanResultsSync();
    console.info('sync scan results count: ' + syncResults.length);
  } catch (e) {
    console.error('getScanResultsSync failed', e);
  }
}

async function run(): Promise<void> {
  await discoverNearbyHotspots();
}

run();
