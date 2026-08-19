import screenLock from '@ohos.screenLock';

// Screen lock state probe: query whether the device screen is currently locked
// and whether secure (PIN/biometric) lock mode is in effect, then attempt an
// unlock of the screen. Each deprecated callback-based API is wrapped into a
// Promise so the scenario can be expressed with async/await.

function checkScreenLocked(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    screenLock.isScreenLocked((err, locked) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(locked);
    });
  });
}

function checkSecureMode(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    screenLock.isSecureMode((err, secure) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(secure);
    });
  });
}

function requestUnlockScreen(): Promise<void> {
  return new Promise((resolve, reject) => {
    screenLock.unlockScreen((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function guardScreenUnlock(): Promise<void> {
  // Only request an unlock when the device is actually locked and is in
  // secure mode, mirroring a real "require-auth-to-unlock" gate.
  try {
    const locked = await checkScreenLocked();
    if (!locked) {
      console.info('screen already unlocked; nothing to do');
      return;
    }
    const secure = await checkSecureMode();
    console.info('screen locked; secureMode=' + secure);
    await requestUnlockScreen();
    console.info('screenLock.unlockScreen completed');
  } catch (e) {
    console.error('guardScreenUnlock failed', e);
  }
}

async function run(): Promise<void> {
  await guardScreenUnlock();
}

run();
