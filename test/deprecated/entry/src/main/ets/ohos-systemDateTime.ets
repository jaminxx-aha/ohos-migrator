import systemDateTime from '@ohos.systemDateTime';

// Scenario: collect runtime timing diagnostics (epoch ms, system Date, uptime).

async function getEpochMillis(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    systemDateTime.getCurrentTime(false, (err, time) => {
      if (err) {
        console.error('getCurrentTime failed', err);
        reject(err);
      } else {
        resolve(time);
      }
    });
  });
}

async function getSystemDate(): Promise<Date> {
  return new Promise<Date>((resolve, reject) => {
    systemDateTime.getDate((err, date) => {
      if (err) {
        console.error('getDate failed', err);
        reject(err);
      } else {
        resolve(date);
      }
    });
  });
}

async function getActiveUptime(nano: boolean): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    systemDateTime.getRealActiveTime(nano, (err, time) => {
      if (err) {
        console.error('getRealActiveTime failed', err);
        reject(err);
      } else {
        resolve(time);
      }
    });
  });
}

async function getRealUptime(nano: boolean): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    systemDateTime.getRealTime(nano, (err, time) => {
      if (err) {
        console.error('getRealTime failed', err);
        reject(err);
      } else {
        resolve(time);
      }
    });
  });
}

async function runDiagnostics(): Promise<void> {
  try {
    const epochMs: number = await getEpochMillis();
    const sysDate: Date = await getSystemDate();
    const activeMs: number = await getActiveUptime(false);
    const realNs: number = await getRealUptime(true);
    console.info(
      `epochMs=${epochMs} sysDate=${sysDate.toISOString()} activeMs=${activeMs} realNs=${realNs}`
    );
  } catch (e) {
    console.error('systemDateTime diagnostics failed', e);
  }
}

runDiagnostics();
