import vibrator from '@ohos.vibrator';

// Scenario: trigger a brief haptic pulse to confirm a user action, then stop
// any pending vibration early if the user cancels.

async function confirmWithVibration(): Promise<void> {
  // Vibrate the motor for 200ms to acknowledge a button press.
  try {
    await new Promise<void>((resolve, reject) => {
      vibrator.vibrate(200, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  } catch (e) {
    console.error('vibrator.vibrate failed', e);
  }
}

async function cancelPendingVibration(): Promise<void> {
  // Stop any vibration that is still scheduled by time.
  try {
    await vibrator.stop(vibrator.VibratorStopMode.VIBRATOR_STOP_MODE_TIME);
  } catch (e) {
    console.error('vibrator.stop failed', e);
  }
}

async function run(): Promise<void> {
  await confirmWithVibration();
  await cancelPendingVibration();
}

run();
