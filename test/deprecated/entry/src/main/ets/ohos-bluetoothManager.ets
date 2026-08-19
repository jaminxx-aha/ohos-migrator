import bluetoothManager from '@ohos.bluetoothManager';
import BusinessError from '@ohos.base';

// Realistic device/UUID constants used across the scenarios below.
const HEADSET_ADDR = '11:22:33:44:55:66';
const SPEAKER_ADDR = 'AA:BB:CC:DD:EE:FF';
const HID_ADDR = '00:11:22:33:44:55';
const PHONE_ADDR = '55:66:77:88:99:AA';
const HRS_SERVICE_UUID = '0000180D-0000-1000-8000-00805F9B34FB';
const HRS_MEASUREMENT_UUID = '00002A37-0000-1000-8000-00805F9B34FB';
const CCC_DESCRIPTOR_UUID = '00002902-0000-1000-8000-00805F9B34FB';
const SPP_UUID = '00001101-0000-1000-8000-00805F9B34FB';
const MANUFACTURER_ID = 0x0001;
const SERVER_SOCKET = 42;
const CLIENT_SOCKET = 7;

// ---------------------------------------------------------------------------
// Scenario: enumerate every deprecated enum constant exported by the module.
// Each constant is referenced in value position so the compiler resolves it.
// ---------------------------------------------------------------------------
function collectDeprecatedConstants(): void {
  const btStates = [
    bluetoothManager.BluetoothState.STATE_OFF,
    bluetoothManager.BluetoothState.STATE_TURNING_ON,
    bluetoothManager.BluetoothState.STATE_ON,
    bluetoothManager.BluetoothState.STATE_TURNING_OFF,
    bluetoothManager.BluetoothState.STATE_BLE_TURNING_ON,
    bluetoothManager.BluetoothState.STATE_BLE_ON,
    bluetoothManager.BluetoothState.STATE_BLE_TURNING_OFF,
  ];
  const bondStates = [
    bluetoothManager.BondState.BOND_STATE_INVALID,
    bluetoothManager.BondState.BOND_STATE_BONDING,
    bluetoothManager.BondState.BOND_STATE_BONDED,
  ];
  const playingStates = [
    bluetoothManager.PlayingState.STATE_NOT_PLAYING,
    bluetoothManager.PlayingState.STATE_PLAYING,
  ];
  const profileConnStates = [
    bluetoothManager.ProfileConnectionState.STATE_DISCONNECTED,
    bluetoothManager.ProfileConnectionState.STATE_CONNECTING,
    bluetoothManager.ProfileConnectionState.STATE_CONNECTED,
    bluetoothManager.ProfileConnectionState.STATE_DISCONNECTING,
  ];
  const profileIds = [
    bluetoothManager.ProfileId.PROFILE_A2DP_SOURCE,
    bluetoothManager.ProfileId.PROFILE_HANDS_FREE_AUDIO_GATEWAY,
    bluetoothManager.ProfileId.PROFILE_HID_HOST,
    bluetoothManager.ProfileId.PROFILE_PAN_NETWORK,
  ];
  const scanModes = [
    bluetoothManager.ScanMode.SCAN_MODE_NONE,
    bluetoothManager.ScanMode.SCAN_MODE_CONNECTABLE,
    bluetoothManager.ScanMode.SCAN_MODE_CONNECTABLE_GENERAL_DISCOVERABLE,
    bluetoothManager.ScanMode.SCAN_MODE_CONNECTABLE_LIMITED_DISCOVERABLE,
    bluetoothManager.ScanMode.SCAN_MODE_GENERAL_DISCOVERABLE,
    bluetoothManager.ScanMode.SCAN_MODE_LIMITED_DISCOVERABLE,
  ];
  const scanDuties = [
    bluetoothManager.ScanDuty.SCAN_MODE_LOW_POWER,
    bluetoothManager.ScanDuty.SCAN_MODE_LOW_LATENCY,
    bluetoothManager.ScanDuty.SCAN_MODE_BALANCED,
  ];
  const matchModes = [
    bluetoothManager.MatchMode.MATCH_MODE_AGGRESSIVE,
    bluetoothManager.MatchMode.MATCH_MODE_STICKY,
  ];
  const sppTypes = [bluetoothManager.SppType.SPP_RFCOMM];
  const majorClasses = [
    bluetoothManager.MajorClass.MAJOR_MISC,
    bluetoothManager.MajorClass.MAJOR_COMPUTER,
    bluetoothManager.MajorClass.MAJOR_PHONE,
    bluetoothManager.MajorClass.MAJOR_NETWORKING,
    bluetoothManager.MajorClass.MAJOR_AUDIO_VIDEO,
    bluetoothManager.MajorClass.MAJOR_PERIPHERAL,
    bluetoothManager.MajorClass.MAJOR_IMAGING,
    bluetoothManager.MajorClass.MAJOR_WEARABLE,
    bluetoothManager.MajorClass.MAJOR_TOY,
    bluetoothManager.MajorClass.MAJOR_HEALTH,
    bluetoothManager.MajorClass.MAJOR_UNCATEGORIZED,
  ];
  const majorMinorClasses = [
    bluetoothManager.MajorMinorClass.COMPUTER_UNCATEGORIZED,
    bluetoothManager.MajorMinorClass.COMPUTER_DESKTOP,
    bluetoothManager.MajorMinorClass.COMPUTER_SERVER,
    bluetoothManager.MajorMinorClass.COMPUTER_LAPTOP,
    bluetoothManager.MajorMinorClass.COMPUTER_HANDHELD_PC_PDA,
    bluetoothManager.MajorMinorClass.COMPUTER_PALM_SIZE_PC_PDA,
    bluetoothManager.MajorMinorClass.COMPUTER_WEARABLE,
    bluetoothManager.MajorMinorClass.COMPUTER_TABLET,
    bluetoothManager.MajorMinorClass.PHONE_UNCATEGORIZED,
    bluetoothManager.MajorMinorClass.PHONE_CELLULAR,
    bluetoothManager.MajorMinorClass.PHONE_CORDLESS,
    bluetoothManager.MajorMinorClass.PHONE_SMART,
    bluetoothManager.MajorMinorClass.PHONE_MODEM_OR_GATEWAY,
    bluetoothManager.MajorMinorClass.PHONE_ISDN,
    bluetoothManager.MajorMinorClass.NETWORK_NO_SERVICE,
    bluetoothManager.MajorMinorClass.NETWORK_1_TO_17_UTILIZED,
    bluetoothManager.MajorMinorClass.NETWORK_17_TO_33_UTILIZED,
    bluetoothManager.MajorMinorClass.NETWORK_33_TO_50_UTILIZED,
    bluetoothManager.MajorMinorClass.NETWORK_60_TO_67_UTILIZED,
    bluetoothManager.MajorMinorClass.NETWORK_67_TO_83_UTILIZED,
    bluetoothManager.MajorMinorClass.NETWORK_83_TO_99_UTILIZED,
    bluetoothManager.MajorMinorClass.NETWORK_FULLY_AVAILABLE,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_UNCATEGORIZED,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_WEARABLE_HEADSET,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_HANDSFREE,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_MICROPHONE,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_LOUDSPEAKER,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_HEADPHONES,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_PORTABLE_AUDIO,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_SET_TOP_BOX,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_CAR_AUDIO,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_HIFI_AUDIO,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_VCR,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_VIDEO_CAMERA,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_CAMCORDER,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_VIDEO_MONITOR,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_VIDEO_DISPLAY_AND_LOUDSPEAKER,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_VIDEO_CONFERENCING,
    bluetoothManager.MajorMinorClass.AUDIO_VIDEO_VIDEO_GAMING_TOY,
    bluetoothManager.MajorMinorClass.PERIPHERAL_UNCATEGORIZED,
    bluetoothManager.MajorMinorClass.PERIPHERAL_KEYBOARD,
    bluetoothManager.MajorMinorClass.PERIPHERAL_POINTING_DEVICE,
    bluetoothManager.MajorMinorClass.PERIPHERAL_KEYBOARD_POINTING,
    bluetoothManager.MajorMinorClass.PERIPHERAL_JOYSTICK,
    bluetoothManager.MajorMinorClass.PERIPHERAL_GAMEPAD,
    bluetoothManager.MajorMinorClass.PERIPHERAL_REMOTE_CONTROL,
    bluetoothManager.MajorMinorClass.PERIPHERAL_SENSING_DEVICE,
    bluetoothManager.MajorMinorClass.PERIPHERAL_DIGITIZER_TABLET,
    bluetoothManager.MajorMinorClass.PERIPHERAL_CARD_READER,
    bluetoothManager.MajorMinorClass.PERIPHERAL_DIGITAL_PEN,
    bluetoothManager.MajorMinorClass.PERIPHERAL_SCANNER_RFID,
    bluetoothManager.MajorMinorClass.PERIPHERAL_GESTURAL_INPUT,
    bluetoothManager.MajorMinorClass.PERIPHERAL_NON_KEYBOARD_NON_POINTING,
    bluetoothManager.MajorMinorClass.IMAGING_UNCATEGORIZED,
    bluetoothManager.MajorMinorClass.IMAGING_DISPLAY,
    bluetoothManager.MajorMinorClass.IMAGING_CAMERA,
    bluetoothManager.MajorMinorClass.IMAGING_SCANNER,
    bluetoothManager.MajorMinorClass.IMAGING_PRINTER,
    bluetoothManager.MajorMinorClass.WEARABLE_UNCATEGORIZED,
    bluetoothManager.MajorMinorClass.WEARABLE_WRIST_WATCH,
    bluetoothManager.MajorMinorClass.WEARABLE_PAGER,
    bluetoothManager.MajorMinorClass.WEARABLE_JACKET,
    bluetoothManager.MajorMinorClass.WEARABLE_HELMET,
    bluetoothManager.MajorMinorClass.WEARABLE_GLASSES,
    bluetoothManager.MajorMinorClass.TOY_UNCATEGORIZED,
    bluetoothManager.MajorMinorClass.TOY_ROBOT,
    bluetoothManager.MajorMinorClass.TOY_VEHICLE,
    bluetoothManager.MajorMinorClass.TOY_DOLL_ACTION_FIGURE,
    bluetoothManager.MajorMinorClass.TOY_CONTROLLER,
    bluetoothManager.MajorMinorClass.TOY_GAME,
    bluetoothManager.MajorMinorClass.HEALTH_UNCATEGORIZED,
    bluetoothManager.MajorMinorClass.HEALTH_BLOOD_PRESSURE,
    bluetoothManager.MajorMinorClass.HEALTH_THERMOMETER,
    bluetoothManager.MajorMinorClass.HEALTH_WEIGHING,
    bluetoothManager.MajorMinorClass.HEALTH_GLUCOSE,
    bluetoothManager.MajorMinorClass.HEALTH_PULSE_OXIMETER,
    bluetoothManager.MajorMinorClass.HEALTH_PULSE_RATE,
    bluetoothManager.MajorMinorClass.HEALTH_DATA_DISPLAY,
    bluetoothManager.MajorMinorClass.HEALTH_STEP_COUNTER,
    bluetoothManager.MajorMinorClass.HEALTH_BODY_COMPOSITION_ANALYZER,
    bluetoothManager.MajorMinorClass.HEALTH_GENERIC_HEALTH_MANAGER,
    bluetoothManager.MajorMinorClass.HEALTH_ANKLE_PROSTHESIS,
    bluetoothManager.MajorMinorClass.HEALTH_KNEE_PROSTHESIS,
    bluetoothManager.MajorMinorClass.HEALTH_PERSONAL_MOBILITY_DEVICE,
    bluetoothManager.MajorMinorClass.HEALTH_MEDICATION_MONITOR,
    bluetoothManager.MajorMinorClass.HEALTH_PEAK_FLOW_MONITOR,
  ];
  console.log('enum coverage sizes',
    btStates.length, bondStates.length, playingStates.length, profileConnStates.length,
    profileIds.length, scanModes.length, scanDuties.length, matchModes.length,
    sppTypes.length, majorClasses.length, majorMinorClasses.length);
}

