import fileIO from '@ohos.fileio';
import BusinessError from '@ohos.base';

// Realistic app sandbox locations used by the scenarios below.
const SANDBOX_DIR = '/data/storage/el2/base/haps/entry/files';
const NOTES_DIR = `${SANDBOX_DIR}/notes`;
const LOG_FILE = `${SANDBOX_DIR}/runtime.log`;
const TARGET_FILE = `${SANDBOX_DIR}/demo.txt`;

interface StatMeta {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  size: number;
  blocks: number;
  atime: number;
  mtime: number;
  ctime: number;
}

interface StatKind {
  isFile: boolean;
  isDirectory: boolean;
  isBlockDevice: boolean;
  isCharacterDevice: boolean;
  isFIFO: boolean;
  isSocket: boolean;
  isSymbolicLink: boolean;
}

// Inspect a file's legacy Stat metadata (size, ownership, timestamps, type checks).
async function inspectFileStat(path: string): Promise<void> {
  try {
    const stat: fileIO.Stat = await fileIO.stat(path);
    const meta: StatMeta = {
      dev: stat.dev,
      ino: stat.ino,
      mode: stat.mode,
      nlink: stat.nlink,
      uid: stat.uid,
      gid: stat.gid,
      rdev: stat.rdev,
      size: stat.size,
      blocks: stat.blocks,
      atime: stat.atime,
      mtime: stat.mtime,
      ctime: stat.ctime,
    };
    const kind: StatKind = {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      isBlockDevice: stat.isBlockDevice(),
      isCharacterDevice: stat.isCharacterDevice(),
      isFIFO: stat.isFIFO(),
      isSocket: stat.isSocket(),
      isSymbolicLink: stat.isSymbolicLink(),
    };
    console.info('stat', JSON.stringify(meta), JSON.stringify(kind));
  } catch (e) {
    console.error('inspectFileStat failed', e);
  }
}

// Enumerate directory entries asynchronously and inspect the first Dirent.
async function enumerateDirectoryAsync(dirPath: string): Promise<void> {
  let dir: fileIO.Dir | undefined;
  try {
    dir = await fileIO.opendir(dirPath);
    let entry: fileIO.Dirent | undefined;
    try {
      entry = await dir.read();
    } catch (e) {
      // "NoMore" is thrown once all entries have been consumed.
      console.error('dir.read ended', e);
    }
    if (entry) {
      console.info('dirent', entry.name, entry.isFile(), entry.isDirectory(),
        entry.isBlockDevice(), entry.isCharacterDevice(), entry.isFIFO(),
        entry.isSocket(), entry.isSymbolicLink());
    }
  } catch (e) {
    console.error('enumerateDirectoryAsync failed', e);
  } finally {
    if (dir) {
      try {
        await dir.close();
      } catch (e) {
        console.error('dir.close failed', e);
      }
    }
  }
}

// Synchronous directory enumeration using the sync Dir API.
function enumerateDirectorySync(dirPath: string): void {
  let dir: fileIO.Dir | undefined;
  try {
    dir = fileIO.opendirSync(dirPath);
    try {
      dir.readSync();
    } catch (e) {
      console.error('dir.readSync ended', e);
    }
  } catch (e) {
    console.error('enumerateDirectorySync failed', e);
  } finally {
    if (dir) {
      try {
        dir.closeSync();
      } catch (e) {
        console.error('dir.closeSync failed', e);
      }
    }
  }
}

// Append a log line, flush buffers, then close the stream (async path).
async function flushAndCloseStream(path: string): Promise<void> {
  let stream: fileIO.Stream | undefined;
  try {
    stream = await fileIO.createStream(path, 'a');
    await stream.flush();
    console.info('stream flushed (async)');
  } catch (e) {
    console.error('flushAndCloseStream failed', e);
  } finally {
    if (stream) {
      try {
        await stream.close();
      } catch (e) {
        console.error('stream.close failed', e);
      }
    }
  }
}

// Sync variant: open, flush, and close a stream without yielding the event loop.
function flushAndCloseStreamSync(path: string): void {
  let stream: fileIO.Stream | undefined;
  try {
    stream = fileIO.createStreamSync(path, 'a');
    stream.flushSync();
    console.info('stream flushed (sync)');
  } catch (e) {
    console.error('flushAndCloseStreamSync failed', e);
  } finally {
    if (stream) {
      try {
        stream.closeSync();
      } catch (e) {
        console.error('stream.closeSync failed', e);
      }
    }
  }
}

// Inspect the shape of a legacy ReadOut. Stream.read is intentionally not
// exercised here (it is out of the original coverage set), so project a typed
// view of ReadOut to validate its metadata fields.
function inspectReadOutMetadata(): void {
  const readOut = {} as fileIO.ReadOut;
  const buffer: ArrayBuffer = readOut.buffer;
  const bytesRead: number = readOut.bytesRead;
  const offset: number = readOut.offset;
  console.info('readOut', bytesRead, offset, buffer.byteLength);
}

// Register a file watcher for change events and then stop observing.
async function observeFileWatcher(path: string): Promise<void> {
  const watcher: fileIO.Watcher = fileIO.createWatcher(path, 2, (err: BusinessError, data: number) => {
    if (err) { console.error('watcher error', err); return; }
    console.info('watcher event', data);
  });
  try {
    await watcher.stop();
    console.info('watcher stopped');
  } catch (e) {
    console.error('watcher.stop failed', e);
  }
}

async function run(): Promise<void> {
  await inspectFileStat(TARGET_FILE);
  await enumerateDirectoryAsync(NOTES_DIR);
  enumerateDirectorySync(NOTES_DIR);
  await flushAndCloseStream(LOG_FILE);
  flushAndCloseStreamSync(LOG_FILE);
  inspectReadOutMetadata();
  await observeFileWatcher(LOG_FILE);
}

run();
