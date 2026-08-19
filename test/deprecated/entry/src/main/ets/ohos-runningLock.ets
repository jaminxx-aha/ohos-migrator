import runningLock from '@ohos.runningLock';

// Scenario: keep the device awake while a background sync job runs, using the
// legacy (since-9/10) RunningLock APIs so the deprecated symbols stay exercised.

const LOCK_NAME = 'com.example.sync::BackgroundSyncLock';
const LOCK_TYPE = runningLock.RunningLockType.BACKGROUND;
const HOLD_TIMEOUT_MS = 30_000;

async function ensureBackgroundLockSupported(): Promise<boolean> {
  // Legacy check (deprecated since 9). Use the promise overload and surface
  // failures so the caller can fall back to a non-locked sync path.
  try {
    return await runningLock.isRunningLockTypeSupported(LOCK_TYPE);
  } catch (e) {
    console.error('isRunningLockTypeSupported failed', e);
    return false;
  }
}

async function acquireBackgroundLock(): Promise<runningLock.RunningLock | null> {
  // Legacy factory (deprecated since 9). Returns a RunningLock we can hold/release.
  try {
    return await runningLock.createRunningLock(LOCK_NAME, LOCK_TYPE);
  } catch (e) {
    console.error('createRunningLock failed', e);
    return null;
  }
}

async function runBackgroundSyncWithWakelock(): Promise<void> {
  const supported = await ensureBackgroundLockSupported();
  if (!supported) {
    console.warn('RunningLockType.BACKGROUND not supported; running sync without wakelock');
    return;
  }

  const lock = await acquireBackgroundLock();
  if (!lock) {
    return;
  }

  try {
    // Hold the lock for the duration of the sync window (deprecated since 9).
    lock.lock(HOLD_TIMEOUT_MS);

    if (!lock.isUsed()) {
      // Lock was not actually held; abort rather than run an unprotected sync.
      console.error('RunningLock.isUsed returned false after lock()');
      return;
    }

    await performBackgroundSync();
  } catch (e) {
    console.error('background sync failed', e);
  } finally {
    // Release the wakelock so the system may hibernate again (deprecated since 9).
    try {
      lock.unlock();
    } catch (e) {
      console.error('unlock failed', e);
    }
  }
}

async function performBackgroundSync(): Promise<void> {
  // Placeholder for the real sync work (fetch, merge, persist). The wakelock
  // above keeps the CPU awake while this promise resolves.
  await new Promise<void>((resolve) => setTimeout(resolve, 5000));
}

async function run(): Promise<void> {
  await runBackgroundSyncWithWakelock();
}

run();