// ---------------------------------------------------------------------------
// Scenario: classic-Bluetooth adapter lifecycle, discovery and pairing.
// ---------------------------------------------------------------------------
async function manageClassicAdapter(): Promise<void> {
  bluetoothManager.enableBluetooth();
  const state = bluetoothManager.getState();
  console.log('bt state', state);

  bluetoothManager.setLocalName('HarmonyOS-Phone');
  const localName = bluetoothManager.getLocalName();
  const scanMode = bluetoothManager.getBluetoothScanMode();
  bluetoothManager.setBluetoothScanMode(bluetoothManager.ScanMode.SCAN_MODE_CONNECTABLE_GENERAL_DISCOVERABLE, 0);
  const overallConn = bluetoothManager.getBtConnectionState();
  console.log('local name', localName, 'scan mode', scanMode, 'overall conn', overallConn);

  bluetoothManager.startBluetoothDiscovery();
  bluetoothManager.on('bluetoothDeviceFind', (devices: Array<string>) => {
    console.log('discovered devices', devices);
  });
  bluetoothManager.off('bluetoothDeviceFind');
  bluetoothManager.stopBluetoothDiscovery();

  try {
    bluetoothManager.pairDevice(HEADSET_ADDR);
  } catch (e) {
    console.error('pairDevice failed', e);
  }
  bluetoothManager.setDevicePairingConfirmation(HEADSET_ADDR, true);

  const remoteName = bluetoothManager.getRemoteDeviceName(HEADSET_ADDR);
  const remoteClass = bluetoothManager.getRemoteDeviceClass(HEADSET_ADDR);
  inspectDeviceClass(remoteClass);
  console.log('remote headset', remoteName);

  const paired = bluetoothManager.getPairedDevices();
  console.log('paired devices', paired.length);

  bluetoothManager.disableBluetooth();
}

