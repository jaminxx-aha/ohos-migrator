import dragController from '@ohos.arkui.dragController';

// Scenario: kick off a drag of a contact card from a long-press gesture.

const contactDragItem: dragController.DragInfo = {
  pointerId: 0,
  extraParams: JSON.stringify({ appId: 'com.example.contacts', source: 'contact-list' }),
};

const draggedItem: DragItemInfo = {
  extraInfo: 'contact-card-v2',
};

// 1. Create a reusable drag action and subscribe to status changes before starting.
async function prepareAndStartDrag(): Promise<void> {
  const action: dragController.DragAction = dragController.createDragAction(
    [draggedItem],
    contactDragItem,
  );
  action.on('statusChange', (info: dragController.DragAndDropInfo) => {
    if (info.status === dragController.DragStatus.ENDED) {
      console.info('drag ended, cleaning up preview');
    }
  });
  try {
    await action.startDrag();
  } catch (e) {
    console.error('startDrag failed', e);
  }
}

// 2. Fire a one-shot drag and await its result via the promise overload.
async function executeOneShotDrag(): Promise<void> {
  try {
    const result: dragController.DragEventParam = await dragController.executeDrag(
      draggedItem,
      contactDragItem,
    );
    console.info('drag finished, extraParams:', result.extraParams);
  } catch (e) {
    console.error('executeDrag failed', e);
  }
}

// 3. Tweak the system drag preview appearance (foreground tint + animated style).
function styleDragPreview(): void {
  const preview: dragController.DragPreview = dragController.getDragPreview();
  preview.setForegroundColor('#FF007DFF');
  preview.animate({ duration: 200 }, () => {
    // apply transient scale/opacity style changes to the preview here
  });
}

async function run(): Promise<void> {
  styleDragPreview();
  await prepareAndStartDrag();
  await executeOneShotDrag();
}

run();
