import commonEventManager from '@ohos.commonEventManager';

// Legacy Bluetooth + user-present common events still surfaced to the
// telemetry subscriber. These Support members are deprecated since API 20
// but remain the only way to register for the matching system broadcasts.
const monitoredEvents: string[] = [
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_A2DPSINK_AUDIO_STATE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_A2DPSINK_CONNECT_STATE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_A2DPSINK_PLAYING_STATE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_A2DPSOURCE_AVRCP_CONNECT_STATE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_A2DPSOURCE_CODEC_VALUE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_A2DPSOURCE_CONNECT_STATE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_A2DPSOURCE_CURRENT_DEVICE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_A2DPSOURCE_PLAYING_STATE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HANDSFREEUNIT_AG_CALL_STATE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HANDSFREEUNIT_AG_COMMON_EVENT,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HANDSFREEUNIT_AUDIO_STATE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HANDSFREEUNIT_CONNECT_STATE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HANDSFREE_AG_AUDIO_STATE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HANDSFREE_AG_CONNECT_STATE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HANDSFREE_AG_CURRENT_DEVICE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HOST_DISCOVERY_FINISHED,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HOST_DISCOVERY_STARTED,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HOST_NAME_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HOST_REQ_DISABLE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HOST_REQ_DISCOVERABLE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HOST_REQ_ENABLE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HOST_SCAN_MODE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HOST_STATE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_ACL_CONNECTED,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_ACL_DISCONNECTED,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_BATTERY_VALUE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_CLASS_VALUE_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_CONNECT_CANCEL,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_CONNECT_REPLY,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_CONNECT_REQ,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_DISCOVERED,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_NAME_UPDATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_PAIRING_CANCEL,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_PAIRING_REQ,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_PAIR_STATE,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_SDP_RESULT,
  commonEventManager.Support.COMMON_EVENT_BLUETOOTH_REMOTEDEVICE_UUID_VALUE,
  commonEventManager.Support.COMMON_EVENT_USER_PRESENT,
];

function publishBluetoothHeartbeat(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    commonEventManager.publish('app.bluetooth.heartbeat', (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function registerBluetoothEventMonitor(): Promise<void> {
  const subscribeInfo: commonEventManager.CommonEventSubscribeInfo = {
    events: monitoredEvents,
  };
  const subscriber = await commonEventManager.createSubscriber(subscribeInfo);
  await commonEventManager.subscribeToEvent(subscriber, (data) => {
    console.info('bluetooth event received: ' + data.event);
  });
}

async function run(): Promise<void> {
  try {
    await registerBluetoothEventMonitor();
  } catch (e) {
    console.error('register bluetooth monitor failed', e);
  }
  try {
    await publishBluetoothHeartbeat();
  } catch (e) {
    console.error('publish bluetooth heartbeat failed', e);
  }
}

run();
