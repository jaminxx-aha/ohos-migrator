import usbManager from '@ohos.usbManager';

let _v0: usbManager.USBControlParams;
declare let _v1: usbManager.USBControlParams; _v1.data;
declare let _v2: usbManager.USBControlParams; _v2.index;
declare let _v3: usbManager.USBControlParams; _v3.reqType;
declare let _v4: usbManager.USBControlParams; _v4.request;
declare let _v5: usbManager.USBControlParams; _v5.target;
declare let _v6: usbManager.USBControlParams; _v6.value;
// usbManager.controlTransfer({ busNum: 0, devAddress: 0 }, { request: 0, target: usbManager.USBRequestTargetType.USB_REQUEST_TARGET_DEVICE, reqType: usbManager.USBControlRequestType.USB_REQUEST_TYPE_STANDARD, value: 0, index: 0, data: new Uint8Array(0) });  // omitted: would not compile (2304)
