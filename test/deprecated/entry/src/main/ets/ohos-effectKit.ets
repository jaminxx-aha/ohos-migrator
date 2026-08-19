import effectKit from '@ohos.effectKit';
import image from '@ohos.multimedia.image';

// Scenario: build a blur filter chain on a source image and read back the
// source PixelMap via the (deprecated) accessor before rendering.
async function applyBlurAndInspectSource(): Promise<void> {
  try {
    const opts: image.InitializationOptions = {
      alphaType: 0,
      editable: true,
      pixelFormat: image.PixelMapFormat.RGBA_8888,
      scaleMode: 1,
      size: { width: 4, height: 4 },
    };
    const sourcePixelMap = await image.createPixelMap(new ArrayBuffer(64), opts);

    const filter = effectKit.createEffect(sourcePixelMap);
    filter.blur(5);

    // Deprecated since 11; prefer filter.getEffectPixelMap().
    const sourceMap = filter.getPixelMap();
    if (sourceMap === null) {
      console.error('effectKit: getPixelMap returned null');
      return;
    }
    console.info('effectKit: retrieved source PixelMap from filter chain');
  } catch (e) {
    console.error('effectKit: applyBlurAndInspectSource failed', e);
  }
}

async function run(): Promise<void> {
  await applyBlurAndInspectSource();
}

run();
