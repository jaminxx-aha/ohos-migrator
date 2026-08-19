import camera from '@ohos.multimedia.camera';
import BusinessError from '@ohos.base';

// Scenario: a custom photo capture flow built on the legacy CaptureSession
// pipeline (deprecated since 11 in favour of the Session family). The flow
// enumerates the device cameras, wires a preview + photo capture session,
// queries and adjusts flash/exposure/focus/zoom/stabilization settings,
// subscribes to capture events, then drives the preview and photo outputs and
// tears everything down.

interface CaptureHandles {
  session: camera.CaptureSession;
  photoOutput: camera.PhotoOutput;
  previewOutput: camera.PreviewOutput;
  input: camera.CameraInput;
}

async function setupCaptureSession(
  mgr: camera.CameraManager,
  surfaceId: string
): Promise<CaptureHandles> {
  const cams: Array<camera.CameraDevice> = mgr.getSupportedCameras();
  const cam: camera.CameraDevice = cams[0];

  // Deprecated since 11; prefer getSupportedOutputCapability(cam, mode).
  const cap: camera.CameraOutputCapability = mgr.getSupportedOutputCapability(cam);

  const photoProfiles: Array<camera.Profile> = cap.photoProfiles;
  const previewProfiles: Array<camera.Profile> = cap.previewProfiles;
  const photoProfile: camera.Profile = photoProfiles[0];
  const previewProfile: camera.Profile = previewProfiles[0];

  // Deprecated since 11; prefer CameraManager#createSession.
  const session: camera.CaptureSession = mgr.createCaptureSession();

  // Deprecated since 11; prefer createPhotoOutput(profile?).
  const photoOutput: camera.PhotoOutput =
    mgr.createPhotoOutput(photoProfile, surfaceId);
  const previewOutput: camera.PreviewOutput =
    mgr.createPreviewOutput(previewProfile, surfaceId);

  // CAMERA_POSITION_FOLD_INNER is deprecated since 12.
  const foldInner = camera.CameraPosition.CAMERA_POSITION_FOLD_INNER;
  console.info(`fold-inner camera position enum = ${foldInner}`);

  const input: camera.CameraInput = mgr.createCameraInput(cam);
  session.beginConfig();
  session.addInput(input);
  session.addOutput(photoOutput);
  session.addOutput(previewOutput);
  await session.commitConfig();
  return { session, photoOutput, previewOutput, input };
}

async function queryAndAdjustSession(session: camera.CaptureSession): Promise<void> {
  const hasFlash: boolean = session.hasFlash();
  const flashSupported: boolean =
    session.isFlashModeSupported(camera.FlashMode.FLASH_MODE_CLOSE);
  console.info(`hasFlash=${hasFlash} flashCloseSupported=${flashSupported}`);
  const currentFlash: camera.FlashMode = session.getFlashMode();
  session.setFlashMode(camera.FlashMode.FLASH_MODE_CLOSE);

  const expSupported: boolean =
    session.isExposureModeSupported(camera.ExposureMode.EXPOSURE_MODE_UNSPECIFIED);
  console.info(`exposureUnspecifiedSupported=${expSupported}`);
  const currentExp: camera.ExposureMode = session.getExposureMode();
  session.setExposureMode(camera.ExposureMode.EXPOSURE_MODE_UNSPECIFIED);
  const biasRange: Array<number> = session.getExposureBiasRange();
  if (biasRange.length > 0) {
    session.setExposureBias(biasRange[0]);
  }
  const expValue: number = session.getExposureValue();

  const focusSupported: boolean =
    session.isFocusModeSupported(camera.FocusMode.FOCUS_MODE_MANUAL);
  console.info(`focusManualSupported=${focusSupported} expValue=${expValue}`);
  const currentFocus: camera.FocusMode = session.getFocusMode();
  session.setFocusMode(camera.FocusMode.FOCUS_MODE_MANUAL);
  const focusPoint: camera.Point = session.getFocusPoint();
  session.setFocusPoint({ x: 480, y: 640 });
  const meteringPoint: camera.Point = session.getMeteringPoint();
  session.setMeteringPoint({ x: 480, y: 640 });
  const focalLength: number = session.getFocalLength();
  console.info(`focusMode=${currentFocus} focusPoint=${JSON.stringify(focusPoint)} ` +
    `meteringPoint=${JSON.stringify(meteringPoint)} focalLength=${focalLength}`);

  const zoomRange: Array<number> = session.getZoomRatioRange();
  const currentZoom: number = session.getZoomRatio();
  if (zoomRange.length > 0) {
    session.setZoomRatio(zoomRange[0]);
  }

  const vsSupported: boolean =
    session.isVideoStabilizationModeSupported(camera.VideoStabilizationMode.OFF);
  const currentVs: camera.VideoStabilizationMode =
    session.getActiveVideoStabilizationMode();
  session.setVideoStabilizationMode(camera.VideoStabilizationMode.OFF);
  console.info(`vsSupported=${vsSupported} currentVs=${currentVs} currentZoom=${currentZoom}`);

  const focusCb = (err: BusinessError, state: camera.FocusState): void => {
    if (err) { console.error('focus state error', err); return; }
    console.info(`focus state changed -> ${state}`);
  };
  session.on('focusStateChange', focusCb);
  session.off('focusStateChange', focusCb);
}

function wirePhotoEvents(photoOutput: camera.PhotoOutput): void {
  const onCaptureStart = (err: BusinessError, data: number): void => {
    if (err) { console.error('captureStart error', err); return; }
    console.info(`photo capture started, id=${data}`);
  };
  photoOutput.on('captureStart', onCaptureStart);
  photoOutput.off('captureStart', onCaptureStart);
}

function reconfigureSession(
  session: camera.CaptureSession,
  input: camera.CameraInput,
  photoOutput: camera.PhotoOutput
): void {
  // Swap the active photo pipeline: these removeInput/removeOutput overloads
  // are deprecated since 11 in favour of Session#removeInput/removeOutput.
  session.beginConfig();
  session.removeInput(input);
  session.removeOutput(photoOutput);
  session.addInput(input);
  session.addOutput(photoOutput);
}

async function runCapture(
  session: camera.CaptureSession,
  previewOutput: camera.PreviewOutput
): Promise<void> {
  try {
    await session.start();
    await previewOutput.start();
    await previewOutput.stop();
    await session.stop();
  } catch (e) {
    console.error('capture session run failed', e);
  } finally {
    await session.release();
  }
}

async function run(): Promise<void> {
  const mgr: camera.CameraManager = camera.getCameraManager(context);
  const handles = await setupCaptureSession(mgr, 'surface-0');
  await queryAndAdjustSession(handles.session);
  wirePhotoEvents(handles.photoOutput);
  reconfigureSession(handles.session, handles.input, handles.photoOutput);
  await runCapture(handles.session, handles.previewOutput);
}

declare const context: Context;
run();
