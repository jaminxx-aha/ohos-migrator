import power from '@ohos.power';

// Scenario: device power-state inspection and recovery reboot.
// Uses the legacy (pre-API 9) power APIs while migrating toward power#isActive / power#reboot.

async function checkScreenOn(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      power.isScreenOn((err: Error, on: boolean) => {
        if (err) {
          console.error('isScreenOn failed', err);
          reject(err);
          return;
        }
        resolve(on);
      });
    } catch (e) {
      console.error('isScreenOn threw', e);
      reject(e as Error);
    }
  });
}

function rebootForRecovery(reason: string): void {
  try {
    power.rebootDevice(reason);
  } catch (e) {
    console.error('rebootDevice failed', e);
  }
}

async function run(): Promise<void> {
  const screenOn = await checkScreenOn();
  console.info('screen on:', screenOn);

  // Trigger a recovery reboot for the updater flow.
  rebootForRecovery('updater');
}

run();
