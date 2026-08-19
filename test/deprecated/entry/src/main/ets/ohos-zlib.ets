import zlib from '@ohos.zlib';

// Scenario: archive a log file for upload, then restore it on demand.
// Uses the legacy zipFile/unzipFile APIs (deprecated since 9) plus the
// deprecated ErrorCode enum for status interpretation.

const LOG_DIR: string = '/data/storage/el2/base/files/logs';
const ARCHIVE_DIR: string = '/data/storage/el2/base/files/archives';

async function compressLogForUpload(logName: string): Promise<void> {
  const inFile: string = `${LOG_DIR}/${logName}`;
  const outFile: string = `${ARCHIVE_DIR}/${logName}.zip`;
  const options: zlib.Options = {
    level: zlib.CompressLevel.COMPRESS_LEVEL_BEST_COMPRESSION,
    memLevel: zlib.MemLevel.MEM_LEVEL_DEFAULT,
    strategy: zlib.CompressStrategy.COMPRESS_STRATEGY_DEFAULT_STRATEGY,
  };
  try {
    await zlib.zipFile(inFile, outFile, options);
    console.info(`archived ${inFile} -> ${outFile}`);
  } catch (e) {
    console.error('zipFile failed', e);
  }
}

async function restoreLogFromArchive(archiveName: string): Promise<void> {
  const inFile: string = `${ARCHIVE_DIR}/${archiveName}`;
  const outFile: string = `${LOG_DIR}/restored`;
  const options: zlib.Options = {
    level: zlib.CompressLevel.COMPRESS_LEVEL_DEFAULT_COMPRESSION,
    strategy: zlib.CompressStrategy.COMPRESS_STRATEGY_DEFAULT_STRATEGY,
  };
  try {
    await zlib.unzipFile(inFile, outFile, options);
    console.info(`restored ${inFile} -> ${outFile}`);
  } catch (e) {
    if (e instanceof Error) {
      // Map the legacy error code for downstream handling.
      const legacyCode: zlib.ErrorCode = zlib.ErrorCode.ERROR_CODE_ERRNO;
      console.error(`restore failed (legacy ${legacyCode}, ${zlib.ErrorCode.ERROR_CODE_OK}=ok)`, e.message);
    } else {
      console.error('restore failed', e);
    }
  }
}

async function run(): Promise<void> {
  await compressLogForUpload('app-2026-08-17.log');
  await restoreLogFromArchive('app-2026-08-17.log.zip');
}

run();
