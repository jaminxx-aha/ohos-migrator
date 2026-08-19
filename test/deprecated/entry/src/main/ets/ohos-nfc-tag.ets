import tag from '@ohos.nfc.tag';

// Scenario: discover an NFC-A tag discovered by the reader, connect, exchange data, and clean up.
// Also demonstrates obtaining the per-technology tag views (NfcA/B/F/V) from a TagInfo.

async function exchangeWithNfcATag(tagInfo: tag.TagInfo): Promise<void> {
  // Obtain the per-technology tag views from the discovered TagInfo.
  const nfcA = tag.getNfcATag(tagInfo);
  const nfcB = tag.getNfcBTag(tagInfo);
  const nfcF = tag.getNfcFTag(tagInfo);
  const nfcV = tag.getNfcVTag(tagInfo);

  // Pick the NfcA view as the active session for this exchange.
  const session: tag.TagSession = nfcA;

  try {
    const connected: boolean = session.connectTag();
    if (!connected) {
      console.error('connectTag failed');
      return;
    }

    if (session.isTagConnected()) {
      // Tune the send-data timeout before transmitting.
      const ok: boolean = session.setSendDataTimeout(1000);
      if (!ok) {
        console.error('setSendDataTimeout failed');
      }
      const timeoutMs: number = session.getSendDataTimeout();

      const maxLen: number = session.getMaxSendLength();
      if (maxLen <= 0) {
        console.error('getMaxSendLength returned non-positive length');
        return;
      }

      // Realistic ISO-DEP SELECT command APDU for NfcA tag.
      const command: number[] = [0x00, 0xA4, 0x04, 0x00, 0x07, 0xA0, 0x00, 0x00, 0x06, 0x47, 0x2F, 0x00, 0x00];
      const response: number[] = await session.sendData(command);
      console.info('sendData response length:', response.length);

      // Inspect the discovered tag metadata.
      const info: tag.TagInfo = session.getTagInfo();
      const profiles: number[] = info.supportedProfiles;
      console.info('tag supportedProfiles:', profiles.length, 'timeout:', timeoutMs);
    }
  } catch (e) {
    console.error('nfc tag exchange failed', e);
  } finally {
    try {
      session.reset();
    } catch (e) {
      console.error('reset failed', e);
    }
  }

  // Reference the other per-technology views so they remain part of the discovery scenario.
  console.info('nfcB/nfcF/nfcV views obtained:', !!nfcB, !!nfcF, !!nfcV);
}

async function run(): Promise<void> {
  // A TagInfo as it would be delivered by the NFC tag-discovery callback.
  const discovered: tag.TagInfo = {
    uid: [0x04, 0xAB, 0xCD, 0xEF, 0x12, 0x34, 0x56],
    technology: [1, 2, 3],
    supportedProfiles: [],
  };
  await exchangeWithNfcATag(discovered);
}

run();
