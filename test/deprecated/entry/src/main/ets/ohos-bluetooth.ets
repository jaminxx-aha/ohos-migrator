import bluetooth from '@ohos.bluetooth';

// Realistic runtime exercise of the deprecated @ohos.bluetooth API surface.
// Each deprecated symbol from the original probe is exercised once through a
// coherent scenario (adapter management, bonding, classic profiles, BLE
// client/server, BLE scan, and SPP sockets).

const HEADSET_DEVICE = '00:11:22:33:44:55';
const SENSOR_DEVICE = 'AA:BB:CC:DD:EE:FF';
const HRP_SERVICE_UUID = '0000180D-0000-1000-8000-00805F9B34FB';
const HR_MEASUREMENT_UUID = '00002A37-0000-1000-8000-00805F9B34FB';
const CCC_DESCRIPTOR_UUID = '00002902-0000-1000-8000-00805F9B34FB';
const SPP_UUID = '00001101-0000-1000-8000-00805F9B34FB';

// ---------- Enum classifiers (cover every deprecated enum member) ----------

function describeBluetoothState(state: bluetooth.BluetoothState): string {
  switch (state) {
    case bluetooth.BluetoothState.STATE_OFF: return 'off';
    case bluetooth.BluetoothState.STATE_TURNING_ON: return 'turning_on';
    case bluetooth.BluetoothState.STATE_ON: return 'on';
    case bluetooth.BluetoothState.STATE_TURNING_OFF: return 'turning_off';
    case bluetooth.BluetoothState.STATE_BLE_TURNING_ON: return 'ble_turning_on';
    case bluetooth.BluetoothState.STATE_BLE_ON: return 'ble_on';
    case bluetooth.BluetoothState.STATE_BLE_TURNING_OFF: return 'ble_turning_off';
    default: return 'unknown';
  }
}

function describeBondState(state: bluetooth.BondState): string {
  switch (state) {
    case bluetooth.BondState.BOND_STATE_INVALID: return 'invalid';
    case bluetooth.BondState.BOND_STATE_BONDING: return 'bonding';
    case bluetooth.BondState.BOND_STATE_BONDED: return 'bonded';
    default: return 'unknown';
  }
}

function describePlayingState(state: bluetooth.PlayingState): string {
  switch (state) {
    case bluetooth.PlayingState.STATE_NOT_PLAYING: return 'not_playing';
    case bluetooth.PlayingState.STATE_PLAYING: return 'playing';
    default: return 'unknown';
  }
}

function describeProfileConnectionState(state: bluetooth.ProfileConnectionState): string {
  switch (state) {
    case bluetooth.ProfileConnectionState.STATE_DISCONNECTED: return 'disconnected';
    case bluetooth.ProfileConnectionState.STATE_CONNECTING: return 'connecting';
    case bluetooth.ProfileConnectionState.STATE_CONNECTED: return 'connected';
    case bluetooth.ProfileConnectionState.STATE_DISCONNECTING: return 'disconnecting';
    default: return 'unknown';
  }
}

function describeScanMode(mode: bluetooth.ScanMode): string {
  switch (mode) {
    case bluetooth.ScanMode.SCAN_MODE_NONE: return 'none';
    case bluetooth.ScanMode.SCAN_MODE_CONNECTABLE: return 'connectable';
    case bluetooth.ScanMode.SCAN_MODE_CONNECTABLE_GENERAL_DISCOVERABLE: return 'connectable_general';
    case bluetooth.ScanMode.SCAN_MODE_CONNECTABLE_LIMITED_DISCOVERABLE: return 'connectable_limited';
    case bluetooth.ScanMode.SCAN_MODE_GENERAL_DISCOVERABLE: return 'general';
    case bluetooth.ScanMode.SCAN_MODE_LIMITED_DISCOVERABLE: return 'limited';
    default: return 'unknown';
  }
}

