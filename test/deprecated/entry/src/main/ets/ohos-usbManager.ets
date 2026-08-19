import usbManager from '@ohos.usbManager';

// Build and validate a USB control-transfer parameter block for a standard
// GET_DESCRIPTOR request to a device. The USBControlParams fields are all
// deprecated since API 18 in favor of USBDeviceRequestParams, but are still
// required to talk to older devices on this OS version.

function buildDescriptorRequest(): usbManager.USBControlParams {
  const params: usbManager.USBControlParams = {
    request: 0x06, // USB standard request: GET_DESCRIPTOR
    target: usbManager.USBRequestTargetType.USB_REQUEST_TARGET_DEVICE,
    reqType: usbManager.USBControlRequestType.USB_REQUEST_TYPE_STANDARD,
    value: 0x0100, // descriptor type=DEVICE (0x01), index=0
    index: 0,
    data: new Uint8Array(18), // buffer for an 18-byte device descriptor
  };
  return params;
}

// Read each deprecated USBControlParams field exactly once, validate it,
// and return a one-line summary. Returns null if validation fails.
function inspectControlParams(params: usbManager.USBControlParams): string | null {
  const request = params.request;
  const target = params.target;
  const reqType = params.reqType;
  const value = params.value;
  const index = params.index;
  const data = params.data;

  if (data.byteLength < 18) {
    console.error('usbManager: descriptor buffer too small');
    return null;
  }
  if (reqType !== usbManager.USBControlRequestType.USB_REQUEST_TYPE_STANDARD) {
    console.error('usbManager: GET_DESCRIPTOR must use a standard request type');
    return null;
  }
  if (target !== usbManager.USBRequestTargetType.USB_REQUEST_TARGET_DEVICE) {
    console.error('usbManager: GET_DESCRIPTOR must target the device');
    return null;
  }
  if (request !== 0x06) {
    console.error('usbManager: expected GET_DESCRIPTOR (0x06) request code');
    return null;
  }
  return [
    `request=0x${request.toString(16)}`,
    `target=${target}`,
    `reqType=${reqType}`,
    `value=0x${value.toString(16)}`,
    `index=${index}`,
    `data.length=${data.length}`,
  ].join(' ');
}

async function run(): Promise<void> {
  const devices: Array<usbManager.USBDevice> = usbManager.getDevices();
  if (devices.length === 0) {
    console.info('usbManager: no USB devices attached');
    return;
  }
  const dev = devices[0];
  console.info(`usbManager: preparing descriptor read for bus=${dev.busNum} dev=${dev.devAddress}`);
  const params = buildDescriptorRequest();
  const summary = inspectControlParams(params);
  if (summary === null) {
    return;
  }
  console.info(`usbManager: ready to transfer [${summary}]`);
}

run();
