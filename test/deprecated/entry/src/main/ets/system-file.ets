import File from '@system.file';
import {
  FileAccessOption, FileCopyOption, FileDeleteOption, FileGetOption, FileListOption, FileListResponse,
  FileMkdirOption, FileMoveOption, FileReadArrayBufferOption, FileReadArrayBufferResponse,
  FileReadTextOption, FileReadTextResponse, FileResponse, FileRmdirOption,
  FileWriteArrayBufferOption, FileWriteTextOption,
} from '@system.file';

// Base URI for the lite-runtime notes workspace (internal sandbox path).
const BASE_URI = 'internal://cache/notes/';
const NOTES_FILE = BASE_URI + 'readme.txt';
const BACKUP_FILE = BASE_URI + 'readme.bak.txt';

// Inspect each option before dispatch so every deprecated option/response field is
// resolved by the compiler against the SDK type (one touch per field).
function inspectAccess(o: FileAccessOption): void {
  console.info('access', o.uri, !!o.success, !!o.fail, !!o.complete);
}
function inspectMkdir(o: FileMkdirOption): void {
  console.info('mkdir', o.uri, o.recursive, !!o.success, !!o.fail, !!o.complete);
}
function inspectList(o: FileListOption): void {
  console.info('list', o.uri, !!o.success, !!o.fail, !!o.complete);
}
function inspectGet(o: FileGetOption): void {
  console.info('get', o.uri, o.recursive, !!o.success, !!o.fail, !!o.complete);
}
function inspectCopy(o: FileCopyOption): void {
  console.info('copy', o.srcUri, o.dstUri, !!o.success, !!o.fail, !!o.complete);
}
function inspectMove(o: FileMoveOption): void {
  console.info('move', o.srcUri, o.dstUri, !!o.success, !!o.fail, !!o.complete);
}
function inspectDelete(o: FileDeleteOption): void {
  console.info('delete', o.uri, !!o.success, !!o.fail, !!o.complete);
}
function inspectRmdir(o: FileRmdirOption): void {
  console.info('rmdir', o.uri, o.recursive, !!o.success, !!o.fail, !!o.complete);
}
function inspectWriteText(o: FileWriteTextOption): void {
  console.info('writeText', o.uri, o.text.length, o.encoding, o.append, !!o.success, !!o.fail, !!o.complete);
}
function inspectReadText(o: FileReadTextOption): void {
  console.info('readText', o.uri, o.encoding, o.position, o.length, !!o.success, !!o.fail, !!o.complete);
}
function inspectReadArrayBuffer(o: FileReadArrayBufferOption): void {
  console.info('readArrayBuffer', o.uri, o.position, o.length, !!o.success, !!o.fail, !!o.complete);
}
function inspectWriteArrayBuffer(o: FileWriteArrayBufferOption): void {
  console.info('writeArrayBuffer', o.uri, o.buffer.byteLength, o.position, o.append, !!o.success, !!o.fail, !!o.complete);
}

// Scenario 1: provision the notes directory, verify it is reachable, list its contents.
function provisionWorkspace(): void {
  const mkdirOpt: FileMkdirOption = {
    uri: BASE_URI, recursive: true,
    success: () => console.info('mkdir ok', BASE_URI),
    fail: (data: string, code: number) => console.error('mkdir fail', data, code),
    complete: () => console.info('mkdir done'),
  };
  inspectMkdir(mkdirOpt);
  File.mkdir(mkdirOpt);

  const accessOpt: FileAccessOption = {
    uri: BASE_URI,
    success: () => console.info('access ok', BASE_URI),
    fail: (data: string, code: number) => console.error('access fail', data, code),
    complete: () => console.info('access done'),
  };
  inspectAccess(accessOpt);
  File.access(accessOpt);

  const listOpt: FileListOption = {
    uri: BASE_URI,
    success: (data: FileListResponse) => {
      const entries: Array<FileResponse> = data.fileList;
      for (const f of entries) {
        console.info('entry', f.uri, f.length, f.lastModifiedTime, f.type, (f.subFiles ?? []).length);
      }
    },
    fail: (data: string, code: number) => console.error('list fail', data, code),
    complete: () => console.info('list done'),
  };
  inspectList(listOpt);
  File.list(listOpt);
}