function describeScanDuty(duty: bluetooth.ScanDuty): string {
  switch (duty) {
    case bluetooth.ScanDuty.SCAN_MODE_LOW_POWER: return 'low_power';
    case bluetooth.ScanDuty.SCAN_MODE_BALANCED: return 'balanced';
    case bluetooth.ScanDuty.SCAN_MODE_LOW_LATENCY: return 'low_latency';
    default: return 'unknown';
  }
}

function describeMatchMode(mode: bluetooth.MatchMode): string {
  switch (mode) {
    case bluetooth.MatchMode.MATCH_MODE_AGGRESSIVE: return 'aggressive';
    case bluetooth.MatchMode.MATCH_MODE_STICKY: return 'sticky';
    default: return 'unknown';
  }
}

function describeMajorClass(c: bluetooth.MajorClass): string {
  switch (c) {
    case bluetooth.MajorClass.MAJOR_MISC: return 'misc';
    case bluetooth.MajorClass.MAJOR_COMPUTER: return 'computer';
    case bluetooth.MajorClass.MAJOR_PHONE: return 'phone';
    case bluetooth.MajorClass.MAJOR_NETWORKING: return 'networking';
    case bluetooth.MajorClass.MAJOR_AUDIO_VIDEO: return 'audio_video';
    case bluetooth.MajorClass.MAJOR_PERIPHERAL: return 'peripheral';
    case bluetooth.MajorClass.MAJOR_IMAGING: return 'imaging';
    case bluetooth.MajorClass.MAJOR_WEARABLE: return 'wearable';
    case bluetooth.MajorClass.MAJOR_TOY: return 'toy';
    case bluetooth.MajorClass.MAJOR_HEALTH: return 'health';
    case bluetooth.MajorClass.MAJOR_UNCATEGORIZED: return 'uncategorized';
    default: return 'unknown';
  }
}

