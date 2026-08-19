import Brightness from '@system.brightness';
import { BrightnessModeResponse, BrightnessResponse, GetBrightnessModeOptions, GetBrightnessOptions, SetBrightnessModeOptions, SetBrightnessOptions, SetKeepScreenOnOptions } from '@system.brightness';

// Defensive wiring check: the deprecated callback APIs only invoke the
// success/fail/complete hooks we actually attach, so verify each option set is
// fully wired before handing it off to the system.
function assertWiredGetBrightness(opts: GetBrightnessOptions): void {
  if (typeof opts.success !== 'function' || typeof opts.fail !== 'function' || typeof opts.complete !== 'function') {
    throw new Error('GetBrightnessOptions not fully wired');
  }
}

function assertWiredSetBrightness(opts: SetBrightnessOptions): void {
  if (typeof opts.success !== 'function' || typeof opts.fail !== 'function' || typeof opts.complete !== 'function') {
    throw new Error('SetBrightnessOptions not fully wired');
  }
}

function assertWiredGetBrightnessMode(opts: GetBrightnessModeOptions): void {
  if (typeof opts.success !== 'function' || typeof opts.fail !== 'function' || typeof opts.complete !== 'function') {
    throw new Error('GetBrightnessModeOptions not fully wired');
  }
}

function assertWiredSetBrightnessMode(opts: SetBrightnessModeOptions): void {
  if (typeof opts.success !== 'function' || typeof opts.fail !== 'function' || typeof opts.complete !== 'function') {
    throw new Error('SetBrightnessModeOptions not fully wired');
  }
}

function assertWiredSetKeepScreenOn(opts: SetKeepScreenOnOptions): void {
  if (typeof opts.success !== 'function' || typeof opts.fail !== 'function' || typeof opts.complete !== 'function') {
    throw new Error('SetKeepScreenOnOptions not fully wired');
  }
}

// Scenario 1: read the current screen brightness value (callback API wrapped as a Promise).
async function readBrightnessValue(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const opts: GetBrightnessOptions = {
      success: (data: BrightnessResponse) => { resolve(data.value); },
      fail: (data: string, code: number) => { reject({ data, code }); },
      complete: () => { /* lifecycle hook */ }
    };
    assertWiredGetBrightness(opts);
    Brightness.getValue(opts);
  });
}

// Scenario 2: read the screen brightness adjustment mode (manual vs auto).
async function readBrightnessMode(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const opts: GetBrightnessModeOptions = {
      success: (data: BrightnessModeResponse) => { resolve(data.mode); },
      fail: (data: string, code: number) => { reject({ data, code }); },
      complete: () => { /* lifecycle hook */ }
    };
    assertWiredGetBrightnessMode(opts);
    Brightness.getMode(opts);
  });
}

// Scenario 3: raise screen brightness and keep the screen awake for in-car navigation.
async function enableNavigationBrightness(): Promise<void> {
  const keepOpts: SetKeepScreenOnOptions = {
    keepScreenOn: true,
    success: () => { console.log('keep-screen-on applied'); },
    fail: (data: string, code: number) => { console.error('setKeepScreenOn failed', data, code); },
    complete: () => { /* lifecycle hook */ }
  };
  assertWiredSetKeepScreenOn(keepOpts);
  if (!keepOpts.keepScreenOn) { return; }
  Brightness.setKeepScreenOn(keepOpts);

  await new Promise<void>((resolve, reject) => {
    const setOpts: SetBrightnessOptions = {
      value: 200,
      success: () => { console.log('brightness raised to', setOpts.value); },
      fail: (data: string, code: number) => { reject({ data, code }); },
      complete: () => { resolve(); }
    };
    assertWiredSetBrightness(setOpts);
    Brightness.setValue(setOpts);
  });
}

// Scenario 4: switch the device into automatic brightness mode.
async function enableAutoBrightness(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const modeOpts: SetBrightnessModeOptions = {
      mode: 1,
      success: () => { console.log('auto brightness enabled (mode', modeOpts.mode + ')'); },
      fail: (data: string, code: number) => { reject({ data, code }); },
      complete: () => { resolve(); }
    };
    assertWiredSetBrightnessMode(modeOpts);
    Brightness.setMode(modeOpts);
  });
}

async function run(): Promise<void> {
  try {
    const value = await readBrightnessValue();
    console.log('current brightness', value);
    const mode = await readBrightnessMode();
    console.log('current mode', mode);
    await enableNavigationBrightness();
    await enableAutoBrightness();
  } catch (e) {
    console.error('brightness scenario failed', e);
  }
}

run();
