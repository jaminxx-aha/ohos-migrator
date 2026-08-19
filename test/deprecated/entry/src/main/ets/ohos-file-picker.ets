import picker from '@ohos.file.picker';

// Scenario 1: Save user-captured photos to the public gallery with explicit file names.
async function saveCapturedPhotos(): Promise<void> {
  try {
    const saveOptions = new picker.PhotoSaveOptions();
    saveOptions.newFileNames = ['IMG_20260817_001.jpg', 'IMG_20260817_002.jpg'];
    const photoPicker = new picker.PhotoViewPicker();
    const saveResult = await photoPicker.save(saveOptions);
    console.info('saveCapturedPhotos ok', JSON.stringify(saveResult));
  } catch (e) {
    console.error('saveCapturedPhotos failed', e);
  }
}

// Scenario 2: Let the user pick a batch of images+videos from the gallery.
async function pickGalleryMedia(): Promise<void> {
  try {
    const selectOptions = new picker.PhotoSelectOptions();
    selectOptions.MIMEType = picker.PhotoViewMIMETypes.IMAGE_VIDEO_TYPE;
    selectOptions.maxSelectNumber = 9;
    const photoPicker = new picker.PhotoViewPicker();
    const selectResult: picker.PhotoSelectResult = await photoPicker.select(selectOptions);
    console.info('picked uris', JSON.stringify(selectResult.photoUris));
    console.info('original flag', selectResult.isOriginalPhoto);
  } catch (e) {
    console.error('pickGalleryMedia failed', e);
  }
}

// Scenario 3: Inspect the supported MIME-type enum values (compile-time references).
function logSupportedMimeTypes(): void {
  const supported: picker.PhotoViewMIMETypes[] = [
    picker.PhotoViewMIMETypes.IMAGE_TYPE,
    picker.PhotoViewMIMETypes.VIDEO_TYPE,
    picker.PhotoViewMIMETypes.IMAGE_VIDEO_TYPE,
  ];
  console.info('supported MIME types', supported.join(','));
}

async function run(): Promise<void> {
  logSupportedMimeTypes();
  await saveCapturedPhotos();
  await pickGalleryMedia();
}

run();
