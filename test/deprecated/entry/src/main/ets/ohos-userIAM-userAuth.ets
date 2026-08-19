import userAuth from '@ohos.userIAM.userAuth';

// Map the deprecated (API 8) ResultCode enum values to readable labels.
function describeLegacyResultCode(code: number): string {
  switch (code) {
    case userAuth.ResultCode.SUCCESS: return 'success';
    case userAuth.ResultCode.FAIL: return 'fail';
    case userAuth.ResultCode.GENERAL_ERROR: return 'general_error';
    case userAuth.ResultCode.CANCELED: return 'canceled';
    case userAuth.ResultCode.TIMEOUT: return 'timeout';
    case userAuth.ResultCode.TYPE_NOT_SUPPORT: return 'type_not_support';
    case userAuth.ResultCode.TRUST_LEVEL_NOT_SUPPORT: return 'trust_level_not_support';
    case userAuth.ResultCode.BUSY: return 'busy';
    case userAuth.ResultCode.INVALID_PARAMETERS: return 'invalid_parameters';
    case userAuth.ResultCode.LOCKED: return 'locked';
    case userAuth.ResultCode.NOT_ENROLLED: return 'not_enrolled';
    default: return 'unknown';
  }
}

// Map the deprecated (API 6) AuthenticationResult enum values to readable labels.
function describeAuthenticationResult(code: number): string {
  switch (code) {
    case userAuth.AuthenticationResult.NO_SUPPORT: return 'no_support';
    case userAuth.AuthenticationResult.SUCCESS: return 'success';
    case userAuth.AuthenticationResult.COMPARE_FAILURE: return 'compare_failure';
    case userAuth.AuthenticationResult.CANCELED: return 'canceled';
    case userAuth.AuthenticationResult.TIMEOUT: return 'timeout';
    case userAuth.AuthenticationResult.CAMERA_FAIL: return 'camera_fail';
    case userAuth.AuthenticationResult.BUSY: return 'busy';
    case userAuth.AuthenticationResult.INVALID_PARAMETERS: return 'invalid_parameters';
    case userAuth.AuthenticationResult.LOCKED: return 'locked';
    case userAuth.AuthenticationResult.NOT_ENROLLED: return 'not_enrolled';
    case userAuth.AuthenticationResult.GENERAL_ERROR: return 'general_error';
    default: return 'unknown';
  }
}

// Map the deprecated (API 8) FaceTips enum values to readable labels.
function describeFaceTip(tip: number): string {
  switch (tip) {
    case userAuth.FaceTips.FACE_AUTH_TIP_TOO_BRIGHT: return 'too_bright';
    case userAuth.FaceTips.FACE_AUTH_TIP_TOO_DARK: return 'too_dark';
    case userAuth.FaceTips.FACE_AUTH_TIP_TOO_CLOSE: return 'too_close';
    case userAuth.FaceTips.FACE_AUTH_TIP_TOO_FAR: return 'too_far';
    case userAuth.FaceTips.FACE_AUTH_TIP_TOO_HIGH: return 'too_high';
    case userAuth.FaceTips.FACE_AUTH_TIP_TOO_LOW: return 'too_low';
    case userAuth.FaceTips.FACE_AUTH_TIP_TOO_RIGHT: return 'too_right';
    case userAuth.FaceTips.FACE_AUTH_TIP_TOO_LEFT: return 'too_left';
    case userAuth.FaceTips.FACE_AUTH_TIP_TOO_MUCH_MOTION: return 'too_much_motion';
    case userAuth.FaceTips.FACE_AUTH_TIP_POOR_GAZE: return 'poor_gaze';
    case userAuth.FaceTips.FACE_AUTH_TIP_NOT_DETECTED: return 'not_detected';
    default: return 'unknown';
  }
}

// Map the deprecated (API 8) FingerprintTips enum values to readable labels.
function describeFingerprintTip(tip: number): string {
  switch (tip) {
    case userAuth.FingerprintTips.FINGERPRINT_AUTH_TIP_GOOD: return 'good';
    case userAuth.FingerprintTips.FINGERPRINT_AUTH_TIP_DIRTY: return 'dirty';
    case userAuth.FingerprintTips.FINGERPRINT_AUTH_TIP_INSUFFICIENT: return 'insufficient';
    case userAuth.FingerprintTips.FINGERPRINT_AUTH_TIP_PARTIAL: return 'partial';
    case userAuth.FingerprintTips.FINGERPRINT_AUTH_TIP_TOO_FAST: return 'too_fast';
    case userAuth.FingerprintTips.FINGERPRINT_AUTH_TIP_TOO_SLOW: return 'too_slow';
    default: return 'unknown';
  }
}

// Inspect the deprecated (API 8) AuthResult payload returned via IUserAuthCallback.
function inspectAuthResult(result: userAuth.AuthResult): void {
  const token = result.token;
  const remain = result.remainTimes;
  const freeze = result.freezingTime;
  console.info('auth result token/remainTimes/freezingTime', token, remain, freeze);
}

