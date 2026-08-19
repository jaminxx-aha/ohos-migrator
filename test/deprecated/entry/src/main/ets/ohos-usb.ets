import usb from '@ohos.usb';

// Scenario: enumerate attached USB devices, ensure the app holds access rights,
// open a pipe to the first device, walk its configuration/interface/endpoint
// descriptors, set the active configuration + interface, claim/release the
// interface, fetch the kernel file descriptor and raw descriptor, then close
// the pipe. A helper also builds and inspects a USBControlParams descriptor
// (and the request-direction / target / request-type enums) so the deprecated
// descriptor surface is exercised at runtime even though the actual transfer
// is performed through the non-deprecated usbManager path elsewhere.

interface DeviceSummary {
  vendorId: number;
  productId: number;
  name: string;
  manufacturerName: string;
  productName: string;
  version: string;
  serial: string;
  busNum: number;
  devAddress: number;
  clazz: number;
  subClass: number;
  protocol: number;
}

function summarizeDevice(dev: usb.USBDevice): DeviceSummary {
  return {
    vendorId: dev.vendorId,
    productId: dev.productId,
    name: dev.name,
    manufacturerName: dev.manufacturerName,
    productName: dev.productName,
    version: dev.version,
    serial: dev.serial,
    busNum: dev.busNum,
    devAddress: dev.devAddress,
    clazz: dev.clazz,
    subClass: dev.subClass,
    protocol: dev.protocol,
  };
}

function describeConfig(cfg: usb.USBConfig): string {
  const ifaceList = cfg.interfaces.map(iface => {
    const epList = iface.endpoints.map(ep => {
      const dir =
        ep.direction === usb.USBRequestDirection.USB_REQUEST_DIR_FROM_DEVICE
          ? 'IN'
          : usb.USBRequestDirection.USB_REQUEST_DIR_TO_DEVICE
            ? 'OUT'
            : '?';
      return `ep#${ep.number}(addr=${ep.address} type=${ep.type} iface=${ep.interfaceId} attrs=${ep.attributes} interval=${ep.interval} max=${ep.maxPacketSize} dir=${dir})`;
    });
    return `iface#${iface.id}(alt=${iface.alternateSetting} cls=${iface.clazz}/${iface.subClass}/${iface.protocol} name="${iface.name}" [${epList.join(', ')}])`;
  });
  return `cfg#${cfg.id}(name="${cfg.name}" attrs=${cfg.attributes} maxPower=${cfg.maxPower}mA selfPowered=${cfg.isSelfPowered} remoteWakeup=${cfg.isRemoteWakeup} [${ifaceList.join(', ')}])`;
}

// Builds the control-transfer descriptor used to read a USB device descriptor
// (standard GET_DESCRIPTOR request to the device target) and reports each
// field so the deprecated USBControlParams surface is exercised at runtime.
function buildDeviceDescriptorControlParams(): usb.USBControlParams {
  const params: usb.USBControlParams = {
    request: 0x06, // GET_DESCRIPTOR
    target: usb.USBRequestTargetType.USB_REQUEST_TARGET_DEVICE,
    reqType: usb.USBControlRequestType.USB_REQUEST_TYPE_STANDARD,
    value: 0x0100, // descriptor type = device, index 0
    index: 0,
    data: new Uint8Array(18),
  };
  // Reference each field so they are resolved by the compiler.
  const reqTypeLabel =
    params.reqType === usb.USBControlRequestType.USB_REQUEST_TYPE_STANDARD
      ? 'standard'
      : params.reqType === usb.USBControlRequestType.USB_REQUEST_TYPE_CLASS
        ? 'class'
        : params.reqType === usb.USBControlRequestType.USB_REQUEST_TYPE_VENDOR
          ? 'vendor'
          : 'unknown';
  const targetLabel =
    params.target === usb.USBRequestTargetType.USB_REQUEST_TARGET_DEVICE
      ? 'device'
      : params.target === usb.USBRequestTargetType.USB_REQUEST_TARGET_INTERFACE
        ? 'interface'
        : params.target === usb.USBRequestTargetType.USB_REQUEST_TARGET_ENDPOINT
          ? 'endpoint'
          : usb.USBRequestTargetType.USB_REQUEST_TARGET_OTHER
            ? 'other'
            : 'unknown';
  console.info(
    `controlParams request=${params.request} reqType=${reqTypeLabel} target=${targetLabel} value=${params.value} index=${params.index} data.len=${params.data.length}`,
  );
  return params;
}

async function ensureDeviceRight(deviceName: string): Promise<boolean> {
  if (usb.hasRight(deviceName)) {
    return true;
  }
  try {
    const granted = await usb.requestRight(deviceName);
    return granted;
  } catch (e) {
    console.error('requestRight failed', e);
    return false;
  }
}

async function openFirstDevice(): Promise<void> {
  const devices = usb.getDevices();
  if (devices.length === 0) {
    console.info('no USB devices attached');
    return;
  }
  const device = devices[0];
  const summary = summarizeDevice(device);
  console.info('attached device', JSON.stringify(summary));

  const hasRight = await ensureDeviceRight(device.name);
  if (!hasRight) {
    console.error('USB access right denied for', device.name);
    return;
  }

  const pipe = usb.connectDevice(device);
  console.info(`pipe busNum=${pipe.busNum} devAddress=${pipe.devAddress}`);

  // Walk configuration/interface/endpoint descriptors.
  for (const cfg of device.configs) {
    console.info(describeConfig(cfg));
  }

  try {
    const activeConfig = device.configs[0];
    const setCfgRet = usb.setConfiguration(pipe, activeConfig);
    if (setCfgRet !== 0) {
      console.error('setConfiguration failed', setCfgRet);
    }

    const iface = activeConfig.interfaces[0];
    const setIfaceRet = usb.setInterface(pipe, iface);
    if (setIfaceRet !== 0) {
      console.error('setInterface failed', setIfaceRet);
    }

    const claimRet = usb.claimInterface(pipe, iface, true);
    if (claimRet !== 0) {
      console.error('claimInterface failed', claimRet);
    }

    const fd = usb.getFileDescriptor(pipe);
    console.info('file descriptor', fd);

    const raw = usb.getRawDescriptor(pipe);
    console.info('raw descriptor length', raw.length);

    const releaseRet = usb.releaseInterface(pipe, iface);
    if (releaseRet !== 0) {
      console.error('releaseInterface failed', releaseRet);
    }
  } catch (e) {
    console.error('device transfer failed', e);
  } finally {
    const closeRet = usb.closePipe(pipe);
    if (closeRet !== 0) {
      console.error('closePipe failed', closeRet);
    }
  }
}

async function run(): Promise<void> {
  buildDeviceDescriptorControlParams();
  await openFirstDevice();
}

run();