function describeMajorMinorClass(c: bluetooth.MajorMinorClass): string {
  switch (c) {
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_CAMCORDER: return 'camcorder';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_CAR_AUDIO: return 'car_audio';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_HANDSFREE: return 'handsfree';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_HEADPHONES: return 'headphones';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_HIFI_AUDIO: return 'hifi_audio';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_LOUDSPEAKER: return 'loudspeaker';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_MICROPHONE: return 'microphone';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_PORTABLE_AUDIO: return 'portable_audio';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_SET_TOP_BOX: return 'set_top_box';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_UNCATEGORIZED: return 'av_uncategorized';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_VCR: return 'vcr';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_VIDEO_CAMERA: return 'video_camera';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_VIDEO_CONFERENCING: return 'video_conferencing';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_VIDEO_DISPLAY_AND_LOUDSPEAKER: return 'display_and_loudspeaker';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_VIDEO_GAMING_TOY: return 'gaming_toy';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_VIDEO_MONITOR: return 'video_monitor';
    case bluetooth.MajorMinorClass.AUDIO_VIDEO_WEARABLE_HEADSET: return 'wearable_headset';
    case bluetooth.MajorMinorClass.COMPUTER_DESKTOP: return 'desktop';
    case bluetooth.MajorMinorClass.COMPUTER_HANDHELD_PC_PDA: return 'handheld_pc_pda';
    case bluetooth.MajorMinorClass.COMPUTER_LAPTOP: return 'laptop';
    case bluetooth.MajorMinorClass.COMPUTER_PALM_SIZE_PC_PDA: return 'palm_size_pc_pda';
    case bluetooth.MajorMinorClass.COMPUTER_SERVER: return 'server';
    case bluetooth.MajorMinorClass.COMPUTER_TABLET: return 'tablet';
    case bluetooth.MajorMinorClass.COMPUTER_UNCATEGORIZED: return 'computer_uncategorized';
    case bluetooth.MajorMinorClass.COMPUTER_WEARABLE: return 'wearable_computer';
    case bluetooth.MajorMinorClass.HEALTH_ANKLE_PROSTHESIS: return 'ankle_prosthesis';
    case bluetooth.MajorMinorClass.HEALTH_BLOOD_PRESSURE: return 'blood_pressure';
    case bluetooth.MajorMinorClass.HEALTH_BODY_COMPOSITION_ANALYZER: return 'body_composition_analyzer';
    case bluetooth.MajorMinorClass.HEALTH_DATA_DISPLAY: return 'data_display';
    case bluetooth.MajorMinorClass.HEALTH_GENERIC_HEALTH_MANAGER: return 'generic_health_manager';
    case bluetooth.MajorMinorClass.HEALTH_GLUCOSE: return 'glucose';
    case bluetooth.MajorMinorClass.HEALTH_KNEE_PROSTHESIS: return 'knee_prosthesis';
    case bluetooth.MajorMinorClass.HEALTH_MEDICATION_MONITOR: return 'medication_monitor';
    case bluetooth.MajorMinorClass.HEALTH_PEAK_FLOW_MOITOR: return 'peak_flow_monitor';
    case bluetooth.MajorMinorClass.HEALTH_PERSONAL_MOBILITY_DEVICE: return 'personal_mobility_device';
    case bluetooth.MajorMinorClass.HEALTH_PULSE_OXIMETER: return 'pulse_oximeter';
    case bluetooth.MajorMinorClass.HEALTH_PULSE_RATE: return 'pulse_rate';
    case bluetooth.MajorMinorClass.HEALTH_STEP_COUNTER: return 'step_counter';
    case bluetooth.MajorMinorClass.HEALTH_THERMOMETER: return 'thermometer';
    case bluetooth.MajorMinorClass.HEALTH_UNCATEGORIZED: return 'health_uncategorized';
    case bluetooth.MajorMinorClass.HEALTH_WEIGHING: return 'weighing';
    case bluetooth.MajorMinorClass.IMAGING_CAMERA: return 'camera';
    case bluetooth.MajorMinorClass.IMAGING_DISPLAY: return 'display';
    case bluetooth.MajorMinorClass.IMAGING_PRINTER: return 'printer';
    case bluetooth.MajorMinorClass.IMAGING_SCANNER: return 'scanner';
    case bluetooth.MajorMinorClass.IMAGING_UNCATEGORIZED: return 'imaging_uncategorized';
    case bluetooth.MajorMinorClass.NETWORK_17_TO_33_UTILIZED: return 'network_17_33';
    case bluetooth.MajorMinorClass.NETWORK_1_TO_17_UTILIZED: return 'network_1_17';
    case bluetooth.MajorMinorClass.NETWORK_33_TO_50_UTILIZED: return 'network_33_50';
    case bluetooth.MajorMinorClass.NETWORK_60_TO_67_UTILIZED: return 'network_60_67';
    case bluetooth.MajorMinorClass.NETWORK_67_TO_83_UTILIZED: return 'network_67_83';
    case bluetooth.MajorMinorClass.NETWORK_83_TO_99_UTILIZED: return 'network_83_99';
    case bluetooth.MajorMinorClass.NETWORK_FULLY_AVAILABLE: return 'network_fully_available';
    case bluetooth.MajorMinorClass.NETWORK_NO_SERVICE: return 'network_no_service';
    case bluetooth.MajorMinorClass.PERIPHERAL_CARD_READER: return 'card_reader';
    case bluetooth.MajorMinorClass.PERIPHERAL_DIGITAL_PEN: return 'digital_pen';
    case bluetooth.MajorMinorClass.PERIPHERAL_DIGITIZER_TABLET: return 'digitizer_tablet';
    case bluetooth.MajorMinorClass.PERIPHERAL_GAMEPAD: return 'gamepad';
    case bluetooth.MajorMinorClass.PERIPHERAL_GESTURAL_INPUT: return 'gestural_input';
    case bluetooth.MajorMinorClass.PERIPHERAL_JOYSTICK: return 'joystick';
    case bluetooth.MajorMinorClass.PERIPHERAL_KEYBOARD: return 'keyboard';
    case bluetooth.MajorMinorClass.PERIPHERAL_KEYBOARD_POINTING: return 'keyboard_pointing';
    case bluetooth.MajorMinorClass.PERIPHERAL_NON_KEYBOARD_NON_POINTING: return 'non_keyboard_non_pointing';
    case bluetooth.MajorMinorClass.PERIPHERAL_POINTING_DEVICE: return 'pointing_device';
    case bluetooth.MajorMinorClass.PERIPHERAL_REMOTE_CONTROL: return 'remote_control';
    case bluetooth.MajorMinorClass.PERIPHERAL_SCANNER_RFID: return 'scanner_rfid';
    case bluetooth.MajorMinorClass.PERIPHERAL_SENSING_DEVICE: return 'sensing_device';
    case bluetooth.MajorMinorClass.PERIPHERAL_UNCATEGORIZED: return 'peripheral_uncategorized';
    case bluetooth.MajorMinorClass.PHONE_CELLULAR: return 'cellular';
    case bluetooth.MajorMinorClass.PHONE_CORDLESS: return 'cordless';
    case bluetooth.MajorMinorClass.PHONE_ISDN: return 'isdn';
    case bluetooth.MajorMinorClass.PHONE_MODEM_OR_GATEWAY: return 'modem_or_gateway';
    case bluetooth.MajorMinorClass.PHONE_SMART: return 'smart';
    case bluetooth.MajorMinorClass.PHONE_UNCATEGORIZED: return 'phone_uncategorized';
    case bluetooth.MajorMinorClass.TOY_CONTROLLER: return 'controller';
    case bluetooth.MajorMinorClass.TOY_DOLL_ACTION_FIGURE: return 'doll_action_figure';
    case bluetooth.MajorMinorClass.TOY_GAME: return 'game';
    case bluetooth.MajorMinorClass.TOY_ROBOT: return 'robot';
    case bluetooth.MajorMinorClass.TOY_UNCATEGORIZED: return 'toy_uncategorized';
    case bluetooth.MajorMinorClass.TOY_VEHICLE: return 'vehicle';
    case bluetooth.MajorMinorClass.WEARABLE_GLASSES: return 'glasses';
    case bluetooth.MajorMinorClass.WEARABLE_HELMET: return 'helmet';
    case bluetooth.MajorMinorClass.WEARABLE_JACKET: return 'jacket';
    case bluetooth.MajorMinorClass.WEARABLE_PAGER: return 'pager';
    case bluetooth.MajorMinorClass.WEARABLE_UNCATEGORIZED: return 'wearable_uncategorized';
    case bluetooth.MajorMinorClass.WEARABLE_WRIST_WATCH: return 'wrist_watch';
    default: return 'unknown';
  }
}

