import cardEmulation from '@ohos.nfc.cardEmulation';

// Probe device NFC card-emulation capability across HCE / UICC / eSE feature types.
async function probeCardEmulationCapability(): Promise<void> {
  const hceSupported: boolean = cardEmulation.isSupported(cardEmulation.FeatureType.HCE);
  const uiccSupported: boolean = cardEmulation.isSupported(cardEmulation.FeatureType.UICC);
  const eseSupported: boolean = cardEmulation.isSupported(cardEmulation.FeatureType.ESE);
  console.info(`nfc cardEmulation capability: HCE=${hceSupported}, UICC=${uiccSupported}, ESE=${eseSupported}`);
}

// Emulate a payment app: register AIDs, answer an APDU, then tear down HCE.
async function emulatePaymentCard(): Promise<void> {
  const hceService: cardEmulation.HceService = new cardEmulation.HceService();
  try {
    const paymentAids: string[] = ['A0000000041010', 'A0000000042200'];
    const started: boolean = hceService.startHCE(paymentAids);
    if (!started) {
      console.error('startHCE returned false; HCE not enabled');
      return;
    }

    // SELECT APDU response: success (0x90 0x00).
    const responseApdu: number[] = [0x90, 0x00];
    hceService.sendResponse(responseApdu);
  } catch (e) {
    console.error('payment card emulation failed', e);
  } finally {
    try {
      const stopped: boolean = hceService.stopHCE();
      console.info(`stopHCE result: ${stopped}`);
    } catch (e) {
      console.error('stopHCE failed', e);
    }
  }
}

async function run(): Promise<void> {
  await probeCardEmulationCapability();
  await emulatePaymentCard();
}

run();
