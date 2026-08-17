import window from '@ohos.window';

declare let _v0: window.Window; _v0.destroy();
declare let _v1: window.Window; _v1.getAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
declare let _v2: window.Window; _v2.getColorSpace();
declare let _v3: window.Window; _v3.getProperties();
declare let _v4: window.Window; _v4.isShowing();
declare let _v5: window.Window; _v5.isSupportWideGamut();
declare let _v6: window.Window; _v6.loadContent('');
declare let _v7: window.Window; _v7.moveTo(0, 0);
declare let _v8: window.Window; _v8.off('systemAvoidAreaChange');
declare let _v9: window.Window; _v9.on('systemAvoidAreaChange', () => {});
declare let _v10: window.Window; _v10.resetSize(0, 0);
declare let _v11: window.Window; _v11.setBackgroundColor('');
declare let _v12: window.Window; _v12.setBrightness(0);
declare let _v13: window.Window; _v13.setColorSpace(window.ColorSpace.DEFAULT);
declare let _v14: window.Window; _v14.setDimBehind(0);
declare let _v15: window.Window; _v15.setFocusable(false);
declare let _v16: window.Window; _v16.setFullScreen(false);
declare let _v17: window.Window; _v17.setKeepScreenOn(false);
declare let _v18: window.Window; _v18.setLayoutFullScreen(false);
declare let _v19: window.Window; _v19.setOutsideTouchable(false);
declare let _v20: window.Window; _v20.setPrivacyMode(false);
declare let _v21: window.Window; _v21.setSystemBarEnable([]);
declare let _v22: window.Window; _v22.setSystemBarProperties;
declare let _v23: window.Window; _v23.setTouchable(false);
declare let _v24: window.Window; _v24.setWindowLayoutFullScreen(false, () => {});
declare let _v25: window.Window; _v25.setWindowSystemBarEnable([], () => {});
declare let _v26: window.Window; _v26.setWindowSystemBarProperties;
declare let _v27: window.Window; _v27.show();
declare let _v28: window.WindowProperties; _v28.dimBehindValue;
declare let _v29: window.WindowProperties; _v29.isRoundCorner;
window.WindowType.TYPE_SYSTEM_ALERT;
// @ohos.window.window.create: FA-model-only; not referenceable in stageMode (omitted)
window.find('');
// @ohos.window.window.getTopWindow: FA-model-only; not referenceable in stageMode (omitted)
