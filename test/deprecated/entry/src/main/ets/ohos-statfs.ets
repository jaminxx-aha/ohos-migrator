import Statfs from '@ohos.statfs';

// Scenario: inspect remaining storage capacity on the device's user data path.

async function readFreeBytes(path: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    Statfs.getFreeBytes(path, (err: Error, bytes: number) => {
      if (err) {
        console.error('statfs.getFreeBytes failed', err);
        reject(err);
        return;
      }
      resolve(bytes);
    });
  });
}

async function readTotalBytes(path: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    Statfs.getTotalBytes(path, (err: Error, bytes: number) => {
      if (err) {
        console.error('statfs.getTotalBytes failed', err);
        reject(err);
        return;
      }
      resolve(bytes);
    });
  });
}

async function reportStorageUsage(path: string): Promise<void> {
  try {
    const freeBytes: number = await readFreeBytes(path);
    const totalBytes: number = await readTotalBytes(path);
    const usedBytes: number = totalBytes - freeBytes;
    const usagePct: number = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
    console.info(`storage usage for ${path}: used=${usedBytes}B, total=${totalBytes}B, ${usagePct.toFixed(2)}%`);
  } catch (e) {
    console.error('reportStorageUsage failed', e);
  }
}

async function run(): Promise<void> {
  const dataPath: string = '/data/storage/el2/base';
  await reportStorageUsage(dataPath);
}

run();
