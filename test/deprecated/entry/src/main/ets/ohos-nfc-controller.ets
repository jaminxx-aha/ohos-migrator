import nfcController from '@ohos.nfc.controller';

// Scenario: gate NFC on boarding for a contactless payment feature.
// Probe the (deprecated) legacy controller API surface so the migration to
// enableNfc/disableNfc can be validated against device capability.

async function ensureNfcReadyForPayment(): Promise<boolean> {
  // 1. Check device capability first.
  const supported: boolean = nfcController.isNfcAvailable();
  if (!supported) {
    console.error('NFC not available on this device; contactless payment disabled');
    return false;
  }

  // 2. Open NFC so tag polling is active.
  let opened: boolean = false;
  try {
    opened = nfcController.openNfc();
  } catch (e) {
    console.error('openNfc failed', e);
    opened = false;
  }
  if (!opened) {
    console.error('Failed to enable NFC for contactless payment');
    return false;
  }
  return true;
}

async function teardownNfc(): Promise<void> {
  // 3. On exit, disable NFC to restore prior power state.
  try {
    const closed: boolean = nfcController.closeNfc();
    if (!closed) {
      console.error('closeNfc reported it could not disable NFC');
    }
  } catch (e) {
    console.error('closeNfc failed', e);
  }
}

async function run(): Promise<void> {
  const ready = await ensureNfcReadyForPayment();
  if (ready) {
    // ... perform contactless payment / tag read ...
    await teardownNfc();
  }
}

run();
