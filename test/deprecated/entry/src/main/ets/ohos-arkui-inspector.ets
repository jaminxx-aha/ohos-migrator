import inspector from '@ohos.arkui.inspector';

// Observe layout/draw events for a list item identified by its component id,
// then tear down the listener once the item has settled.
async function observeListItemRender(itemId: string): Promise<void> {
  try {
    const observer = inspector.createComponentObserver(itemId);
    observer.on('layout', () => {
      console.info(`layout settled for ${itemId}`);
    });
    observer.on('draw', () => {
      console.info(`draw completed for ${itemId}`);
    });
    // Give the framework a moment to report, then release the handle.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    observer.off('layout');
    observer.off('draw');
  } catch (e) {
    console.error('component observer failed', e);
  }
}

async function run(): Promise<void> {
  await observeListItemRender('userProfileCard');
}

run();