function describeDeviceClass(dc: bluetooth.DeviceClass): string {
  const major = describeMajorClass(dc.majorClass);
  const minor = describeMajorMinorClass(dc.majorMinorClass);
  return `major=${major}, minor=${minor}, cod=${dc.classOfDevice}`;
}

// ---------- Data-object builders (exercise deprecated data interfaces) ----------

function buildDescriptor(): bluetooth.BLEDescriptor {
  const descriptor: bluetooth.BLEDescriptor = {
    serviceUuid: HRP_SERVICE_UUID,
    characteristicUuid: HR_MEASUREMENT_UUID,
    descriptorUuid: CCC_DESCRIPTOR_UUID,
    descriptorValue: new ArrayBuffer(2),
  };
  // Touch each deprecated property once.
  void `${descriptor.serviceUuid}/${descriptor.characteristicUuid}/${descriptor.descriptorUuid}/${descriptor.descriptorValue.byteLength}`;
  return descriptor;
}

function buildCharacteristic(): bluetooth.BLECharacteristic {
  const characteristic: bluetooth.BLECharacteristic = {
    serviceUuid: HRP_SERVICE_UUID,
    characteristicUuid: HR_MEASUREMENT_UUID,
    characteristicValue: new ArrayBuffer(4),
    descriptors: [buildDescriptor()],
  };
  void `${characteristic.serviceUuid}/${characteristic.characteristicUuid}/${characteristic.characteristicValue.byteLength}/${characteristic.descriptors.length}`;
  return characteristic;
}

