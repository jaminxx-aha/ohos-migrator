import Prompt from '@system.prompt';
import { ShowToastOptions } from '@system.prompt';

// Scenario: build and display a toast notification using the (deprecated)
// @system.prompt ShowToastOptions shape, reading each deprecated field so the
// toast options are validated before being passed to Prompt.showToast.

function buildToastOptions(text: string, durationMs: number, bottomOffset: number): ShowToastOptions {
  const options: ShowToastOptions = {
    message: text,
    duration: durationMs,
    bottom: bottomOffset,
  };
  return options;
}

function showToastNotification(text: string, durationMs: number, bottomOffset: number): void {
  const options = buildToastOptions(text, durationMs, bottomOffset);

  // Validate the deprecated option fields before showing the toast.
  if (options.message.length === 0) {
    console.error('showToast: message must not be empty');
    return;
  }
  if (options.duration !== undefined && (options.duration < 1500 || options.duration > 10000)) {
    console.error('showToast: duration out of recommended range [1500, 10000]');
    return;
  }
  if (options.bottom !== undefined && typeof options.bottom === 'number' && options.bottom < 0) {
    console.error('showToast: bottom offset must not be negative');
    return;
  }

  Prompt.showToast(options);
}

async function run(): Promise<void> {
  try {
    showToastNotification('Saved successfully', 2000, 80);
    showToastNotification('Network error, please retry', 3000, 120);
  } catch (e) {
    console.error('Failed to show toast notification', e);
  }
}

run();
