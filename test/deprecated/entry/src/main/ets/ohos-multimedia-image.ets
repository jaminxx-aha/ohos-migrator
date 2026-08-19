import image from '@ohos.multimedia.image';

// Build a small in-memory JPEG-like buffer so ImageSource has something real to read.
function buildJpegBuffer(): ArrayBuffer {
  const buf = new ArrayBuffer(256);
  const view = new Uint8Array(buf);
  // Minimal JPEG SOI / EOI markers so the source is at least structurally plausible.
  view[0] = 0xff; view[1] = 0xd8; view[254] = 0xff; view[255] = 0xd9;
  return buf;
}

async function readImageMetadata(source: image.ImageSource): Promise<void> {
  try {
    // Deprecated options type; touch both deprecated fields exactly once.
    const opts: image.GetImagePropertyOptions = {};
    opts.index = 0;
    opts.defaultValue = 'unknown';
    const orientation: string = await source.getImageProperty('Orientation', opts);
    console.info('orientation = ' + orientation + ', idx=' + opts.index + ', def=' + opts.defaultValue);

    await source.modifyImageProperty('Orientation', '1');
  } catch (e) {
    console.error('readImageMetadata failed', e);
  }
}

async function packImageToJpeg(source: image.ImageSource): Promise<ArrayBuffer> {
  try {
    const packer: image.ImagePacker = image.createImagePacker();
    // Deprecated packing overload; prefer packToData in new code.
    const packed: ArrayBuffer = await packer.packing(source, { format: 'image/jpeg', quality: 90 });
    return packed;
  } catch (e) {
    console.error('packImageToJpeg failed', e);
    return new ArrayBuffer(0);
  }
}

function setupCameraPipeline(): void {
  // Deprecated factory overloads kept for legacy camera-preview pipelines.
  const creator: image.ImageCreator = image.createImageCreator(1920, 1080, image.ImageFormat.JPEG, 8);
  const receiver: image.ImageReceiver = image.createImageReceiver(1920, 1080, image.ImageFormat.JPEG, 8);
  console.info('creator capacity=' + creator + ', receiver=' + receiver);
}

async function run(): Promise<void> {
  const source: image.ImageSource = image.createImageSource(buildJpegBuffer());
  await readImageMetadata(source);
  await packImageToJpeg(source);
  setupCameraPipeline();
}

run();
