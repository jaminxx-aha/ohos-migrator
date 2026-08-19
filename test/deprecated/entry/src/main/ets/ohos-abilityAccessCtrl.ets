import abilityAccessCtrl from '@ohos.abilityAccessCtrl';
import { Context } from '@ohos.abilityAccessCtrl';

// Scenario: verify a target app's permission and load that module's context
// for follow-up work. Both APIs below are deprecated but still functional.

const PERMISSION = 'ohos.permission.READ_MEDIA';
const TARGET_MODULE = 'photo_picker';

// Minimal receiver for getContext() so we don't rely on `this` (banned in
// standalone functions by arkts-no-standalone-this).
class ContextHost {}

async function verifyAndLoadContext(): Promise<void> {
  const atManager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
  const callerContext: Context = getContext(new ContextHost()) as Context;

  let granted = false;
  try {
    // tokenID 0 represents the current bundle for this self-check scenario.
    const status = await atManager.verifyAccessToken(0, PERMISSION);
    granted = status === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
  } catch (e) {
    console.error('verifyAccessToken failed for ' + PERMISSION, e);
    return;
  }

  if (!granted) {
    console.warn('Permission ' + PERMISSION + ' not granted; aborting.');
    return;
  }

  try {
    const moduleContext = callerContext.createModuleContext(TARGET_MODULE);
    console.info('Loaded module context for ' + TARGET_MODULE);
  } catch (e) {
    console.error('createModuleContext failed for ' + TARGET_MODULE, e);
  }
}

async function run(): Promise<void> {
  await verifyAndLoadContext();
}

run();