function buildGattService(): bluetooth.GattService {
  const service: bluetooth.GattService = {
    serviceUuid: HRP_SERVICE_UUID,
    isPrimary: true,
    characteristics: [buildCharacteristic()],
    includeServices: [],
  };
  void `${service.serviceUuid}/${service.isPrimary}/${service.characteristics.length}/${(service.includeServices ?? []).length}`;
  return service;
}

function buildAdvertiseSetting(): bluetooth.AdvertiseSetting {
  const setting: bluetooth.AdvertiseSetting = {
    interval: 1600,
    txPower: -7,
    connectable: true,
  };
  void `${setting.interval}/${setting.txPower}/${setting.connectable}`;
  return setting;
}

function buildAdvertiseData(): bluetooth.AdvertiseData {
  const manufacture: bluetooth.ManufactureData = {
    manufactureId: 0x039F,
    manufactureValue: new ArrayBuffer(3),
  };
  void `${manufacture.manufactureId}/${manufacture.manufactureValue.byteLength}`;
  const serviceData: bluetooth.ServiceData = {
    serviceUuid: HRP_SERVICE_UUID,
    serviceValue: new ArrayBuffer(2),
  };
  void `${serviceData.serviceUuid}/${serviceData.serviceValue.byteLength}`;
  const data: bluetooth.AdvertiseData = {
    serviceUuids: [HRP_SERVICE_UUID],
    manufactureData: [manufacture],
    serviceData: [serviceData],
  };
  void `${data.serviceUuids.length}/${data.manufactureData.length}/${data.serviceData.length}`;
  return data;
}

function buildScanFilter(): bluetooth.ScanFilter {
  const filter: bluetooth.ScanFilter = {
    deviceId: SENSOR_DEVICE,
    name: 'HR Sensor',
    serviceUuid: HRP_SERVICE_UUID,
  };
  void `${filter.deviceId}/${filter.name}/${filter.serviceUuid}`;
  return filter;
}

function buildScanOptions(): bluetooth.ScanOptions {
  const options: bluetooth.ScanOptions = {
    interval: 0,
    dutyMode: bluetooth.ScanDuty.SCAN_MODE_BALANCED,
    matchMode: bluetooth.MatchMode.MATCH_MODE_AGGRESSIVE,
  };
  void `${options.interval}/${describeScanDuty(options.dutyMode as bluetooth.ScanDuty)}/${describeMatchMode(options.matchMode as bluetooth.MatchMode)}`;
  return options;
}

function buildSppOption(): bluetooth.SppOption {
  const option: bluetooth.SppOption = {
    uuid: SPP_UUID,
    secure: true,
    type: bluetooth.SppType.SPP_RFCOMM,
  };
  void `${option.uuid}/${option.secure}/${option.type}`;
  return option;
}

function buildNotifyCharacteristic(): bluetooth.NotifyCharacteristic {
  const notify: bluetooth.NotifyCharacteristic = {
    serviceUuid: HRP_SERVICE_UUID,
    characteristicUuid: HR_MEASUREMENT_UUID,
    characteristicValue: new ArrayBuffer(2),
    confirm: false,
  };
  void `${notify.serviceUuid}/${notify.characteristicUuid}/${notify.characteristicValue.byteLength}/${notify.confirm}`;
  return notify;
}

function buildServerResponse(): bluetooth.ServerResponse {
  const response: bluetooth.ServerResponse = {
    deviceId: SENSOR_DEVICE,
    transId: 1,
    status: 0,
    offset: 0,
    value: new ArrayBuffer(2),
  };
  void `${response.deviceId}/${response.transId}/${response.status}/${response.offset}/${response.value.byteLength}`;
  return response;
}

