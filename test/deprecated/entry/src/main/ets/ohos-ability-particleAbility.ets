import particleAbility from '@ohos.ability.particleAbility';
import notificationManager from '@ohos.notificationManager';
import Want from '@ohos.app.ability.Want';

async function startLocationServiceBackground(): Promise<void> {
  // FA-model particle ability keeps itself alive with a continuous-task notification.
  const notifId: number = 1001;
  const request: notificationManager.NotificationRequest = {
    id: notifId,
    content: {
      notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
      normal: {
        title: 'Location service',
        text: 'Tracking your route in background',
      },
    },
  };
  try {
    await particleAbility.startBackgroundRunning(notifId, request);
    console.info('particleAbility.startBackgroundRunning ok');
  } catch (e) {
    console.error('startBackgroundRunning failed', e);
  }
}

async function stopLocationServiceBackground(): Promise<void> {
  try {
    await particleAbility.cancelBackgroundRunning();
    console.info('particleAbility.cancelBackgroundRunning ok');
  } catch (e) {
    console.error('cancelBackgroundRunning failed', e);
  }
}

async function run(): Promise<void> {
  await startLocationServiceBackground();
  await stopLocationServiceBackground();
}

run();
