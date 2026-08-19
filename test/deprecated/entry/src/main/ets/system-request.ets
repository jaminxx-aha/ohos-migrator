import Request from '@system.request';
import { DownloadRequestOptions, DownloadResponse, OnDownloadCompleteOptions, OnDownloadCompleteResponse, RequestData, RequestFile, UploadRequestOptions, UploadResponse } from '@system.request';

// Scenario: download a firmware update package, observe its completion status,
// then upload a diagnostic report (file + form fields) to a backend service.
// Option objects are built field-by-field and normalized via a small validation
// pass so each deprecated property is explicitly resolved by the compiler.

function buildDownloadOptions(): DownloadRequestOptions {
  const options: DownloadRequestOptions = {
    url: 'https://updates.example.com/firmware/v2.3.bin',
    filename: 'firmware-v2.3.bin',
    description: 'Firmware update v2.3',
    header: 'Authorization: Bearer device-007-token',
    success: (data: DownloadResponse) => {
      const token: string = data.token;
      listenForDownloadComplete(token);
    },
    fail: (_data: Object, code: number) => {
      console.error('Firmware download failed', code);
    },
    complete: () => {
      console.log('Firmware download request finalized');
    },
  };
  // Normalize fields before dispatch.
  const u: string = options.url;
  const fn: string | undefined = options.filename;
  const d: string | undefined = options.description;
  const h: string | undefined = options.header;
  const s: ((data: DownloadResponse) => void) | undefined = options.success;
  const f: ((data: Object, code: number) => void) | undefined = options.fail;
  const c: (() => void) | undefined = options.complete;
  if (!u || !s || !f || !c) {
    throw new Error('invalid download options');
  }
  console.log('download options normalized', fn, d, h);
  return options;
}

function buildOnDownloadCompleteOptions(token: string): OnDownloadCompleteOptions {
  const options: OnDownloadCompleteOptions = {
    token,
    success: (data: OnDownloadCompleteResponse) => {
      const uri: string = data.uri;
      console.log('Downloaded package uri:', uri);
    },
    fail: (_data: Object, code: number) => {
      console.error('onDownloadComplete failed', code);
    },
    complete: () => {
      console.log('onDownloadComplete finalized');
    },
  };
  const t: string = options.token;
  const s: ((data: OnDownloadCompleteResponse) => void) | undefined = options.success;
  const f: ((data: Object, code: number) => void) | undefined = options.fail;
  const c: (() => void) | undefined = options.complete;
  if (!t || !s || !f || !c) {
    throw new Error('invalid onDownloadComplete options');
  }
  return options;
}

function buildReportFile(reportPath: string): RequestFile {
  const file: RequestFile = {
    filename: 'diagnostic-report.json',
    name: 'report',
    type: 'application/json',
    uri: reportPath,
  };
  const fn: string | undefined = file.filename;
  const n: string | undefined = file.name;
  const ty: string | undefined = file.type;
  const u: string = file.uri;
  if (!fn || !n || !ty || !u) {
    throw new Error('invalid report file');
  }
  return file;
}

function buildFormItem(): RequestData {
  const item: RequestData = {
    name: 'deviceId',
    value: 'device-007',
  };
  const n: string = item.name;
  const v: string = item.value;
  if (!n || !v) {
    throw new Error('invalid form item');
  }
  return item;
}

function buildUploadOptions(reportPath: string): UploadRequestOptions {
  const options: UploadRequestOptions = {
    url: 'https://api.example.com/v1/diagnostics',
    method: 'POST',
    header: { 'Content-Type': 'multipart/form-data' },
    files: [buildReportFile(reportPath)],
    data: [buildFormItem()],
    success: (data: UploadResponse) => {
      const code: number = data.code;
      const body: string = data.data;
      const headers: Object = data.headers;
      console.log('Upload completed', code, body, headers);
    },
    fail: (_data: Object, code: number) => {
      console.error('Diagnostic report upload failed', code);
    },
    complete: () => {
      console.log('Diagnostic report upload finalized');
    },
  };
  const u: string = options.url;
  const m: string | undefined = options.method;
  const h: Object | undefined = options.header;
  const fl: Array<RequestFile> = options.files;
  const d: Array<RequestData> | undefined = options.data;
  const s: ((data: UploadResponse) => void) | undefined = options.success;
  const f: ((data: Object, code: number) => void) | undefined = options.fail;
  const c: (() => void) | undefined = options.complete;
  if (!u || !fl || !s || !f || !c) {
    throw new Error('invalid upload options');
  }
  console.log('upload options normalized', m, h, d);
  return options;
}

function listenForDownloadComplete(token: string): void {
  Request.onDownloadComplete(buildOnDownloadCompleteOptions(token));
}

function downloadFirmwareUpdate(): void {
  Request.download(buildDownloadOptions());
}

function uploadDiagnosticReport(reportPath: string): void {
  Request.upload(buildUploadOptions(reportPath));
}

function run(): void {
  try {
    downloadFirmwareUpdate();
    uploadDiagnosticReport('internal://cache/diagnostic-report.json');
  } catch (e) {
    console.error('system-request scenario error', e);
  }
}

run();
