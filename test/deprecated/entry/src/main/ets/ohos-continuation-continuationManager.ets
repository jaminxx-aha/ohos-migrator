import continuationManager from '@ohos.continuation.continuationManager';

// Scenario: drive a distributed continuation (ability hop) lifecycle for a
// note-editing app — register for continuation, listen for device events,
// present the device picker, track a selected device's connection state, then
// tear down the registration. Exercises the deprecated continuationManager API
// surface end-to-end.

function buildExtraParams(): continuationManager.ContinuationExtraParams {
  const params: continuationManager.ContinuationExtraParams = {
    deviceType: ['00E', '00D'],
    targetBundle: 'com.example.notes',
    description: 'Continue editing the current note on a nearby device',
    filter: { screen: 'large', osVersion: 5 },
    continuationMode: continuationManager.ContinuationMode.COLLABORATION_MULTIPLE,
    authInfo: { 'account.id': 'u-1001', 'token': 'a1b2c3d4' }
  };
  return params;
}

function buildSingleParams(): continuationManager.ContinuationExtraParams {
  const params: continuationManager.ContinuationExtraParams = {
    deviceType: ['00E'],
    targetBundle: 'com.example.notes',
    description: 'Single-device collaboration session',
    filter: { screen: 'large' },
    continuationMode: continuationManager.ContinuationMode.COLLABORATION_SINGLE,
    authInfo: {}
  };
  return params;
}

function logExtraParams(params: continuationManager.ContinuationExtraParams): void {
  console.info(`continuation: mode=${params.continuationMode}, target=${params.targetBundle}`);
  console.info(`deviceType=${params.deviceType}, description=${params.description}`);
  console.info(`filter=${JSON.stringify(params.filter)}, authInfo=${JSON.stringify(params.authInfo)}`);
}

function describeResult(result: continuationManager.ContinuationResult): string {
  return `device id=${result.id}, name=${result.name}, type=${result.type}`;
}

async function registerAbility(options: continuationManager.ContinuationExtraParams): Promise<number> {
  try {
    const token: number = await continuationManager.register(options);
    return token;
  } catch (e) {
    console.error('register failed', e);
    return -1;
  }
}

async function registerAbilityV2(options: continuationManager.ContinuationExtraParams): Promise<number> {
  try {
    const token: number = await continuationManager.registerContinuation(options);
    return token;
  } catch (e) {
    console.error('registerContinuation failed', e);
    return -1;
  }
}

function attachDeviceConnectListener(): void {
  continuationManager.on('deviceConnect', (result: continuationManager.ContinuationResult) => {
    console.info('device connected: ' + describeResult(result));
  });
  continuationManager.off('deviceConnect');
}

function attachDeviceConnectStateProbe(): void {
  // Touch the DeviceConnectState enum members used across the lifecycle.
  const idle = continuationManager.DeviceConnectState.IDLE;
  const connecting = continuationManager.DeviceConnectState.CONNECTING;
  const connected = continuationManager.DeviceConnectState.CONNECTED;
  const disconnecting = continuationManager.DeviceConnectState.DISCONNECTING;
  console.info(`states: ${idle} ${connecting} ${connected} ${disconnecting}`);
}

async function startDevicePicker(token: number, options: continuationManager.ContinuationExtraParams): Promise<void> {
  try {
    await continuationManager.startDeviceManager(token, options);
  } catch (e) {
    console.error('startDeviceManager failed', e);
  }
}

async function startDevicePickerV2(token: number, options: continuationManager.ContinuationExtraParams): Promise<void> {
  try {
    await continuationManager.startContinuationDeviceManager(token, options);
  } catch (e) {
    console.error('startContinuationDeviceManager failed', e);
  }
}

async function reportConnectLifecycle(
  token: number,
  deviceId: string
): Promise<void> {
  try {
    await continuationManager.updateConnectStatus(token, deviceId, continuationManager.DeviceConnectState.CONNECTING);
    await continuationManager.updateConnectStatus(token, deviceId, continuationManager.DeviceConnectState.CONNECTED);
    await continuationManager.updateConnectStatus(token, deviceId, continuationManager.DeviceConnectState.DISCONNECTING);
    await continuationManager.updateConnectStatus(token, deviceId, continuationManager.DeviceConnectState.IDLE);

    await continuationManager.updateContinuationState(token, deviceId, continuationManager.DeviceConnectState.CONNECTING);
    await continuationManager.updateContinuationState(token, deviceId, continuationManager.DeviceConnectState.CONNECTED);
    await continuationManager.updateContinuationState(token, deviceId, continuationManager.DeviceConnectState.IDLE);
  } catch (e) {
    console.error('updateConnectStatus/updateContinuationState failed', e);
  }
}

async function unregisterAbility(token: number): Promise<void> {
  try {
    await continuationManager.unregister(token);
  } catch (e) {
    console.error('unregister failed', e);
  }
}

async function unregisterAbilityV2(token: number): Promise<void> {
  try {
    await continuationManager.unregisterContinuation(token);
  } catch (e) {
    console.error('unregisterContinuation failed', e);
  }
}

async function run(): Promise<void> {
  const multiParams = buildExtraParams();
  const singleParams = buildSingleParams();
  logExtraParams(multiParams);
  logExtraParams(singleParams);
  attachDeviceConnectStateProbe();
  attachDeviceConnectListener();

  const token = await registerAbility(multiParams);
  const tokenV2 = await registerAbilityV2(singleParams);
  const activeToken = token >= 0 ? token : tokenV2;

  await startDevicePicker(activeToken, multiParams);
  await startDevicePickerV2(activeToken, singleParams);

  const selectedDeviceId = 'device-0a1b-2c3d-4e5f';
  await reportConnectLifecycle(activeToken, selectedDeviceId);

  await unregisterAbility(activeToken);
  await unregisterAbilityV2(activeToken);
}

run();
