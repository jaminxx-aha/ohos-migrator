import { PromptAction, Router } from '@ohos.arkui.UIContext';
import window from '@ohos.window';

// Scenario: a UIAbility's onWindowStageCreate handler inspects the page-stack
// depth via the (deprecated) Router.getLength, then presents a confirmation
// action menu via the (deprecated) PromptAction.showActionMenu overload family.

async function inspectRouterStack(router: Router): Promise<number> {
  // Deprecated since 23; prefer Router#getStackSize.
  const lengthStr: string = router.getLength();
  const stackSize = parseInt(lengthStr, 10);
  console.info(`current router stack length = ${stackSize}`);
  return stackSize;
}

async function presentConfirmMenu(prompt: PromptAction): Promise<number> {
  const options = {
    title: '确认删除该条目吗?',
    buttons: [
      { text: '删除', color: '#E84026' },
      { text: '取消', color: '#007DFF' }
    ]
  };
  // The showActionMenu symbol carries a @deprecated overload (since 11);
  // call the Promise-returning form and await the user's selection.
  try {
    const res = await prompt.showActionMenu(options);
    console.info(`user selected button index = ${res.index}`);
    return res.index;
  } catch (e) {
    console.error('showActionMenu failed', e);
    return -1;
  }
}

async function run(windowStage: window.WindowStage): Promise<void> {
  const mainWin = windowStage.getMainWindowSync();
  const uiContext = mainWin.getUIContext();
  const router: Router = uiContext.getRouter();
  const prompt: PromptAction = uiContext.getPromptAction();
  await inspectRouterStack(router);
  await presentConfirmMenu(prompt);
}

declare const windowStage: window.WindowStage;
run(windowStage);