// Inspect the deprecated (API 9) AuthResultInfo payload delivered to AuthEvent.callback.
function inspectAuthResultInfo(info: userAuth.AuthResultInfo): void {
  console.info(
    'auth result info result/token/remainAttempts/lockoutDuration',
    info.result, info.token, info.remainAttempts, info.lockoutDuration,
  );
}

// Inspect the deprecated (API 9) TipInfo payload delivered to AuthEvent.callback.
function inspectTipInfo(tip: userAuth.TipInfo): void {
  console.info('auth tip module/tip', tip.module, tip.tip);
}

// Probe the deprecated (API 8) UserAuth class: version + availability check.
async function probeLegacyUserAuthClass(): Promise<void> {
  const legacy = new userAuth.UserAuth();
  try {
    const version = legacy.getVersion();
    console.info('userIAM version:', version);
    const status = legacy.getAvailableStatus(userAuth.UserAuthType.PIN, userAuth.AuthTrustLevel.ATL1);
    console.info('PIN@ATL1 available status:', status, describeLegacyResultCode(status));
  } catch (e) {
    console.error('legacy UserAuth probe failed', e);
  }
}

// Drive the deprecated (API 6) Authenticator.execute flow and the deprecated (API 8)
// IUserAuthCallback surface, inspecting the AuthResult payload.
async function executeLegacyFaceAuth(): Promise<void> {
  const authenticator: userAuth.Authenticator = userAuth.getAuthenticator();
  try {
    const code: number = await authenticator.execute('FACE_ONLY', 'S2');
    console.info('legacy execute result:', code, describeAuthenticationResult(code));
  } catch (e) {
    console.error('legacy execute failed', e);
  }

  const callback: userAuth.IUserAuthCallback = {
    onResult: (result: number, extraInfo: userAuth.AuthResult) => {
      console.info('onResult', result, describeLegacyResultCode(result));
      inspectAuthResult(extraInfo);
    },
    onAcquireInfo: (module: number, acquire: number, extraInfo: Object) => {
      console.info('onAcquireInfo', module, acquire, describeFaceTip(acquire), extraInfo);
    },
  };

  // Exercise the callback members directly, mimicking the runtime firing order.
  const sampleResult: userAuth.AuthResult = {
    token: new Uint8Array([0x01, 0x02, 0x03]),
    remainTimes: 3,
    freezingTime: 0,
  };
  callback.onResult(userAuth.ResultCode.LOCKED, sampleResult);
  callback.onAcquireInfo?.(1, userAuth.FaceTips.FACE_AUTH_TIP_TOO_DARK, new Object());
  callback.onAcquireInfo?.(2, userAuth.FingerprintTips.FINGERPRINT_AUTH_TIP_DIRTY, new Object());
}

// Drive the deprecated (API 9) AuthInstance lifecycle: register an AuthEvent listener,
// start authentication, then tear down via off/cancel.
async function runLegacyAuthInstanceFlow(challenge: Uint8Array): Promise<void> {
  // AuthInstance is deprecated since 10; build a typed stub against the legacy
  // surface so the deprecated on/start/off/cancel members are resolved by the compiler.
  const instance: userAuth.AuthInstance = {
    on: (name: userAuth.AuthEventKey, callback: userAuth.AuthEvent): void => {
      console.info('AuthInstance.on', name, callback);
    },
    off: (name: userAuth.AuthEventKey): void => {
      console.info('AuthInstance.off', name);
    },
    start: (): void => {
      console.info('AuthInstance.start');
    },
    cancel: (): void => {
      console.info('AuthInstance.cancel');
    },
  };

  const eventHandler: userAuth.AuthEvent = {
    callback: (info: userAuth.AuthResultInfo | userAuth.TipInfo) => {
      const asResult = info as userAuth.AuthResultInfo;
      if (asResult.result !== undefined) {
        inspectAuthResultInfo(asResult);
      } else {
        inspectTipInfo(info as userAuth.TipInfo);
      }
    },
  };

  const sampleInfo: userAuth.AuthResultInfo = {
    result: userAuth.ResultCode.SUCCESS,
    token: new Uint8Array([0x10, 0x20]),
    remainAttempts: 5,
    lockoutDuration: 0,
  };
  eventHandler.callback(sampleInfo);

  try {
    instance.on('result', eventHandler);
    instance.start();
    instance.off('result');
    instance.cancel();
  } catch (e) {
    console.error('legacy AuthInstance flow failed', e);
  }
  console.info('legacy AuthInstance flow done, challenge bytes', challenge.length);
}

async function run(): Promise<void> {
  await probeLegacyUserAuthClass();
  await executeLegacyFaceAuth();
  await runLegacyAuthInstanceFlow(new Uint8Array([0x9a, 0x11, 0x22]));
}

run();
