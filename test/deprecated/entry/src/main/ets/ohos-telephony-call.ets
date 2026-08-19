import call from '@ohos.telephony.call';

// Tracks the outcome of the most recent escalation attempt so the UI and
// telemetry consumers can react without re-querying the telephony stack.
interface DialOutcome {
  readonly target: string;
  readonly attemptedAt: number;
  readonly accepted: boolean;
  readonly reason?: string;
}

// Normalizes an arbitrary phone-number-ish string into the canonical form the
// telephony stack expects: digits (and a leading '+' for international
// numbers) only, no spaces, dashes, or parentheses.
function normalizeNumber(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const isInternational = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 3) {
    // Anything shorter than a valid local extension is rejected up front so
    // we never hand a garbage value to the platform dial API.
    return null;
  }
  return isInternational ? `+${digits}` : digits;
}

// Maps a domain-specific call scenario onto the DialOptions the legacy dial()
// API consumes. Emergency calls carry the extras flag so the platform can
// surface them as priority out-going attempts, while routine callbacks keep
// the flag cleared to avoid triggering elevated routing.
function optionsForScenario(scenario: 'emergency' | 'callback' | 'followUp'): call.DialOptions {
  if (scenario === 'emergency') {
    return { extras: true };
  }
  if (scenario === 'followUp') {
    return { extras: false };
  }
  return { extras: false };
}

// Places an outgoing voice call to a contact's phone number using the
// legacy dial() API (deprecated since 9 in favor of dialCall). The function
// is async-safe: it awaits the platform promise, classifies failures, and
// always resolves to a DialOutcome so callers never need to try/catch.
async function placeVoiceCall(
  phoneNumber: string,
  scenario: 'emergency' | 'callback' | 'followUp',
): Promise<DialOutcome> {
  const normalized = normalizeNumber(phoneNumber);
  if (normalized === null) {
    const reason = `invalid phone number: "${phoneNumber}"`;
    console.error(`[telephony.call] refusing to dial: ${reason}`);
    return { target: phoneNumber, attemptedAt: Date.now(), accepted: false, reason };
  }

  const options = optionsForScenario(scenario);
  console.info(`[telephony.call] dialing ${normalized} (scenario=${scenario}, extras=${options.extras})`);

  try {
    const success: boolean = await call.dial(normalized, options);
    if (success) {
      console.info(`[telephony.call] dial request accepted for ${normalized}`);
    } else {
      console.warn(`[telephony.call] dial request rejected for ${normalized}`);
    }
    return { target: normalized, attemptedAt: Date.now(), accepted: success };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[telephony.call] dial threw for ${normalized}:`, message);
    return { target: normalized, attemptedAt: Date.now(), accepted: false, reason: message };
  }
}

// Escalation flow: try the primary contact first; if the platform rejects the
// dial request (e.g. line busy, no SIM, offline), fall back to a secondary
// contact before finally attempting the configured emergency number. Each
// attempt is awaited in turn so we never issue overlapping dials.
async function escalate(primary: string, secondary: string, emergency: string): Promise<DialOutcome> {
  const primaryOutcome = await placeVoiceCall(primary, 'callback');
  if (primaryOutcome.accepted) {
    return primaryOutcome;
  }

  console.warn('[telephony.call] primary dial rejected; escalating to secondary');
  const secondaryOutcome = await placeVoiceCall(secondary, 'followUp');
  if (secondaryOutcome.accepted) {
    return secondaryOutcome;
  }

  console.warn('[telephony.call] secondary dial rejected; escalating to emergency');
  return placeVoiceCall(emergency, 'emergency');
}

async function run(): Promise<void> {
  const outcome = await escalate('10086', '13800138000', '120');
  if (outcome.accepted) {
    console.info(`[telephony.call] escalation succeeded -> ${outcome.target}`);
  } else {
    console.error(`[telephony.call] escalation exhausted; last target=${outcome.target} reason=${outcome.reason ?? 'unknown'}`);
  }
}

run();
