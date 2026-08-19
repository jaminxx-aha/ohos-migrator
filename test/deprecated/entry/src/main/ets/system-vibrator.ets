import Vibrator from '@system.vibrator';
import { VibrateOptions } from '@system.vibrator';

// Triggers a vibration of the given mode to give the user haptic feedback.
function triggerVibration(mode: 'short' | 'long'): void {
  const options: VibrateOptions = {
    mode,
    success: () => {
      console.info(`${mode} vibration started`);
    },
    fail: (data: string, code: number) => {
      console.error(`${mode} vibration failed: ${data} (code=${code})`);
    },
    complete: () => {
      console.info(`${mode} vibration complete`);
    },
  };
  // Inspect the configured callbacks/mode before firing.
  console.info(`vibration mode=${options.mode}`);
  const onSuccess = options.success;
  const onFail = options.fail;
  const onComplete = options.complete;
  if (onSuccess) onSuccess();
  if (onFail) onFail('none', 0);
  if (onComplete) onComplete();
  Vibrator.vibrate(options);
}

export function runVibrationScenarios(): void {
  // Short buzz for a UI button tap.
  triggerVibration('short');
  // Long vibration to alert the user of an incoming notification.
  triggerVibration('long');
}

runVibrationScenarios();
