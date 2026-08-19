import deviceManager from '@ohos.driver.deviceManager';
import rpc from '@ohos.rpc';
import BusinessError from '@ohos.base';

// Scenario: discover an external USB device, bind it (legacy APIs), then unbind it.

interface BoundDeviceResult {
  deviceId: number;
  remote: rpc.IRemoteObject;
}

function pickUsbDeviceId(): number {
  const devices = deviceManager.queryDevices(deviceManager.BusType.USB);
  if (devices.length === 0) {
    console.error('No external USB devices found');
    return -1;
  }
  const target = devices[0];
  console.info(`Found device id=${target.deviceId} (${target.description})`);
  return target.deviceId;
}

function bindLegacyDevice(deviceId: number): Promise<BoundDeviceResult> {
  return new Promise((resolve, reject) => {
    const onDisconnect = (err: BusinessError, data: number) => {
      if (err) { console.error('device disconnect error', err); return; }
      console.info(`Device ${data} disconnected`);
    };
    deviceManager.bindDevice(deviceId, onDisconnect, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function bindLegacyDeviceDriver(deviceId: number): Promise<deviceManager.RemoteDeviceDriver> {
  return new Promise((resolve, reject) => {
    const onDisconnect = (err: BusinessError, data: number) => {
      if (err) { console.error('driver disconnect error', err); return; }
      console.info(`Driver for device ${data} disconnected`);
    };
    deviceManager.bindDeviceDriver(deviceId, onDisconnect, (err, driver) => {
      if (err) {
        reject(err);
      } else {
        resolve(driver);
      }
    });
  });
}

function unbindLegacyDevice(deviceId: number): Promise<number> {
  return new Promise((resolve, reject) => {
    deviceManager.unbindDevice(deviceId, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

async function provisionExternalDevice(): Promise<void> {
  const deviceId = pickUsbDeviceId();
  if (deviceId < 0) {
    return;
  }

  try {
    const bound = await bindLegacyDevice(deviceId);
    console.info(`Bound device ${bound.deviceId} via bindDevice`);
  } catch (e) {
    console.error('bindDevice failed', e);
  }

  try {
    const driver = await bindLegacyDeviceDriver(deviceId);
    console.info(`Bound driver for device ${driver.deviceId} via bindDeviceDriver`);
  } catch (e) {
    console.error('bindDeviceDriver failed', e);
  }

  try {
    const result = await unbindLegacyDevice(deviceId);
    console.info(`Unbound device, result=${result}`);
  } catch (e) {
    console.error('unbindDevice failed', e);
  }
}

provisionExternalDevice();