// Scenario 2: write a text note (append, utf-8) then read it back as text and as a buffer.
function writeAndReadNote(): void {
  const writeOpt: FileWriteTextOption = {
    uri: NOTES_FILE, text: 'hello notes\n', encoding: 'UTF-8', append: true,
    success: () => console.info('writeText ok', NOTES_FILE),
    fail: (data: string, code: number) => console.error('writeText fail', data, code),
    complete: () => console.info('writeText done'),
  };
  inspectWriteText(writeOpt);
  File.writeText(writeOpt);

  const readTextOpt: FileReadTextOption = {
    uri: NOTES_FILE, encoding: 'UTF-8', position: 0, length: 64,
    success: (data: FileReadTextResponse) => console.info('readText ok', data.text),
    fail: (data: string, code: number) => console.error('readText fail', data, code),
    complete: () => console.info('readText done'),
  };
  inspectReadText(readTextOpt);
  File.readText(readTextOpt);

  const readBufOpt: FileReadArrayBufferOption = {
    uri: NOTES_FILE, position: 0, length: 64,
    success: (data: FileReadArrayBufferResponse) => console.info('readArrayBuffer ok', data.buffer.byteLength),
    fail: (data: string, code: number) => console.error('readArrayBuffer fail', data, code),
    complete: () => console.info('readArrayBuffer done'),
  };
  inspectReadArrayBuffer(readBufOpt);
  File.readArrayBuffer(readBufOpt);

  // Prepare (dry-run) a binary write config — exercise the array-buffer option schema
  // without dispatching File.writeArrayBuffer (kept out of this file's coverage set).
  const writeBufOpt: FileWriteArrayBufferOption = {
    uri: NOTES_FILE + '.bin', buffer: new Uint8Array([0x48, 0x49]), position: 0, append: false,
    success: () => console.info('writeArrayBuffer ok'),
    fail: (data: string, code: number) => console.error('writeArrayBuffer fail', data, code),
    complete: () => console.info('writeArrayBuffer done'),
  };
  inspectWriteArrayBuffer(writeBufOpt);
}

// Scenario 3: copy the note to a backup, move the backup into the workspace, stat it, then clean up.
function organizeBackups(): void {
  const copyOpt: FileCopyOption = {
    srcUri: NOTES_FILE, dstUri: BACKUP_FILE,
    success: (dstUri: string) => console.info('copy ok', dstUri),
    fail: (data: string, code: number) => console.error('copy fail', data, code),
    complete: () => console.info('copy done'),
  };
  inspectCopy(copyOpt);
  File.copy(copyOpt);

  const moveOpt: FileMoveOption = {
    srcUri: BACKUP_FILE, dstUri: BASE_URI + 'restored.txt',
    success: (dstUri: string) => console.info('move ok', dstUri),
    fail: (data: string, code: number) => console.error('move fail', data, code),
    complete: () => console.info('move done'),
  };
  inspectMove(moveOpt);
  File.move(moveOpt);

  const getOpt: FileGetOption = {
    uri: BASE_URI + 'restored.txt', recursive: false,
    success: (file: FileResponse) => console.info('get ok', file.uri, file.length, file.type),
    fail: (data: string, code: number) => console.error('get fail', data, code),
    complete: () => console.info('get done'),
  };
  inspectGet(getOpt);
  File.get(getOpt);

  const deleteOpt: FileDeleteOption = {
    uri: BASE_URI + 'restored.txt',
    success: () => console.info('delete ok'),
    fail: (data: string, code: number) => console.error('delete fail', data, code),
    complete: () => console.info('delete done'),
  };
  inspectDelete(deleteOpt);
  File.delete(deleteOpt);

  const rmdirOpt: FileRmdirOption = {
    uri: BASE_URI, recursive: true,
    success: () => console.info('rmdir ok'),
    fail: (data: string, code: number) => console.error('rmdir fail', data, code),
    complete: () => console.info('rmdir done'),
  };
  inspectRmdir(rmdirOpt);
  File.rmdir(rmdirOpt);
}

function run(): void {
  provisionWorkspace();
  writeAndReadNote();
  organizeBackups();
}

run();
