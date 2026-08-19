import prompt from '@ohos.prompt';

// Scenario 1: show a transient toast to the user (e.g. validation feedback).
function showValidationToast(message: string): void {
  const toastOpts: prompt.ShowToastOptions = {
    message: message,
    duration: 2000,
    bottom: '120px',
  };
  toastOpts.message = message;
  const _dur: number | undefined = toastOpts.duration;
  const _btm: string | number | undefined = toastOpts.bottom;
  prompt.showToast(toastOpts);
}

// Scenario 2: confirm a destructive action with a yes/no dialog.
async function confirmDiscardChanges(): Promise<boolean> {
  const confirmBtn: prompt.Button = { text: 'Discard', color: '#E84026' };
  const cancelBtn: prompt.Button = { text: 'Cancel', color: '#666666' };
  const dialogOpts: prompt.ShowDialogOptions = {
    title: 'Unsaved changes',
    message: 'Discard changes and leave?',
    buttons: [confirmBtn, cancelBtn],
  };
  // exercise every deprecated field on the options/response shapes
  dialogOpts.title = 'Unsaved changes';
  dialogOpts.message = 'Discard changes and leave?';
  dialogOpts.buttons = [confirmBtn, cancelBtn];
  confirmBtn.text = 'Discard';
  confirmBtn.color = '#E84026';

  try {
    const res: prompt.ShowDialogSuccessResponse = await prompt.showDialog(dialogOpts);
    const clicked: number = res.index;
    return clicked === 0;
  } catch (e) {
    console.error('showDialog failed', e);
    return false;
  }
}

// Scenario 3: let the user pick a share target from an action menu.
async function pickShareTarget(): Promise<number> {
  const menuBtn1: prompt.Button = { text: 'Copy link', color: '#007DFF' };
  const menuBtn2: prompt.Button = { text: 'QR code', color: '#007DFF' };
  const menuBtn3: prompt.Button = { text: 'More', color: '#666666' };
  const menuOpts: prompt.ActionMenuOptions = {
    title: 'Share',
    buttons: [menuBtn1, menuBtn2, menuBtn3],
  };
  menuOpts.title = 'Share';
  menuOpts.buttons = [menuBtn1, menuBtn2, menuBtn3];
  menuBtn1.text = 'Copy link';
  menuBtn1.color = '#007DFF';

  try {
    const res: prompt.ActionMenuSuccessResponse = await prompt.showActionMenu(menuOpts);
    return res.index;
  } catch (e) {
    console.error('showActionMenu failed', e);
    return -1;
  }
}

async function run(): Promise<void> {
  showValidationToast('Saved successfully');
  const discard = await confirmDiscardChanges();
  if (discard) {
    await pickShareTarget();
  }
}

run();
