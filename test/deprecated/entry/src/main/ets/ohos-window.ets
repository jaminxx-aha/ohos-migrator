import window from '@ohos.window';

// Window lifecycle scenario: create a system-alert overlay window, configure its
// appearance/layout, query its state, listen for avoid-area changes, and tear it down.

async function createOverlayWindow(name: string): Promise<window.Window> {
  const config: window.Configuration = {
    name: name,
    windowType: window.WindowType.TYPE_SYSTEM_ALERT,
  };
  return await window.createWindow(config);
}

async function showAndLoad(win: window.Window): Promise<void> {
  try {
    await win.show();
    await win.loadContent('pages/OverlayPage');
  } catch (e) {
    console.error('showAndLoad failed', e);
  }
}

async function configureAppearance(win: window.Window): Promise<void> {
  try {
    await win.setColorSpace(window.ColorSpace.DEFAULT);
    await win.setBrightness(0.8);
    await win.setBackgroundColor('#FF000000');
    await win.setKeepScreenOn(true);
    await win.setPrivacyMode(true);
    await win.setFocusable(true);
    await win.setTouchable(true);
    await win.setOutsideTouchable(false);
    win.setDimBehind(0.5, (err) => {
      if (err) {
        console.error('setDimBehind callback error', err);
      }
    });
  } catch (e) {
    console.error('configureAppearance failed', e);
  }
}

async function configureLayout(win: window.Window): Promise<void> {
  try {
    await win.moveTo(0, 0);
    await win.resetSize(720, 1280);
    await win.setFullScreen(false);
    await win.setLayoutFullScreen(false);
    await win.setWindowLayoutFullScreen(false);
    await win.setSystemBarEnable(['status', 'navigation']);
    await win.setWindowSystemBarEnable(['status']);
    const barProps: window.SystemBarProperties = {
      statusBarColor: '#FFF0F0F0',
      isStatusBarLightIcon: true,
    };
    await win.setSystemBarProperties(barProps);
    await win.setWindowSystemBarProperties(barProps);
  } catch (e) {
    console.error('configureLayout failed', e);
  }
}

async function queryWindowState(win: window.Window): Promise<void> {
  try {
    const colorSpace = await win.getColorSpace();
    const wideGamut = await win.isSupportWideGamut();
    const showing = await win.isShowing();
    const props = await win.getProperties();
    console.info(
      'window state: colorSpace=' + colorSpace + ' wideGamut=' + wideGamut +
      ' showing=' + showing + ' dimBehind=' + props.dimBehindValue +
      ' roundCorner=' + props.isRoundCorner
    );
    const avoidArea = await win.getAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
    console.info('avoidArea height=' + avoidArea.bottomRect.height);
  } catch (e) {
    console.error('queryWindowState failed', e);
  }
}

function registerAvoidAreaListener(win: window.Window): void {
  win.on('systemAvoidAreaChange', (area) => {
    console.info('systemAvoidAreaChange height=' + area.bottomRect.height);
  });
}

function unregisterAvoidAreaListener(win: window.Window): void {
  win.off('systemAvoidAreaChange');
}

async function findAndDestroy(name: string): Promise<void> {
  try {
    const found = await window.find(name);
    await found.destroy();
  } catch (e) {
    console.error('findAndDestroy failed', e);
  }
}

async function run(): Promise<void> {
  const overlayName = 'overlayWindow';
  const win = await createOverlayWindow(overlayName);
  await showAndLoad(win);
  await configureAppearance(win);
  await configureLayout(win);
  await queryWindowState(win);
  registerAvoidAreaListener(win);
  unregisterAvoidAreaListener(win);
  await findAndDestroy(overlayName);
}

run();
