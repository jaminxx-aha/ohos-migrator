import wifiext from '@ohos.wifiext';

// Scenario: manage a Wi-Fi hotspot's power model lifecycle on a HarmonyOS device.

async function applyOptimalPowerModel(): Promise<void> {
  try {
    const supported: Array<wifiext.PowerModel> = await wifiext.getSupportedPowerModel();
    const current: wifiext.PowerModel = await wifiext.getPowerModel();
    console.info('supported power models: ' + supported.length + ', current: ' + current);

    // Prefer the through-wall model for maximum coverage when available.
    let target: wifiext.PowerModel = wifiext.PowerModel.GENERAL;
    if (supported.indexOf(wifiext.PowerModel.THROUGH_WALL) >= 0) {
      target = wifiext.PowerModel.THROUGH_WALL;
    } else if (supported.indexOf(wifiext.PowerModel.SLEEPING) >= 0) {
      target = wifiext.PowerModel.SLEEPING;
    }

    const ok: boolean = wifiext.setPowerModel(target);
    if (!ok) {
      console.error('failed to set power model ' + target);
    }
  } catch (e) {
    console.error('applyOptimalPowerModel failed', e);
  }
}

async function restartHotspot(): Promise<void> {
  try {
    const disabled: boolean = wifiext.disableHotspot();
    if (!disabled) {
      console.error('disableHotspot returned false');
      return;
    }
    const enabled: boolean = wifiext.enableHotspot();
    if (!enabled) {
      console.error('enableHotspot returned false');
    }
  } catch (e) {
    console.error('restartHotspot failed', e);
  }
}

async function run(): Promise<void> {
  await applyOptimalPowerModel();
  await restartHotspot();
}

run();
