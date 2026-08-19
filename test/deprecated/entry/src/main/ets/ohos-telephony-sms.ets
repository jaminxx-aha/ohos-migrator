import sms from '@ohos.telephony.sms';
import util from '@ohos.util';
import BusinessError from '@ohos.base';

// Scenario: an OTP notification module built on the legacy sendMessage API.
// Resolves the default SMS slot, validates device capability and inputs,
// fragments long OTP bodies, tracks send/delivery callbacks per segment,
// retries once on transient operator errors, and reports a final outcome.

interface SmsSegmentOutcome {
  partIndex: number;
  partTotal: number;
  sent: boolean;
  delivered: boolean;
  result: number;
  url: string;
  failureReason?: string;
}

interface OtpDispatchResult {
  destination: string;
  slotId: number;
  segments: SmsSegmentOutcome[];
  allDelivered: boolean;
  dispatchedAt: number;
  completedAt: number;
}

const MAX_SMS_BODY_BYTES = 140;
const OTP_TTL_MINUTES = 5;
const TRANSIENT_RESULT_CODES = new Set<number>([8300002, 8300003, 8300999]);

function buildOtpBodies(otp: string, purpose: string): string[] {
  const base = `[${purpose}] Your verification code is ${otp}. ` +
    `It expires in ${OTP_TTL_MINUTES} minutes. Do not share it with anyone.`;
  // Naive fragmentation for the legacy path: keep each part within byte budget.
  const encoder = new util.TextEncoder();
  const bytes: number[] = Array.from(encoder.encode(base));
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < base.length) {
    let chunk = base.slice(cursor);
    let chunkBytes = bytes.slice(cursor);
    while (chunkBytes.length > MAX_SMS_BODY_BYTES && chunk.length > 1) {
      chunk = chunk.slice(0, chunk.length - 1);
      chunkBytes = chunkBytes.slice(0, chunkBytes.length - 1);
    }
    parts.push(chunk);
    cursor += chunk.length;
  }
  if (parts.length === 0) {
    parts.push(base);
  }
  return parts;
}

async function getDefaultSlotId(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    sms.getDefaultSmsSlotId((err: Error, slotId: number) => {
      if (err) {
        reject(err);
      } else {
        resolve(slotId);
      }
    });
  });
}

function dispatchSegment(
  slotId: number,
  destination: string,
  serviceCenter: string,
  body: string,
  partIndex: number,
  partTotal: number
): Promise<SmsSegmentOutcome> {
  return new Promise<SmsSegmentOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: SmsSegmentOutcome) => {
      if (!settled) {
        settled = true;
        resolve(outcome);
      }
    };

    const outcome: SmsSegmentOutcome = {
      partIndex,
      partTotal,
      sent: false,
      delivered: false,
      result: -1,
      url: '',
    };

    const safetyTimer = setTimeout(() => {
      outcome.failureReason = `timeout waiting for callbacks (part ${partIndex + 1}/${partTotal})`;
      console.warn(`SMS: ${outcome.failureReason}`);
      finish(outcome);
    }, 30_000);

    try {
      sms.sendMessage({
        slotId,
        destinationHost: destination,
        serviceCenter,
        content: body,
        sendCallback: (err: BusinessError, info: sms.ISendShortMessageCallback) => {
          if (err) {
            outcome.failureReason = `send error ${err.code}`;
            console.warn(`SMS: ${outcome.failureReason} (part ${partIndex + 1}/${partTotal})`);
            clearTimeout(safetyTimer);
            finish(outcome);
            return;
          }
          outcome.result = info.result;
          outcome.url = info.url ?? '';
          outcome.sent = info.result === 0;
          if (!outcome.sent) {
            outcome.failureReason = `send failed result=${info.result}`;
            console.warn(`SMS: ${outcome.failureReason} (part ${partIndex + 1}/${partTotal})`);
          } else {
            console.info(
              `SMS: send ack part ${partIndex + 1}/${partTotal} -> ${destination} ` +
              `result=${info.result} url=${info.url}`
            );
          }
          if (outcome.delivered || !outcome.sent) {
            clearTimeout(safetyTimer);
            finish(outcome);
          }
        },
        deliveryCallback: (err: BusinessError, info: sms.IDeliveryShortMessageCallback) => {
          if (err) {
            return;
          }
          outcome.delivered = true;
          console.info(
            `SMS: delivery part ${partIndex + 1}/${partTotal} -> ${destination} ` +
            `pduBytes=${info.pdu.length}`
          );
          if (outcome.sent || !outcome.delivered) {
            clearTimeout(safetyTimer);
            finish(outcome);
          }
        },
      });
    } catch (e) {
      clearTimeout(safetyTimer);
      outcome.failureReason = `sendMessage threw: ${e.message}`;
      console.error(`SMS: ${outcome.failureReason}`);
      finish(outcome);
    }
  });
}

async function sendOtpSms(
  phoneNumber: string,
  otp: string,
  purpose: string,
  serviceCenter = ''
): Promise<OtpDispatchResult> {
  if (!phoneNumber || phoneNumber.length < 6) {
    throw new Error(`SMS: invalid destination "${phoneNumber}"`);
  }
  if (!/^\d{4,8}$/.test(otp)) {
    throw new Error(`SMS: invalid OTP format "${otp}"`);
  }
  if (!sms.hasSmsCapability()) {
    throw new Error('SMS: device has no SMS capability');
  }

  let slotId: number;
  try {
    slotId = await getDefaultSlotId();
    console.info(`SMS: resolved default SMS slot id = ${slotId}`);
  } catch (e) {
    console.warn('SMS: failed to resolve default SMS slot id, falling back to 0', e);
    slotId = 0;
  }

  const bodies = buildOtpBodies(otp, purpose);
  const dispatchedAt = Date.now();
  const segments: SmsSegmentOutcome[] = [];

  for (let i = 0; i < bodies.length; i++) {
    const attempt = await dispatchSegment(slotId, phoneNumber, serviceCenter, bodies[i], i, bodies.length);

    if (!attempt.sent && TRANSIENT_RESULT_CODES.has(attempt.result)) {
      console.warn(`SMS: retrying part ${i + 1}/${bodies.length} after transient result=${attempt.result}`);
      const retry = await dispatchSegment(slotId, phoneNumber, serviceCenter, bodies[i], i, bodies.length);
      segments.push(retry.sent || retry.delivered ? retry : attempt);
    } else {
      segments.push(attempt);
    }
  }

  const allDelivered = segments.length > 0 && segments.every((s) => s.delivered);
  const result: OtpDispatchResult = {
    destination: phoneNumber,
    slotId,
    segments,
    allDelivered,
    dispatchedAt,
    completedAt: Date.now(),
  };

  if (!result.allDelivered) {
    console.error(
      `SMS: OTP dispatch to ${phoneNumber} completed with partial delivery; ` +
      `sent=${segments.filter((s) => s.sent).length}/${segments.length}, ` +
      `delivered=${segments.filter((s) => s.delivered).length}/${segments.length}`
    );
  } else {
    console.info(`SMS: OTP dispatch to ${phoneNumber} fully delivered (${segments.length} part(s))`);
  }
  return result;
}

async function run(): Promise<void> {
  try {
    const result = await sendOtpSms('+8613800138000', '836214', 'AcmeBank login');
    console.info(
      `SMS: run summary destination=${result.destination} slot=${result.slotId} ` +
      `allDelivered=${result.allDelivered} elapsedMs=${result.completedAt - result.dispatchedAt}`
    );
  } catch (e) {
    console.error('SMS: OTP notification workflow failed', e);
  }
}

run();
