import componentSnapshot from '@ohos.arkui.componentSnapshot';
import image from '@ohos.multimedia.image';

// A custom builder describing the component tree to snapshot off-screen.
const cardBuilder: CustomBuilder = () => {
  // Real app would declare an ArkUI component subtree here.
};

// Snapshot an on-screen component (identified by its .id attribute) and
// return the captured PixelMap, applying a render-wait and a 2x scale.
async function captureComponentById(componentId: string): Promise<image.PixelMap> {
  const options: componentSnapshot.SnapshotOptions = {
    scale: 2,
    waitUntilRenderFinished: true,
  };
  try {
    const pixelMap: image.PixelMap = await componentSnapshot.get(componentId, options);
    return pixelMap;
  } catch (e) {
    console.error('componentSnapshot.get failed for ' + componentId, e);
    throw e;
  }
}

// Render an off-screen component from a builder, waiting briefly for images to
// decode before capturing, then persist/share the resulting PixelMap.
async function captureBuilderSnapshot(): Promise<image.PixelMap> {
  const delay = 300;
  const checkImageStatus = true;
  const options: componentSnapshot.SnapshotOptions = {
    scale: 1,
    waitUntilRenderFinished: true,
  };
  try {
    const pixelMap: image.PixelMap = await componentSnapshot.createFromBuilder(
      cardBuilder,
      delay,
      checkImageStatus,
      options,
    );
    return pixelMap;
  } catch (e) {
    console.error('componentSnapshot.createFromBuilder failed', e);
    throw e;
  }
}

// Entry: capture both an on-screen card and an off-screen builder snapshot,
// then release the underlying image resources.
async function run(): Promise<void> {
  const onScreen = await captureComponentById('user_card');
  const offScreen = await captureBuilderSnapshot();

  try {
    onScreen.release();
    offScreen.release();
  } catch (e) {
    console.error('pixelMap release failed', e);
  }
}

run();