// ---------- Scenarios ----------

// Scenario 1: adapter lifecycle, scan mode, local name and discovery.
async function manageBluetoothAdapter(): Promise<void> {
  try {
    const enabled: boolean = bluetooth.enableBluetooth();
    const state = bluetooth.getState();
    console.info('bluetooth enabled=%s state=%s', enabled, describeBluetoothState(state));
    const scanMode = bluetooth.getBluetoothScanMode();
    console.info('scan mode=%s', describeScanMode(scanMode));
    bluetooth.setBluetoothScanMode(bluetooth.ScanMode.SCAN_MODE_CONNECTABLE_GENERAL_DISCOVERABLE, 120);
    bluetooth.setLocalName('Harmony-Phone');
    console.info('local name=%s', bluetooth.getLocalName());
    bluetooth.on('bluetoothDeviceFind', (devices: Array<string>) => {
      console.info('found devices=%j', devices);
    });
    const discoveryStarted: boolean = bluetooth.startBluetoothDiscovery();
    console.info('discovery started=%s', discoveryStarted);
    const connState = bluetooth.getBtConnectionState();
    console.info('bt connection state=%s', describeProfileConnectionState(connState));
    const paired: Array<string> = bluetooth.getPairedDevices();
    console.info('paired count=%d', paired.length);
    bluetooth.stopBluetoothDiscovery();
    bluetooth.off('bluetoothDeviceFind');
    const disabled: boolean = bluetooth.disableBluetooth();
    console.info('bluetooth disabled=%s', disabled);
  } catch (e) {
    console.error('manageBluetoothAdapter failed', e);
  }
}

// Scenario 2: bond with a remote device, reacting to bond/pin events.
async function bondWithDevice(deviceId: string): Promise<void> {
  try {
    bluetooth.on('bondStateChange', (param: bluetooth.BondStateParam) => {
      console.info('bond state %s for %s', describeBondState(param.state), param.deviceId);
    });
    bluetooth.on('pinRequired', (param: bluetooth.PinRequiredParam) => {
      console.info('pin required for %s code=%s', param.deviceId, param.pinCode);
    });
    bluetooth.on('stateChange', (state: bluetooth.BluetoothState) => {
      console.info('adapter state=%s', describeBluetoothState(state));
    });
    const pairing: boolean = bluetooth.pairDevice(deviceId);
    console.info('pairing initiated=%s', pairing);
    bluetooth.setDevicePairingConfirmation(deviceId, true);
    bluetooth.off('bondStateChange');
    bluetooth.off('pinRequired');
    bluetooth.off('stateChange');
  } catch (e) {
    console.error('bondWithDevice failed', e);
  }
}

// Scenario 3: inspect a remote device's class and name.
async function inspectRemoteDevice(deviceId: string): Promise<void> {
  try {
    const deviceClass = bluetooth.getRemoteDeviceClass(deviceId);
    console.info('remote class: %s', describeDeviceClass(deviceClass));
    const name: string = bluetooth.getRemoteDeviceName(deviceId);
    console.info('remote name=%s', name);
  } catch (e) {
    console.error('inspectRemoteDevice failed', e);
  }
}

// Scenario 4: drive the A2DP source profile with a headset.
async function manageA2dpProfile(deviceId: string): Promise<void> {
  try {
    const profile = bluetooth.getProfile(bluetooth.ProfileId.PROFILE_A2DP_SOURCE) as bluetooth.A2dpSourceProfile;
    profile.on('connectionStateChange', (param: bluetooth.StateChangeParam) => {
      console.info('a2dp conn %s for %s', describeProfileConnectionState(param.state), param.deviceId);
    });
    const connected: boolean = profile.connect(deviceId);
    console.info('a2dp connect=%s', connected);
    const playingState = profile.getPlayingState(deviceId);
    console.info('a2dp playing=%s', describePlayingState(playingState));
    profile.disconnect(deviceId);
    profile.off('connectionStateChange');
  } catch (e) {
    console.error('manageA2dpProfile failed', e);
  }
}

