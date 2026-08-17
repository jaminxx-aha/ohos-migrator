import connection from '@ohos.bluetooth.connection';

/**
 * Brand the local Bluetooth controller with a user-facing friendly name before
 * starting a pairing flow so that nearby devices can recognise it.
 */
function applyDeviceFriendlyName(): void {
  const friendlyName = `HarmonyOS-Phone-${Math.floor(Math.random() * 9000) + 1000}`;
  try {
    connection.setLocalName(friendlyName);
    const confirmed: string = connection.getLocalName();
    if (confirmed !== friendlyName) {
      console.error('localName mismatch after setLocalName', confirmed, friendlyName);
    }
  } catch (e) {
    console.error('setLocalName failed', e);
  }
}

async function run(): Promise<void> {
  applyDeviceFriendlyName();
}

run();
