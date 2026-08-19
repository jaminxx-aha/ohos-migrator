import fileIo from '@ohos.file.fs';

// Scenario: subscribe to a copy-task cancellation event so the UI can react
// when a long-running file copy is aborted by the user.
async function watchCopyCancellation(signal: fileIo.TaskSignal): Promise<void> {
  try {
    const cancelReason: string = await signal.onCancel();
    console.info('Copy task was canceled, reason: ' + cancelReason);
  } catch (e) {
    console.error('Failed to subscribe to copy cancellation event', e);
  }
}

async function run(): Promise<void> {
  // A TaskSignal is normally attached to a copyFile call via CopyOptions.copySignal;
  // here we just create one to demonstrate listening for the cancel event.
  const signal: fileIo.TaskSignal = new fileIo.TaskSignal();
  await watchCopyCancellation(signal);
}

run();