// ---------------------------------------------------------------------------
// Scenario: inspect a DeviceClass returned from getRemoteDeviceClass.
// ---------------------------------------------------------------------------
function inspectDeviceClass(dc: bluetoothManager.DeviceClass): void {
  const cod = dc.classOfDevice;
  const major = dc.majorClass;
  const minor = dc.majorMinorClass;
  console.log('device class', cod, major, minor);
}

// ---------------------------------------------------------------------------
// Scenario: classic profile connections (A2DP / HFP / HID / PAN) plus the
// shared BaseProfile queries.
// ---------------------------------------------------------------------------
function manageClassicProfiles(): void {
  const a2dp = bluetoothManager.getProfileInstance(bluetoothManager.ProfileId.PROFILE_A2DP_SOURCE) as bluetoothManager.A2dpSourceProfile;
  a2dp.on('connectionStateChange', (state: bluetoothManager.StateChangeParam) => {
    inspectStateChangeParam(state);
    console.log('a2dp conn state', state.state);
  });
  try {
    a2dp.connect(HEADSET_ADDR);
  } catch (e) {
    console.error('a2dp connect failed', e);
  }
  const playing = a2dp.getPlayingState(HEADSET_ADDR);
  console.log('a2dp playing', playing);
  const a2dpDevices = a2dp.getConnectionDevices();
  const a2dpDevState = a2dp.getDeviceState(HEADSET_ADDR);
  console.log('a2dp devices', a2dpDevices.length, a2dpDevState);
  a2dp.disconnect(HEADSET_ADDR);
  a2dp.off('connectionStateChange');

  const hfp = bluetoothManager.getProfileInstance(bluetoothManager.ProfileId.PROFILE_HANDS_FREE_AUDIO_GATEWAY) as bluetoothManager.HandsFreeAudioGatewayProfile;
  hfp.on('connectionStateChange', (s: bluetoothManager.StateChangeParam) => console.log('hfp state', s.deviceId));
  hfp.connect(PHONE_ADDR);
  hfp.disconnect(PHONE_ADDR);
  hfp.off('connectionStateChange');

  const hid = bluetoothManager.getProfileInstance(bluetoothManager.ProfileId.PROFILE_HID_HOST) as bluetoothManager.HidHostProfile;
  hid.on('connectionStateChange', (s: bluetoothManager.StateChangeParam) => console.log('hid state', s.deviceId));
  hid.off('connectionStateChange');

  const pan = bluetoothManager.getProfileInstance(bluetoothManager.ProfileId.PROFILE_PAN_NETWORK) as bluetoothManager.PanProfile;
  pan.on('connectionStateChange', (s: bluetoothManager.StateChangeParam) => console.log('pan state', s.deviceId));
  pan.off('connectionStateChange');

  // ProfileConnectionState for the requested profile id (deprecated module fn).
  const a2dpConn = bluetoothManager.getProfileConnectionState(bluetoothManager.ProfileId.PROFILE_A2DP_SOURCE);
  console.log('a2dp profile connection state', a2dpConn);
}

