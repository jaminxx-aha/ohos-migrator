import backgroundTaskManager from '@ohos.backgroundTaskManager';
import wantAgent from '@ohos.app.ability.wantAgent';
import { WantAgent } from '@ohos.app.ability.wantAgent';
import type common from '@ohos.app.ability.common';

// Scenario 1: transient (short-lived) background work. Request a short suspension delay
// so the app can finish uploading photos, observe the granted time and remaining time,
// then release the delay when the work is done.
async function runTransientTask(): Promise<void> {
  let requestId = 0;
  try {
    const info: backgroundTaskManager.DelaySuspendInfo = backgroundTaskManager.requestSuspendDelay(
      'finish uploading user photos before suspend',
      () => {
        console.info('suspend delay expired, wrapping up pending work');
      },
    );
    requestId = info.requestId;
    const grantedMs = info.actualDelayTime;
    console.info(`granted ${grantedMs}ms for request ${requestId}`);

    const remainingMs = await backgroundTaskManager.getRemainingDelayTime(requestId);
    console.info(`remaining delay time: ${remainingMs}ms`);
  } catch (e) {
    console.error('transient task failed', e);
  } finally {
    try {
      backgroundTaskManager.cancelSuspendDelay(requestId);
    } catch (e) {
      console.error('cancelSuspendDelay failed', e);
    }
  }
}

// Scenario 2: continuous background task. A music app requests to keep running in the
// background for audio playback, using a WantAgent so tapping the notification returns to
// the player ability. When playback ends the continuous task is stopped.
async function runContinuousTask(): Promise<void> {
  // In a real app this Context comes from the Ability instance; the probe only needs the
  // symbol to be resolved, so an unresolved placeholder is fine here.
  const ctx: common.Context = new Object() as common.Context;

  let agent: WantAgent | undefined;
  try {
    agent = await wantAgent.getWantAgent({
      wants: [{ bundleName: 'com.example.musicapp', abilityName: 'EntryAbility' }],
      requestCode: 1001,
    });
    await backgroundTaskManager.startBackgroundRunning(
      ctx,
      supportedModes[1],
      agent,
    );
    console.info('background running started for audio playback');
  } catch (e) {
    console.error('startBackgroundRunning failed', e);
    return;
  }

  // ... playback happens here ...

  try {
    await backgroundTaskManager.stopBackgroundRunning(ctx);
    console.info('background running stopped');
  } catch (e) {
    console.error('stopBackgroundRunning failed', e);
  }
}

// The full set of continuous-task background modes the app may switch between.
const supportedModes: backgroundTaskManager.BackgroundMode[] = [
  backgroundTaskManager.BackgroundMode.DATA_TRANSFER,
  backgroundTaskManager.BackgroundMode.AUDIO_PLAYBACK,
  backgroundTaskManager.BackgroundMode.AUDIO_RECORDING,
  backgroundTaskManager.BackgroundMode.LOCATION,
  backgroundTaskManager.BackgroundMode.BLUETOOTH_INTERACTION,
  backgroundTaskManager.BackgroundMode.MULTI_DEVICE_CONNECTION,
  backgroundTaskManager.BackgroundMode.TASK_KEEPING,
];
// Reference the enum namespace itself so the deprecated BackgroundMode symbol is exercised.
console.info(`app may use ${supportedModes.length} background modes (first=${backgroundTaskManager.BackgroundMode.AUDIO_PLAYBACK})`);

async function run(): Promise<void> {
  await runTransientTask();
  await runContinuousTask();
}

run();
