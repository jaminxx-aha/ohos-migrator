import featureAbility from '@ohos.ability.featureAbility';
import Want from '@ohos.app.ability.Want';

// NOTE: @ohos.ability.featureAbility.Context.getExternalCacheDir /
// setShowOnLockScreen / setWakeUpScreen are @deprecated FA-model-only
// members that are not referenceable in stageMode, so they are intentionally
// omitted from this probe.

// Obtain the application context for the current Feature Ability.
const context = featureAbility.getContext();

// Build a Want that targets a hypothetical settings ability.
const settingsWant: Want = {
  bundleName: 'com.example.settings',
  abilityName: 'SettingsAbility',
  parameters: {
    targetPage: 'wifi'
  }
};

// Start a sibling ability and wait for it to return a result.
async function openSettingsForResult(): Promise<void> {
  try {
    const result = await featureAbility.startAbilityForResult({
      want: settingsWant,
      startWantsResultCode: 0
    });
    console.info('settings result code: ' + result.resultCode);
    if (result.want) {
      const returned = result.want.parameters ? result.want.parameters['value'] : undefined;
      console.info('settings returned: ' + JSON.stringify(returned));
    }
  } catch (e) {
    console.error('openSettingsForResult failed', e);
  }
}

// Connect to a long-running service ability and tear it down when done.
async function useServiceAbility(): Promise<void> {
  let connectionId = -1;
  try {
    connectionId = featureAbility.connectAbility(
      {
        bundleName: 'com.example.service',
        abilityName: 'BackgroundServiceAbility'
      } as Want,
      {
        onConnect: (elementName, remoteProxy) => {
          console.info('connected to service: ' + JSON.stringify(elementName));
        },
        onDisconnect: (elementName) => {
          console.info('disconnected from service: ' + JSON.stringify(elementName));
        },
        onFailed: (code) => {
          console.error('service connect failed, code: ' + code);
        }
      }
    );

    // Acquire a DataAbilityHelper backed by a contacts data ability.
    const helper = featureAbility.acquireDataAbilityHelper('dataability:///com.example.contacts/contacts');
    console.info('acquired data ability helper');
    void helper;
  } catch (e) {
    console.error('useServiceAbility failed', e);
  } finally {
    if (connectionId >= 0) {
      try {
        await featureAbility.disconnectAbility(connectionId);
      } catch (e) {
        console.error('disconnectAbility failed', e);
      }
    }
  }
}

// Reflect the current window focus and the active window configuration.
async function reportWindowState(): Promise<void> {
  try {
    const focused = await featureAbility.hasWindowFocus();
    console.info('hasWindowFocus: ' + focused);
    const win = await featureAbility.getWindow();
    console.info('current window size: ' + JSON.stringify(await win.getWindowProperties()));
  } catch (e) {
    console.error('reportWindowState failed', e);
  }
}

// Finish the current page ability, propagating a result code to the caller.
async function finishWithResult(): Promise<void> {
  try {
    await featureAbility.terminateSelfWithResult({
      resultCode: 0,
      want: {
        bundleName: 'com.example.caller',
        abilityName: 'CallerAbility',
        parameters: { status: 'done' }
      } as Want
    });
  } catch (e) {
    console.error('finishWithResult failed', e);
  }
}

async function run(): Promise<void> {
  await openSettingsForResult();
  await useServiceAbility();
  await reportWindowState();
  await finishWithResult();
}

void context;
run();