// ---------------------------------------------------------------------------
// Scenario: Serial Port Profile (SPP) server + client lifecycle.
// ---------------------------------------------------------------------------
function manageSpp(): void {
  const sppOption: bluetoothManager.SppOption = {
    uuid: SPP_UUID,
    secure: true,
    type: bluetoothManager.SppType.SPP_RFCOMM,
  };
  inspectSppOption(sppOption);

  bluetoothManager.sppListen('HarmonySppServer', sppOption, (err: BusinessError, data: number) => {
    if (err) { console.error('spp listen failed', err); return; }
    console.log('spp listen server socket', data);
  });
  bluetoothManager.sppAccept(SERVER_SOCKET, (err: BusinessError, data: number) => {
    if (err) { console.error('spp accept failed', err); return; }
    console.log('spp accepted client', data);
  });
  bluetoothManager.sppConnect(HEADSET_ADDR, sppOption, (err: BusinessError, data: number) => {
    if (err) { console.error('spp connect failed', err); return; }
    console.log('spp connected client', data);
  });
  bluetoothManager.sppCloseClientSocket(CLIENT_SOCKET);
  bluetoothManager.sppCloseServerSocket(SERVER_SOCKET);
}

function inspectSppOption(opt: bluetoothManager.SppOption): void {
  const uuid = opt.uuid;
  const secure = opt.secure;
  const type = opt.type;
  console.log('spp option', uuid, secure, type);
}

