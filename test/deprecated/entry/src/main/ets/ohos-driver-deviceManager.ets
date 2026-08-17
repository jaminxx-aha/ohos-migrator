import deviceManager from '@ohos.driver.deviceManager';

deviceManager.bindDevice(0, () => {});
deviceManager.bindDeviceDriver(0, () => {});
deviceManager.unbindDevice(0);
