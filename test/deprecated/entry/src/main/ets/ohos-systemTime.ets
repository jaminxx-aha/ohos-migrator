import systemTime from '@ohos.systemTime';

// Module: deprecated systemTime adapter for a clock-sync + telemetry heartbeat service.
// Wraps the deprecated @ohos.systemTime surface (deprecated since 9 in favour of
// @ohos.systemDateTime) behind cohesive async helpers used by the telemetry scheduler.

interface ClockSnapshot {
  epochMs: number;          // wall-clock ms since Unix epoch (getCurrentTime)
  epochNanoNs: number;     // nanosecond variant, for high-resolution telemetry
  activeMs: number;        // uptime excluding deep sleep (getRealActiveTime)
  realMs: number;          // uptime including deep sleep (getRealTime)
  realNanoNs: number;     // nanosecond uptime, used to detect drift vs activeMs
  iso: string;             // human-readable system date (getDate)
  timezone: string;        // IANA timezone id (getTimezone)
  collectedAt: number;
}

interface SyncReport {
  referenceTs: number;
  appliedEpoch: number;
  appliedDateIso: string;
  appliedTimezone: string;
  skewMs: number;
  ok: boolean;
  error?: string;
}

// Well-known reference timezones the device may be asked to adopt; values are IANA ids
// accepted by systemTime.setTimezone. Order is intentional: we probe-then-commit.
const CANDIDATE_TIMEZONES: string[] = [
  'Asia/Shanghai',
  'UTC',
  'Europe/London',
  'America/New_York',
];

// Tolerance (ms) between wall clock and reference below which we treat them as in sync.
const SYNC_TOLERANCE_MS: number = 250;

// Read every deprecated clock surface in one pass and return a cohesive snapshot.
// Using both ms and ns variants of getCurrentTime / getRealTime / getRealActiveTime
// lets downstream code detect unit-conversion regressions when migrating to systemDateTime.
async function collectClockTelemetry(): Promise<ClockSnapshot> {
  // Wall clock: once in milliseconds, once in nanoseconds.
  const epochMs: number = await systemTime.getCurrentTime(false);
  const epochNanoNs: number = await systemTime.getCurrentTime(true);

  // Uptime excluding deep sleep (user-perceived active time).
  const activeMs: number = await systemTime.getRealActiveTime(false);
  const activeNanoNs: number = await systemTime.getRealActiveTime(true);

  // Uptime including deep sleep (true elapsed time since boot).
  const realMs: number = await systemTime.getRealTime(false);
  const realNanoNs: number = await systemTime.getRealTime(true);

  // System calendar date and timezone.
  const date: Date = await systemTime.getDate();
  const tz: string = await systemTime.getTimezone();

  // Sanity-check the two unit variants agree within plausible rounding; if they
  // diverge by more than a second the underlying clock may be mid-adjustment.
  const epochFromNs: number = Math.floor(epochNanoNs / 1e6);
  const skewMs: number = Math.abs(epochFromNs - epochMs);
  if (skewMs > 1000) {
    console.warn(`clock telemetry: ms/ns variant skew ${skewMs}ms exceeds 1s; clock may be mid-adjustment`);
  }

  // Active uptime should never exceed real uptime; flag if it does.
  if (activeMs > realMs) {
    console.warn(`clock telemetry: activeMs (${activeMs}) > realMs (${realMs}) — unexpected`);
  }

  const snapshot: ClockSnapshot = {
    epochMs,
    epochNanoNs,
    activeMs,
    realMs,
    realNanoNs,
    iso: date.toISOString(),
    timezone: tz,
    collectedAt: Date.now(),
  };
  console.info('clock telemetry snapshot', JSON.stringify(snapshot));
  return snapshot;
}

// Verify the device timezone is one of our known-good references; if not, log a
// warning but do not throw — readers may still consume the snapshot.
async function probeTimezone(expected: string): Promise<boolean> {
  const current: string = await systemTime.getTimezone();
  if (current !== expected) {
    console.warn(`timezone probe: expected '${expected}' but device reports '${current}'`);
    return false;
  }
  return true;
}