// Scenario 5: drive the Hands-Free Audio Gateway profile.
async function manageHfpProfile(deviceId: string): Promise<void> {
  try {
    const profile = bluetooth.getProfile(bluetooth.ProfileId.PROFILE_HANDS_FREE_AUDIO_GATEWAY) as bluetooth.HandsFreeAudioGatewayProfile;
    const a2dpState = bluetooth.getProfileConnState(bluetooth.ProfileId.PROFILE_A2DP_SOURCE);
    console.info('a2dp conn state=%s', describeProfileConnectionState(a2dpState));
    profile.on('connectionStateChange', (param: bluetooth.StateChangeParam) => {
      console.info('hfp conn %s for %s', describeProfileConnectionState(param.state), param.deviceId);
    });
    profile.connect(deviceId);
    profile.disconnect(deviceId);
    profile.off('connectionStateChange');
    // BaseProfile methods inherited by both profile kinds.
    const devices: Array<string> = profile.getConnectionDevices();
    console.info('hfp connected devices=%d', devices.length);
    const devState = profile.getDeviceState(deviceId);
    console.info('hfp device state=%s', describeProfileConnectionState(devState));
  } catch (e) {
    console.error('manageHfpProfile failed', e);
  }
}

// Scenario 6: act as a GATT client against a remote HR sensor.
async function runBleClientScenario(deviceId: string): Promise<void> {
  try {
    const client = bluetooth.BLE.createGattClientDevice(deviceId);
    client.on('BLECharacteristicChange', (characteristic: bluetooth.BLECharacteristic) => {
      console.info('char change uuid=%s valueLen=%d', characteristic.characteristicUuid, characteristic.characteristicValue.byteLength);
    });
    client.connect();
    const mtuOk: boolean = client.setBLEMtuSize(512);
    console.info('mtu set=%s', mtuOk);
    client.getServices((err: Error, services: Array<bluetooth.GattService>) => {
      if (err) { console.error('getServices error', err); return; }
      for (const svc of services) {
        console.info('service uuid=%s primary=%s chars=%d', svc.serviceUuid, svc.isPrimary, svc.characteristics.length);
      }
    });
    client.getRssiValue((err: Error, rssi: number) => {
      if (err) { console.error('rssi error', err); return; }
      console.info('rssi=%d', rssi);
    });
    client.getDeviceName((err: Error, name: string) => {
      if (err) { console.error('name error', err); return; }
      console.info('device name=%s', name);
    });
    client.off('BLECharacteristicChange');
    client.disconnect();
    client.close();
  } catch (e) {
    console.error('runBleClientScenario failed', e);
  }
}

