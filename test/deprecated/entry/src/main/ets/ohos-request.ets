import request from '@ohos.request';
import common from '@ohos.app.ability.common';

// Build a FileSpec for the upload agent, exercising the deprecated mimeType field.
function buildAvatarFileSpec(): request.agent.FileSpec {
  const spec: request.agent.FileSpec = {
    path: './cache/avatar.png',
    filename: 'avatar.png',
    mimeType: 'image/png',
  };
  // Read back the deprecated MIME type so the symbol is referenced on a real instance.
  const declaredType: string | undefined = spec.mimeType;
  console.info('upload file mime type: ' + declaredType);
  return spec;
}

// Drive a download task through its lifecycle using the legacy callback-based APIs.
async function manageDownloadTask(context: common.Context): Promise<void> {
  const config: request.DownloadConfig = {
    url: 'https://cdn.example.com/release/update-package.zip',
    header: { 'Accept-Encoding': 'gzip' },
    enableMetered: false,
    enableRoaming: true,
    description: 'OTA update package',
    filePath: `${context.filesDir}/update-package.zip`,
    title: 'System update package',
    background: true,
  };

  try {
    request.downloadFile(context, config, (err, task) => {
      if (err || !task) {
        console.error('downloadFile failed', JSON.stringify(err));
        return;
      }
      // Query download info (deprecated since 9).
      task.query((qErr, info) => {
        if (qErr) {
          console.error('query download info failed', JSON.stringify(qErr));
        } else {
          console.info('download progress: ' + info.downloadedBytes + '/' + info.downloadTotalBytes);
        }
      });
      // Query the MIME type of the downloaded file (deprecated since 9).
      task.queryMimeType((mErr, mimeType) => {
        if (mErr) {
          console.error('queryMimeType failed', JSON.stringify(mErr));
        } else {
          console.info('downloaded file mime type: ' + mimeType);
        }
      });
      // Pause the session, then resume, then remove it (all deprecated since 9).
      task.pause((pErr) => {
        if (pErr) {
          console.error('pause failed', JSON.stringify(pErr));
          return;
        }
        task.resume((rErr) => {
          if (rErr) {
            console.error('resume failed', JSON.stringify(rErr));
            return;
          }
          task.remove((rmErr, removed) => {
            if (rmErr) {
              console.error('remove failed', JSON.stringify(rmErr));
            } else {
              console.info('download task removed: ' + removed);
            }
          });
        });
      });
    });
  } catch (e) {
    console.error('manageDownloadTask unexpected error', e);
  }
}

// Upload a crash report using the legacy callback-based removal API.
async function manageUploadTask(context: common.Context): Promise<void> {
  const uploadConfig: request.UploadConfig = {
    url: 'https://api.example.com/v1/crash-reports',
    header: { 'Content-Type': 'multipart/form-data' },
    method: 'POST',
    files: [
      {
        filename: 'crash-20260817.log',
        name: 'file',
        uri: `${context.filesDir}/crash-20260817.log`,
        type: 'text/plain',
      },
    ],
    data: [
      { name: 'appId', value: 'com.example.app' },
      { name: 'version', value: '2.4.1' },
    ],
  };

  try {
    request.uploadFile(context, uploadConfig, (err, task) => {
      if (err || !task) {
        console.error('uploadFile failed', JSON.stringify(err));
        return;
      }
      // Cancel the upload session (deprecated since 9).
      task.remove((rmErr, removed) => {
        if (rmErr) {
          console.error('upload remove failed', JSON.stringify(rmErr));
        } else {
          console.info('upload task removed: ' + removed);
        }
      });
    });
  } catch (e) {
    console.error('manageUploadTask unexpected error', e);
  }
}

async function run(context: common.Context): Promise<void> {
  buildAvatarFileSpec();
  await manageDownloadTask(context);
  await manageUploadTask(context);
}