// ---------------------------------------------------------------------------
// Scenario: BLE peripheral advertising + GATT server hosting a Heart Rate svc.
// ---------------------------------------------------------------------------
function manageGattServer(): void {
  const server = bluetoothManager.BLE.createGattServer();

  const cccDescriptor: bluetoothManager.BLEDescriptor = {
    serviceUuid: HRS_SERVICE_UUID,
    characteristicUuid: HRS_MEASUREMENT_UUID,
    descriptorUuid: CCC_DESCRIPTOR_UUID,
    descriptorValue: new ArrayBuffer(2),
  };
  inspectBLEDescriptor(cccDescriptor);

  const measurementChar: bluetoothManager.BLECharacteristic = {
    serviceUuid: HRS_SERVICE_UUID,
    characteristicUuid: HRS_MEASUREMENT_UUID,
    characteristicValue: new ArrayBuffer(2),
    descriptors: [cccDescriptor],
  };
  inspectBLECharacteristic(measurementChar);

  const hrsService: bluetoothManager.GattService = {
    serviceUuid: HRS_SERVICE_UUID,
    isPrimary: true,
    characteristics: [measurementChar],
    includeServices: [],
  };
  inspectGattService(hrsService);

  server.addService(hrsService);

  const setting: bluetoothManager.AdvertiseSetting = {
    interval: 1600,
    txPower: -7,
    connectable: true,
  };
  inspectAdvertiseSetting(setting);

  const manufactureData: bluetoothManager.ManufactureData = {
    manufactureId: MANUFACTURER_ID,
    manufactureValue: new ArrayBuffer(2),
  };
  inspectManufactureData(manufactureData);

  const serviceData: bluetoothManager.ServiceData = {
    serviceUuid: HRS_SERVICE_UUID,
    serviceValue: new ArrayBuffer(1),
  };
  inspectServiceData(serviceData);

  const advData: bluetoothManager.AdvertiseData = {
    serviceUuids: [HRS_SERVICE_UUID],
    manufactureData: [manufactureData],
    serviceData: [serviceData],
  };
  inspectAdvertiseData(advData);

  server.startAdvertising(setting, advData);

  server.on('characteristicRead', (req: bluetoothManager.CharacteristicReadRequest) => {
    inspectCharacteristicReadRequest(req);
    console.log('char read', req.characteristicUuid);
  });
  server.off('characteristicRead');

  server.on('characteristicWrite', (req: bluetoothManager.CharacteristicWriteRequest) => {
    inspectCharacteristicWriteRequest(req);
  });
  server.on('descriptorRead', (req: bluetoothManager.DescriptorReadRequest) => {
    inspectDescriptorReadRequest(req);
  });
  server.on('descriptorWrite', (req: bluetoothManager.DescriptorWriteRequest) => {
    inspectDescriptorWriteRequest(req);
  });
  server.off('characteristicWrite');
  server.off('descriptorRead');
  server.off('descriptorWrite');

  server.stopAdvertising();
  server.removeService(HRS_SERVICE_UUID);
  server.close();
}

