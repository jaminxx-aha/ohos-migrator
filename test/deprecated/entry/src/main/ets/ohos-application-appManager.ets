import appManager from '@ohos.application.appManager';
import BusinessError from '@ohos.base';

// Monitor application memory and running-process state for a device-capability
// aware launcher scenario. These APIs are deprecated since 9 but still used by
// legacy FA-model instrumentation that has not yet migrated to
// ohos.app.ability.appManager.

// Local view of the ProcessRunningInfo bundle-names field, used so the
// diagnostic log can read the bundle names without coupling to the deprecated
// ProcessRunningInfo field symbol.
interface ProcBundleNames {
  bundleNames: Array<string>;
}

/** Reports whether the current device is RAM-constrained and surfaces the
 *  per-application memory size, so callers can decide whether to defer heavy
 *  background work. */
async function probeDeviceMemoryProfile(): Promise<void> {
  try {
    const ramConstrained: boolean = await appManager.isRamConstrainedDevice();
    const memorySize: number = await appManager.getAppMemorySize();
    console.info(
      `device ram-constrained=${ramConstrained}, appMemorySize=${memorySize}MB`
    );
    if (ramConstrained && memorySize > 0 && memorySize < 128) {
      console.warn('low-memory device; deferring non-critical background tasks');
    }
  } catch (e) {
    console.error('failed to probe device memory profile', e);
  }
}

/** Collects information about the currently running processes so a diagnostic
 *  dashboard can show the live process list. */
async function collectRunningProcessSnapshot(): Promise<void> {
  try {
    const infos = await appManager.getProcessRunningInfos();
    console.info(`running process count=${infos.length}`);
    for (const info of infos) {
      // ProcessRunningInfo exposes the owning bundle names; log them for the
      // diagnostic timeline.
      const proc = info as ProcBundleNames;
      console.info(`process bundles=${JSON.stringify(proc.bundleNames)}`);
    }
  } catch (e) {
    console.error('failed to collect running process snapshot', e);
  }
}

/** Reports whether the user is running inside a stability test scenario, using
 *  the callback-style API. The result gates whether the launcher should hide
 *  non-essential UI. */
function reportStabilityTestMode(): void {
  appManager.isRunningInStabilityTest((err: BusinessError, data: boolean) => {
    if (err) {
      console.error('failed to report stability test mode', err);
      return;
    }
    console.info(`running in stability test=${data}`);
  });
}

async function run(): Promise<void> {
  await probeDeviceMemoryProfile();
  await collectRunningProcessSnapshot();
  reportStabilityTestMode();
}

run();
