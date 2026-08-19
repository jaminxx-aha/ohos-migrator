import inputDevice from '@ohos.multimodalInput.inputDevice';

// Scenario: enumerate all connected input devices and inspect each one's
// capabilities (e.g. to decide which touchscreens / keyboards are available).

async function listInputDeviceIds(): Promise<Array<number>> {
  try {
    const ids: Array<number> = await inputDevice.getDeviceIds();
    console.info(`inputDevice.getDeviceIds returned ${ids.length} device(s)`);
    return ids;
  } catch (e) {
    console.error('Failed to list input device ids', e);
    return [];
  }
}

async function inspectInputDevice(deviceId: number): Promise<void> {
  try {
    const device = await inputDevice.getDevice(deviceId);
    console.info(
      `inputDevice.getDevice id=${deviceId} name=${device.name} sources=${JSON.stringify(device.sources)}`
    );
  } catch (e) {
    console.error(`Failed to inspect input device ${deviceId}`, e);
  }
}

async function run(): Promise<void> {
  const ids = await listInputDeviceIds();
  for (const id of ids) {
    await inspectInputDevice(id);
  }
}

run();