// ---------------------------------------------------------------------------
// Scenario: BLE central scanning + GATT client interactions with a sensor.
// ---------------------------------------------------------------------------
async function manageGattClient(): Promise<void> {
  const filters: Array<bluetoothManager.ScanFilter> = [buildHeartRateScanFilter()];
  const options: bluetoothManager.ScanOptions = {
    interval: 0,
    dutyMode: bluetoothManager.ScanDuty.SCAN_MODE_BALANCED,
    matchMode: bluetoothManager.MatchMode.MATCH_MODE_AGGRESSIVE,
  };
  inspectScanOptions(options);

  bluetoothManager.BLE.on('BLEDeviceFind', (results: Array<bluetoothManager.ScanResult>) => {
    for (const r of results) {
      inspectScanResult(r);
    }
  });
  bluetoothManager.BLE.startBLEScan(filters, options);

  const connected = bluetoothManager.BLE.getConnectedBLEDevices();
  console.log('connected BLE devices', connected.length);

  const client = bluetoothManager.BLE.createGattClientDevice(HEADSET_ADDR);
  client.on('BLECharacteristicChange', (c: bluetoothManager.BLECharacteristic) => {
    inspectBLECharacteristic(c);
    console.log('char changed', c.characteristicUuid);
  });
  try {
    client.setBLEMtuSize(512);
    client.connect();
    const services = await client.getServices();
    console.log('discovered services', services.length);
    const name = await client.getDeviceName();
    console.log('remote device name', name);
    const rssi = await client.getRssiValue();
    console.log('remote rssi', rssi);
  } catch (e) {
    console.error('gatt client interaction failed', e);
  } finally {
    client.disconnect();
    client.close();
  }
  client.off('BLECharacteristicChange');

  bluetoothManager.BLE.stopBLEScan();
  bluetoothManager.BLE.off('BLEDeviceFind');
}

function buildHeartRateScanFilter(): bluetoothManager.ScanFilter {
  const filter: bluetoothManager.ScanFilter = {
    deviceId: HEADSET_ADDR,
    name: 'HarmonyHR-Sensor',
    serviceUuid: HRS_SERVICE_UUID,
    serviceUuidMask: '0000FFFF-0000-1000-8000-00805F9B34FB',
    serviceSolicitationUuid: HRS_SERVICE_UUID,
    serviceSolicitationUuidMask: '0000FFFF-0000-1000-8000-00805F9B34FB',
    serviceData: new ArrayBuffer(1),
    serviceDataMask: new ArrayBuffer(1),
    manufactureId: MANUFACTURER_ID,
    manufactureData: new ArrayBuffer(2),
    manufactureDataMask: new ArrayBuffer(2),
  };
  inspectScanFilter(filter);
  return filter;
}

// ---------------------------------------------------------------------------
// Field-inspection helpers: each reads every deprecated field of a request /
// param / data interface so the compiler records the deprecated symbol usage.
// ---------------------------------------------------------------------------
function inspectAdvertiseSetting(s: bluetoothManager.AdvertiseSetting): void {
  console.log('adv setting', s.interval, s.txPower, s.connectable);
}
function inspectAdvertiseData(d: bluetoothManager.AdvertiseData): void {
  console.log('adv data', d.serviceUuids.length, d.manufactureData.length, d.serviceData.length);
}
function inspectManufactureData(m: bluetoothManager.ManufactureData): void {
  console.log('mfr data', m.manufactureId, m.manufactureValue.byteLength);
}
function inspectServiceData(s: bluetoothManager.ServiceData): void {
  console.log('svc data', s.serviceUuid, s.serviceValue.byteLength);
}
function inspectBLECharacteristic(c: bluetoothManager.BLECharacteristic): void {
  console.log('ble char', c.serviceUuid, c.characteristicUuid, c.characteristicValue.byteLength, c.descriptors.length);
}
function inspectBLEDescriptor(d: bluetoothManager.BLEDescriptor): void {
  console.log('ble desc', d.serviceUuid, d.characteristicUuid, d.descriptorUuid, d.descriptorValue.byteLength);
}
function inspectGattService(s: bluetoothManager.GattService): void {
  console.log('gatt svc', s.serviceUuid, s.isPrimary, s.characteristics.length, s.includeServices ? s.includeServices.length : 0);
}
function inspectScanFilter(f: bluetoothManager.ScanFilter): void {
  console.log('scan filter', f.deviceId, f.name, f.serviceUuid, f.serviceUuidMask,
    f.serviceSolicitationUuid, f.serviceSolicitationUuidMask, f.serviceData ? f.serviceData.byteLength : 0,
    f.serviceDataMask ? f.serviceDataMask.byteLength : 0, f.manufactureId,
    f.manufactureData ? f.manufactureData.byteLength : 0, f.manufactureDataMask ? f.manufactureDataMask.byteLength : 0);
}
function inspectScanOptions(o: bluetoothManager.ScanOptions): void {
  console.log('scan options', o.interval, o.dutyMode, o.matchMode);
}
function inspectScanResult(r: bluetoothManager.ScanResult): void {
  console.log('scan result', r.deviceId, r.rssi, r.data.byteLength);
}
function inspectCharacteristicReadRequest(r: bluetoothManager.CharacteristicReadRequest): void {
  console.log('char read req', r.deviceId, r.transId, r.offset, r.characteristicUuid, r.serviceUuid);
}
function inspectCharacteristicWriteRequest(r: bluetoothManager.CharacteristicWriteRequest): void {
  console.log('char write req', r.deviceId, r.transId, r.offset, r.isPrep, r.needRsp, r.value.byteLength, r.characteristicUuid, r.serviceUuid);
}
function inspectDescriptorReadRequest(r: bluetoothManager.DescriptorReadRequest): void {
  console.log('desc read req', r.deviceId, r.transId, r.offset, r.descriptorUuid, r.characteristicUuid, r.serviceUuid);
}
function inspectDescriptorWriteRequest(r: bluetoothManager.DescriptorWriteRequest): void {
  console.log('desc write req', r.deviceId, r.transId, r.offset, r.isPrep, r.needRsp, r.value.byteLength, r.descriptorUuid, r.characteristicUuid, r.serviceUuid);
}
function inspectStateChangeParam(p: bluetoothManager.StateChangeParam): void {
  console.log('state change', p.deviceId, p.state);
}