// Scenario 7: act as a GATT server advertising a HR service.
async function runBleServerScenario(): Promise<void> {
  try {
    const server = bluetooth.BLE.createGattServer();
    server.on('characteristicRead', (req: bluetooth.CharacteristicReadReq) => {
      console.info('read req transId=%d device=%s svc=%s char=%s offset=%d',
        req.transId, req.deviceId, req.serviceUuid, req.characteristicUuid, req.offset);
    });
    server.on('characteristicWrite', (req: bluetooth.CharacteristicWriteReq) => {
      console.info('write req transId=%d device=%s svc=%s char=%s offset=%d isPrep=%s needRsp=%s valueLen=%d',
        req.transId, req.deviceId, req.serviceUuid, req.characteristicUuid, req.offset,
        req.isPrep, req.needRsp, req.value.byteLength);
    });
    server.on('descriptorRead', (req: bluetooth.DescriptorReadReq) => {
      console.info('desc read transId=%d device=%s svc=%s char=%s desc=%s offset=%d',
        req.transId, req.deviceId, req.serviceUuid, req.characteristicUuid, req.descriptorUuid, req.offset);
    });
    server.on('descriptorWrite', (req: bluetooth.DescriptorWriteReq) => {
      console.info('desc write transId=%d device=%s svc=%s char=%s desc=%s offset=%d isPrep=%s needRsp=%s valueLen=%d',
        req.transId, req.deviceId, req.serviceUuid, req.characteristicUuid, req.descriptorUuid,
        req.offset, req.isPrep, req.needRsp, req.value.byteLength);
    });
    server.on('connectStateChange', (state: bluetooth.BLEConnectChangedState) => {
      console.info('gatt conn %s for %s', describeProfileConnectionState(state.state), state.deviceId);
    });
    const service = buildGattService();
    const added: boolean = server.addService(service);
    console.info('service added=%s', added);
    server.startAdvertising(buildAdvertiseSetting(), buildAdvertiseData());
    console.info('advertising started');
    // Prepare (but do not send, sendResponse is intentionally unused) a server response and
    // notification payload to exercise those deprecated data shapes.
    buildServerResponse();
    buildNotifyCharacteristic();
    server.stopAdvertising();
    server.removeService(HRP_SERVICE_UUID);
    server.off('characteristicRead');
    server.close();
  } catch (e) {
    console.error('runBleServerScenario failed', e);
  }
}

// Scenario 8: BLE scan with filters and result callbacks.
async function runBleScanScenario(): Promise<void> {
  try {
    bluetooth.BLE.on('BLEDeviceFind', (results: Array<bluetooth.ScanResult>) => {
      for (const r of results) {
        console.info('scan result device=%s rssi=%d dataLen=%d', r.deviceId, r.rssi, r.data.byteLength);
      }
    });
    bluetooth.BLE.startBLEScan([buildScanFilter()], buildScanOptions());
    console.info('ble scan started');
    const connected: Array<string> = bluetooth.BLE.getConnectedBLEDevices();
    console.info('connected ble devices=%d', connected.length);
    bluetooth.BLE.stopBLEScan();
    bluetooth.BLE.off('BLEDeviceFind');
  } catch (e) {
    console.error('runBleScanScenario failed', e);
  }
}

// Scenario 9: SPP server/client sockets over RFCOMM.
async function runSppScenario(deviceId: string): Promise<void> {
  try {
    const option = buildSppOption();
    let serverSocket = -1;
    bluetooth.sppListen('HarmonySppServer', option, (err: Error, socket: number) => {
      if (err) { console.error('sppListen error', err); return; }
      serverSocket = socket;
      console.info('spp listening socket=%d', socket);
    });
    let clientSocket = -1;
    bluetooth.sppAccept(serverSocket, (err: Error, socket: number) => {
      if (err) { console.error('sppAccept error', err); return; }
      clientSocket = socket;
      console.info('spp accepted socket=%d', socket);
    });
    bluetooth.sppConnect(deviceId, option, (err: Error, socket: number) => {
      if (err) { console.error('sppConnect error', err); return; }
      console.info('spp connected socket=%d', socket);
    });
    if (clientSocket >= 0) {
      bluetooth.sppCloseClientSocket(clientSocket);
    }
    if (serverSocket >= 0) {
      bluetooth.sppCloseServerSocket(serverSocket);
    }
  } catch (e) {
    console.error('runSppScenario failed', e);
  }
}

// ---------- Entry ----------

async function run(): Promise<void> {
  await manageBluetoothAdapter();
  await bondWithDevice(HEADSET_DEVICE);
  await inspectRemoteDevice(HEADSET_DEVICE);
  await manageA2dpProfile(HEADSET_DEVICE);
  await manageHfpProfile(HEADSET_DEVICE);
  await runBleClientScenario(SENSOR_DEVICE);
  await runBleServerScenario();
  await runBleScanScenario();
  await runSppScenario(HEADSET_DEVICE);
}

run();
