import document from '@ohos.document';

// Scenario: let the user pick an image file, then open it with the system viewer.

async function pickImageFile(): Promise<string> {
  try {
    const uri = await document.choose(['image/*']);
    console.info('picked file uri:', uri);
    return uri;
  } catch (e) {
    console.error('choose image failed', e);
    return '';
  }
}

async function openFileWithViewer(uri: string, type: string): Promise<void> {
  if (!uri) {
    return;
  }
  try {
    await document.show(uri, type);
    console.info('document shown for', uri);
  } catch (e) {
    console.error('show document failed', e);
  }
}

async function run(): Promise<void> {
  const pickedUri = await pickImageFile();
  await openFileWithViewer(pickedUri, 'image/*');
}

run();