// A ServerResponse instance is built and inspected to cover the deprecated
// response fields (sendResponse itself is intentionally NOT invoked here to
// keep the deprecated-coverage set stable with the original probe).
function inspectServerResponseExample(): void {
  const resp: bluetoothManager.ServerResponse = {
    deviceId: HEADSET_ADDR,
    transId: 1,
    status: 0,
    offset: 0,
    value: new ArrayBuffer(1),
  };
  console.log('server response', resp.deviceId, resp.transId, resp.status, resp.offset, resp.value.byteLength);
}

// A NotifyCharacteristic instance is built and inspected to cover its
// deprecated fields (notifyCharacteristicChanged itself is intentionally NOT
// invoked here to keep the deprecated-coverage set stable with the original
// probe).
function inspectNotifyCharacteristicExample(): void {
  const notify: bluetoothManager.NotifyCharacteristic = {
    serviceUuid: HRS_SERVICE_UUID,
    characteristicUuid: HRS_MEASUREMENT_UUID,
    characteristicValue: new ArrayBuffer(2),
    confirm: true,
  };
  console.log('notify char', notify.serviceUuid, notify.characteristicUuid, notify.characteristicValue.byteLength, notify.confirm);
}

// Bond/pin parameters are surfaced by the bond-state / pin-required events in
// a real app; here they are constructed and inspected to cover the deprecated
// request/param fields without introducing new deprecated APIs.
function inspectBondAndPinExamples(): void {
  const bondParam: bluetoothManager.BondStateParam = {
    deviceId: HEADSET_ADDR,
    state: bluetoothManager.BondState.BOND_STATE_BONDED,
  };
  console.log('bond param', bondParam.deviceId, bondParam.state);

  const pinParam: bluetoothManager.PinRequiredParam = {
    deviceId: HEADSET_ADDR,
    pinCode: '123456',
  };
  console.log('pin param', pinParam.deviceId, pinParam.pinCode);

  const bleConn: bluetoothManager.BLEConnectChangedState = {
    deviceId: HEADSET_ADDR,
    state: bluetoothManager.ProfileConnectionState.STATE_CONNECTED,
  };
  console.log('ble conn state', bleConn.deviceId, bleConn.state);
}

// ---------------------------------------------------------------------------
// Entry point: run every scenario in a coherent order.
// ---------------------------------------------------------------------------
async function run(): Promise<void> {
  collectDeprecatedConstants();
  inspectServerResponseExample();
  inspectNotifyCharacteristicExample();
  inspectBondAndPinExamples();
  await manageClassicAdapter();
  manageClassicProfiles();
  manageSpp();
  manageGattServer();
  await manageGattClient();
}

run();
