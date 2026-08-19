import radio from '@ohos.telephony.radio';

// Scenario: A network-capability assessment / radio-state reporter module.
// Before scheduling a high-bandwidth live stream, we probe the active SIM's
// radio capabilities and NR (5G New Radio) support so the media pipeline can
// pick an adaptive bitrate ladder that won't stall on a downlink handoff.
//
// Note: isNrSupported() is deprecated since API 9 — newer code should call
// radio.isNRSupported() instead. We continue to use the legacy call here so
// the assessment path remains compatible with older device images that ship
// the original telephony.radio surface.

export type RadioLadder = '4K' | '1080p' | '720p' | '480p';

export interface RadioCapabilitySnapshot {
  checkedAt: number;
  slotId: number;
  nrSupported: boolean;
  recommendedMaxLadder: RadioLadder;
  downlinkHint: string;
  warnings: string[];
}

// Per-slot capability probe. Wrapped in try/catch because some legacy images
// throw when the modem is warming up or the slot has no active subscription.
export function probeSlotCapability(slotId: number): RadioCapabilitySnapshot {
  const warnings: string[] = [];
  let nrSupported = false;

  try {
    // Legacy API: returns true if the device/active card supports 5G NR.
    nrSupported = radio.isNrSupported();
    if (!nrSupported) {
      warnings.push(`slot ${slotId}: NR not supported by active card/modem`);
    }
  } catch (e) {
    warnings.push(`slot ${slotId}: isNrSupported() threw — ${(e as Error).message}`);
    nrSupported = false;
  }

  // Translate raw radio capability into a bitrate ladder the streamer can use.
  let recommendedMaxLadder: RadioLadder;
  let downlinkHint: string;
  if (nrSupported) {
    recommendedMaxLadder = '4K';
    downlinkHint = '5G NR available — permit UHD ladder (2160p/1440p/1080p/720p).';
  } else {
    // Fall back to a conservative ladder; sub-NR links rarely sustain >1080p.
    recommendedMaxLadder = '1080p';
    downlinkHint = '5G NR unavailable — cap primary at 1080p, keep 720p/480p fallbacks.';
  }

  return {
    checkedAt: Date.now(),
    slotId,
    nrSupported,
    recommendedMaxLadder,
    downlinkHint,
    warnings,
  };
}

// Assess a candidate slot before a streaming session begins. Returns a report
// the media orchestrator consumes to set its ABR ceiling and retry policy.
export async function assessForStreaming(slotId: number): Promise<RadioCapabilitySnapshot> {
  // Tiny settle delay so a just-inserted SIM has a chance to register before
  // we probe; avoids a transient false-negative on NR support.
  await new Promise<void>((resolve) => setTimeout(resolve, 250));

  const snapshot = probeSlotCapability(slotId);

  // Post-probe: if we saw warnings, log them for the ops dashboard but don't
  // block the session — the orchestrator will degrade gracefully.
  if (snapshot.warnings.length > 0) {
    console.warn(`radio assessment slot ${slotId}: ${snapshot.warnings.join('; ')}`);
  }
  console.info(
    `radio assessment slot ${slotId}: nr=${snapshot.nrSupported} ladder=${snapshot.recommendedMaxLadder}`
  );
  return snapshot;
}

// Pick the best slot from a list of candidates (e.g. dual-SIM devices).
// Prefers any slot reporting NR support; otherwise returns the first slot.
export async function selectStreamingSlot(slotIds: number[]): Promise<RadioCapabilitySnapshot> {
  if (slotIds.length === 0) {
    throw new Error('selectStreamingSlot: no slot ids provided');
  }

  let best: RadioCapabilitySnapshot | null = null;
  for (const slotId of slotIds) {
    const snap = await assessForStreaming(slotId);
    if (snap.nrSupported) {
      return snap; // first NR-capable slot wins
    }
    if (best === null || snap.warnings.length < best.warnings.length) {
      best = snap;
    }
  }
  // No NR-capable slot; return the cleanest fallback we saw.
  return best as RadioCapabilitySnapshot;
}

// Module self-test: run a single-slot assessment and emit the chosen strategy.
export async function main(): Promise<void> {
  try {
    const report = await assessForStreaming(0);
    console.info('network strategy:', report.downlinkHint);
  } catch (e) {
    console.error(`radio capability assessment failed: ${(e as Error).message}`);
  }
}

main();
