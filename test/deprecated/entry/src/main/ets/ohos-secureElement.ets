import omapi from '@ohos.secureElement';

// Scenario: connect to a Secure Element (eSE) service, enumerate readers,
// open a session on the embedded SE, select a payment applet over the basic
// channel, transmit a SELECT APDU, and tear down cleanly.
async function connectToPaymentApplet(): Promise<void> {
  const stateHandler = (state: omapi.ServiceState): void => {
    console.info(`SE service state changed: ${state === omapi.ServiceState.CONNECTED ? 'CONNECTED' : 'DISCONNECTED'}`);
  };

  const seService: omapi.SEService = omapi.newSEService('serviceState', stateHandler);
  try {
    const readers: omapi.Reader[] = seService.getReaders();
    const targetReader = readers.find((r) => r.getName().startsWith('eSE')) ?? readers[0];
    if (!targetReader || !targetReader.isSecureElementPresent()) {
      console.warn('No secure element present on target reader');
      seService.shutdown();
      return;
    }

    const session: omapi.Session = targetReader.openSession();
    try {
      const atr: number[] = session.getATR();
      console.info(`SE ATR length: ${atr.length}`);

      // AID for a hypothetical payment applet (A0000000041010 = Mastercard)
      const paymentAid: number[] = [0xA0, 0x00, 0x00, 0x00, 0x04, 0x10, 0x10];
      const channel: omapi.Channel = await session.openBasicChannel(paymentAid);
      try {
        // SELECT by DF name APDU (ISO 7816-4)
        const selectApdu: number[] = [0x00, 0xA4, 0x04, 0x00, paymentAid.length, ...paymentAid, 0x00];
        const response: number[] = await channel.transmit(selectApdu);
        const sw = (response[response.length - 2] << 8) | response[response.length - 1];
        console.info(`APDU response SW: 0x${sw.toString(16).toUpperCase()}`);
      } finally {
        channel.close();
      }
    } finally {
      session.close();
    }
  } catch (e) {
    console.error('Secure Element operation failed', e);
  } finally {
    seService.shutdown();
  }
}

connectToPaymentApplet();
