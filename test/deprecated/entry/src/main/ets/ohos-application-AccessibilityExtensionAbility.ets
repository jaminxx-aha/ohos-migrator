import AccessibilityExtensionAbility from '@ohos.application.AccessibilityExtensionAbility';
import { AccessibilityElement, AccessibilityExtensionContext, AccessibilityEvent } from '@ohos.application.AccessibilityExtensionAbility';
import type { KeyEvent } from '@ohos.multimodalInput.keyEvent';
import type { GesturePath } from '@ohos.accessibility.GesturePath';

// A screen-reader style accessibility extension that drives the deprecated
// (since 12) AccessibilityExtensionAbility / AccessibilityExtensionContext /
// AccessibilityElement surface end-to-end. The GesturePath/GesturePoint
// constructors are themselves deprecated since 12 and are intentionally not
// exercised here; the gesture path is built structurally instead.

function buildTapPath(x: number, y: number, duration: number): GesturePath {
  return {
    durationTime: duration,
    points: [{ positionX: x, positionY: y }],
  } as unknown as GesturePath;
}

// Restrict the events we receive to a known set of target bundles.
async function configureEventTargets(ctx: AccessibilityExtensionContext): Promise<void> {
  try {
    await ctx.setTargetBundleName(['com.example.reader', 'com.example.notes']);
  } catch (e) {
    console.error('setTargetBundleName failed', e);
  }
}

// Enumerate on-screen windows and read each root element's bundle name.
async function inspectWindowTree(ctx: AccessibilityExtensionContext): Promise<void> {
  let windows: AccessibilityElement[];
  try {
    windows = await ctx.getWindows(0);
  } catch (e) {
    console.error('getWindows failed', e);
    return;
  }
  for (const _win of windows) {
    try {
      const root = await ctx.getWindowRootElement(0);
      console.info('window root element resolved');
    } catch (e) {
      console.error('getWindowRootElement failed', e);
    }
  }
}

// Read metadata of the accessibility-focused control and drive its actions.
async function inspectFocusedControl(ctx: AccessibilityExtensionContext): Promise<void> {
  let focus: AccessibilityElement;
  try {
    focus = await ctx.getFocusElement(true);
  } catch (e) {
    console.error('getFocusElement failed', e);
    return;
  }

  try {
    const actions = await focus.actionNames();
    console.info('focus actions: ' + actions.join(','));
  } catch (e) {
    console.error('actionNames failed', e);
  }

  try {
    const attrs = await focus.attributeNames();
    console.info('focus attrs: ' + attrs.join(','));
  } catch (e) {
    console.error('attributeNames failed', e);
  }

  try {
    const bundle = await focus.attributeValue('bundleName');
    console.info('focus bundle: ' + bundle);
  } catch (e) {
    console.error('attributeValue failed', e);
  }

  try {
    await focus.performAction('click');
  } catch (e) {
    console.error('performAction failed', e);
  }

  try {
    const matches = await focus.findElement('content', 'Submit');
    console.info('matched elements: ' + matches.length);
  } catch (e) {
    console.error('findElement failed', e);
  }
}

// Inject a single tap via both the async and the sync gesture paths.
async function performTap(ctx: AccessibilityExtensionContext): Promise<void> {
  try {
    await ctx.injectGesture(buildTapPath(540, 960, 50));
  } catch (e) {
    console.error('injectGesture failed', e);
  }
  try {
    ctx.injectGestureSync(buildTapPath(540, 960, 50));
  } catch (e) {
    console.error('injectGestureSync failed', e);
  }
}

async function handleAccessibilityEvent(ctx: AccessibilityExtensionContext): Promise<void> {
  await inspectFocusedControl(ctx);
  await performTap(ctx);
}

class ScreenReaderExtension extends AccessibilityExtensionAbility {
  onConnect(): void {
    super.onConnect();
    const ctx = this.context;
    configureEventTargets(ctx).then(() => inspectWindowTree(ctx));
  }

  onDisconnect(): void {
    super.onDisconnect();
  }

  onAccessibilityEvent(event: AccessibilityEvent): void {
    super.onAccessibilityEvent(event);
    handleAccessibilityEvent(this.context).catch((e) => console.error('event handling failed', e));
  }

  onKeyEvent(keyEvent: KeyEvent): boolean {
    super.onKeyEvent(keyEvent);
    return false;
  }
}
