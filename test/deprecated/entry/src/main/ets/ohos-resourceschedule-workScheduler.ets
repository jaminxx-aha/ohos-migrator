import workScheduler from '@ohos.resourceschedule.workScheduler';

// Scenario: inspect this app's scheduled background works and check whether a
// previously registered repeating work last ran past its timeout window.

const SYNC_WORK_ID = 1001;

async function listAllScheduledWorks(): Promise<void> {
  try {
    const works = await new Promise<workScheduler.WorkInfo[]>((resolve, reject) => {
      workScheduler.obtainAllWorks((err) => {
        if (err) {
          reject(err);
        } else {
          resolve([] as workScheduler.WorkInfo[]);
        }
      });
    });
    console.info('obtainAllWorks succeeded, count=' + works.length);
    for (const w of works) {
      console.info('work: id=' + w.workId + ' bundle=' + w.bundleName);
    }
  } catch (e) {
    console.error('obtainAllWorks failed', e);
  }
}

async function checkSyncWorkTimeout(): Promise<void> {
  try {
    const timedOut = await new Promise<boolean>((resolve, reject) => {
      const result = workScheduler.isLastWorkTimeOut(SYNC_WORK_ID, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
    console.info('isLastWorkTimeOut workId=' + SYNC_WORK_ID + ' timedOut=' + timedOut);
  } catch (e) {
    console.error('isLastWorkTimeOut failed', e);
  }
}

async function run(): Promise<void> {
  await listAllScheduledWorks();
  await checkSyncWorkTimeout();
}

run();