// Synchronise the device clock to a known-good reference timestamp and timezone.
// Steps: validate the reference, set wall-clock time, set the calendar date,
// commit a timezone, then verify by re-reading the clock.
async function syncDeviceClock(referenceTs: number, timezone: string): Promise<SyncReport> {
  const report: SyncReport = {
    referenceTs,
    appliedEpoch: 0,
    appliedDateIso: '',
    appliedTimezone: '',
    skewMs: 0,
    ok: false,
  };

  if (!Number.isFinite(referenceTs) || referenceTs <= 0) {
    report.error = `invalid referenceTs: ${referenceTs}`;
    console.error(`syncDeviceClock rejected: ${report.error}`);
    return report;
  }

  if (!CANDIDATE_TIMEZONES.includes(timezone)) {
    report.error = `unsupported timezone '${timezone}'`;
    console.error(`syncDeviceClock rejected: ${report.error}`);
    return report;
  }

  try {
    // 1. Set the wall-clock time first (requires SET_TIME permission).
    await systemTime.setTime(referenceTs);

    // 2. Set the calendar date to match the reference instant.
    const refDate: Date = new Date(referenceTs);
    await systemTime.setDate(refDate);

    // 3. Commit the target timezone (requires SET_TIME_ZONE permission).
    await systemTime.setTimezone(timezone);

    // 4. Verify by re-reading clock + timezone.
    const appliedEpoch: number = await systemTime.getCurrentTime(false);
    const appliedDate: Date = await systemTime.getDate();
    const appliedTz: string = await systemTime.getTimezone();

    report.appliedEpoch = appliedEpoch;
    report.appliedDateIso = appliedDate.toISOString();
    report.appliedTimezone = appliedTz;
    report.skewMs = Math.abs(appliedEpoch - referenceTs);

    if (appliedTz !== timezone) {
      report.error = `timezone not applied: expected '${timezone}', got '${appliedTz}'`;
      report.ok = false;
      console.error(`syncDeviceClock verification failed: ${report.error}`);
    } else if (report.skewMs > SYNC_TOLERANCE_MS) {
      report.error = `clock skew ${report.skewMs}ms exceeds tolerance ${SYNC_TOLERANCE_MS}ms`;
      report.ok = false;
      console.error(`syncDeviceClock verification failed: ${report.error}`);
    } else {
      report.ok = true;
      console.info(`syncDeviceClock ok: epoch=${appliedEpoch}, tz=${appliedTz}, skew=${report.skewMs}ms`);
    }
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    report.ok = false;
    console.error('syncDeviceClock failed', e);
  }

  return report;
}

interface HeartbeatResult {
  snapshot: ClockSnapshot | null;
  sync: SyncReport | null;
}

// Periodic heartbeat: collect telemetry, decide whether a re-sync is needed,
// and if so apply the reference clock. Returns the report for downstream batching.
async function runHeartbeat(referenceTs: number, timezone: string): Promise<HeartbeatResult> {
  let snapshot: ClockSnapshot | null = null;
  let sync: SyncReport | null = null;

  try {
    snapshot = await collectClockTelemetry();
  } catch (e) {
    console.error('heartbeat: telemetry collection failed', e);
  }

  if (snapshot !== null) {
    // If wall clock drifts from reference beyond tolerance, trigger a re-sync.
    const drift: number = Math.abs(snapshot.epochMs - referenceTs);
    const tzOk: boolean = await probeTimezone(timezone).catch((e: Error) => {
      console.error('heartbeat: timezone probe failed', e);
      return false;
    });

    if (drift > SYNC_TOLERANCE_MS || !tzOk) {
      console.info(`heartbeat: drift=${drift}ms, tzOk=${tzOk} — requesting re-sync`);
      sync = await syncDeviceClock(referenceTs, timezone);
    } else {
      console.info(`heartbeat: within tolerance (drift=${drift}ms), no re-sync needed`);
    }
  }

  return { snapshot, sync };
}

async function run(): Promise<void> {
  // Reference: a fixed known-good timestamp and a target timezone. In a real
  // deployment these come from an NTP/SNTP response; here we anchor to now.
  const referenceTs: number = Date.now();
  const timezone: string = CANDIDATE_TIMEZONES[0];

  await runHeartbeat(referenceTs, timezone);
}

run();
