import bytrace from '@ohos.bytrace';

// Scenario: instrument a simulated image-cache refresh flow with the legacy
// bytrace API (deprecated since API 8 in favor of ohos.hiTraceMeter).

const TASK_ID = 1001;

/** Download an image, then write its bytes into the on-disk cache, tracing the whole step. */
async function refreshImageCacheStep(imageUrl: string, bytes: number): Promise<void> {
  bytrace.startTrace('ImageCacheRefresh', TASK_ID, 1500);
  try {
    bytrace.traceByValue('ImageCacheRefresh.bytes', bytes);
  } finally {
    bytrace.finishTrace('ImageCacheRefresh', TASK_ID);
  }
}

async function run(): Promise<void> {
  try {
    await refreshImageCacheStep('https://example.com/images/header.png', 204800);
  } catch (e) {
    console.error('refreshImageCacheStep failed', e);
  }
}

run();
