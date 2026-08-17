import connectedTag from '@ohos.connectedTag';

// Scenario: read the connected-tag's NDEF payload, echo a modified payload back,
// then tear down the session. Uses the legacy (since-9) connectedTag API surface.

async function syncNdefTag(): Promise<void> {
  const ready = connectedTag.init();
  if (!ready) {
    console.error('connectedTag.init failed');
    return;
  }

  try {
    const ndefData = await connectedTag.readNdefTag();
    console.info('read NDEF:', ndefData);

    const nextPayload = `${ndefData}|synced-${Date.now()}`;
    await connectedTag.writeNdefTag(nextPayload);
    console.info('wrote NDEF:', nextPayload);
  } catch (e) {
    console.error('connectedTag NDEF operation failed', e);
  } finally {
    if (!connectedTag.uninit()) {
      console.error('connectedTag.uninit failed');
    }
  }
}

syncNdefTag();
