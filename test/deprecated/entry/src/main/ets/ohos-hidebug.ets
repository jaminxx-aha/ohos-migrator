import hidebug from '@ohos.hidebug';

// Diagnostics routine for the application profiling phase: captures a VM heap
// snapshot, then brackets a CPU-bound workload with start/stop profiling so the
// generated .heapsnapshot / cpuprofiler-*.json files land in the app files dir.

async function captureHeapSnapshot(): Promise<void> {
  try {
    hidebug.dumpHeapData('mem-leak-investigation');
  } catch (e) {
    console.error('dumpHeapData failed', e);
  }
}

async function profileStartupCpu(): Promise<void> {
  try {
    hidebug.startProfiling('startup-cpu-profile');
  } catch (e) {
    console.error('startProfiling failed', e);
    return;
  }

  try {
    // Simulated startup workload whose CPU cost we want to attribute.
    let acc = 0;
    for (let i = 0; i < 100000; i++) {
      acc += i;
    }
    console.info('startup workload accumulator', acc);
  } finally {
    try {
      hidebug.stopProfiling();
    } catch (e) {
      console.error('stopProfiling failed', e);
    }
  }
}

async function runDiagnostics(): Promise<void> {
  await captureHeapSnapshot();
  await profileStartupCpu();
}

async function run(): Promise<void> {
  await runDiagnostics();
}

run();
