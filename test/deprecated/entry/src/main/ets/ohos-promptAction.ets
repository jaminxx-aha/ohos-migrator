import promptAction from '@ohos.promptAction';

// Show a transient toast hint to the user (e.g. "Saved").
function showSavedToast(): void {
  promptAction.showToast({
    message: 'Saved',
    duration: 1500,
    bottom: '96vp',
  });
}

// Show a confirmation dialog and report which button the user picked.
function showConfirmDialog(): void {
  promptAction.showDialog({
    title: 'Delete file',
    message: 'Are you sure you want to permanently delete this file?',
    buttons: [
      { text: 'Cancel', color: '#666666' },
      { text: 'Delete', color: '#E84031' },
    ],
  }, (err, result) => {
    if (err) {
      console.error('showDialog failed', err);
      return;
    }
    console.info('user picked button index: ' + result.index);
  });
}

// Show a share-style action menu and act on the chosen entry.
function showShareMenu(): void {
  promptAction.showActionMenu({
    title: 'Share photo',
    buttons: [
      { text: 'WeChat', color: '#07C160' },
      { text: 'Email', color: '#1A73E8' },
      { text: 'Save to gallery', color: '#666666' },
    ],
  }, (err, result) => {
    if (err) {
      console.error('showActionMenu failed', err);
      return;
    }
    console.info('selected share target index: ' + result.index);
  });
}

// Open a custom dialog with a simple inline builder, then close it by id.
async function openAndCloseCustomDialog(): Promise<void> {
  const builder: () => void = () => {};
  let dialogId: number;
  try {
    dialogId = await promptAction.openCustomDialog({
      builder,
      autoCancel: true,
      maskColor: '#66000000',
    });
  } catch (e) {
    console.error('openCustomDialog failed', e);
    return;
  }
  try {
    promptAction.closeCustomDialog(dialogId);
  } catch (e) {
    console.error('closeCustomDialog failed', e);
  }
}

async function run(): Promise<void> {
  showSavedToast();
  showConfirmDialog();
  showShareMenu();
  await openAndCloseCustomDialog();
}

run();
