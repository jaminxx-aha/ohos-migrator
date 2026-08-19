import process from '@ohos.process';

// Inspect the runtime environment and process identity for a diagnostics report.
function inspectProcessEnvironment(): void {
  const lang: string = process.getEnvironmentVar('LANG');
  console.info('LANG=' + lang);

  const pageSize: number = process.getSystemConfig(0);
  const tid: number = process.getThreadPriority(0);
  console.info('systemConfig[0]=' + pageSize + ', threadPriority=' + tid);

  const uid: number = process.getUidForName('com.example.runtime');
  const appOwned: boolean = process.isAppUid(uid);
  console.info('uid=' + uid + ', isAppUid=' + appOwned);
}

// Forward a signal to another process as part of a supervised-shutdown workflow.
function sendShutdownSignal(): void {
  const sent: boolean = process.kill(15, 0);
  if (!sent) {
    console.error('failed to deliver shutdown signal');
  }
}

async function run(): Promise<void> {
  try {
    inspectProcessEnvironment();
    sendShutdownSignal();
  } catch (e) {
    console.error('process diagnostics failed', e);
  }
  // Best-effort termination of the current process after diagnostics flush.
  process.exit(0);
}

run();
