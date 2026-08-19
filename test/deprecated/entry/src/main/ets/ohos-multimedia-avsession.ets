import avSession from '@ohos.multimedia.avsession';

// Scenario: a music app sets up a playback session, subscribes to the
// 'playFromAssetId' command from the system media controller, then later
// tears the subscription down when playback ends.

async function setupPlaybackSession(): Promise<avSession.AVSession> {
  const session: avSession.AVSession = await avSession.createAVSession(
    getContext() as Context,
    'com.example.music.playback',
    'audio'
  );
  try {
    session.on('playFromAssetId', (assetId: number) => {
      console.info('playFromAssetId command received, assetId=' + assetId);
    });
  } catch (e) {
    console.error('register playFromAssetId listener failed', e);
  }
  return session;
}

async function teardownPlaybackSession(session: avSession.AVSession): Promise<void> {
  try {
    session.off('playFromAssetId');
  } catch (e) {
    console.error('unregister playFromAssetId listener failed', e);
  }
  try {
    await session.destroy();
  } catch (e) {
    console.error('destroy session failed', e);
  }
}

async function run(): Promise<void> {
  const session: avSession.AVSession = await setupPlaybackSession();
  await teardownPlaybackSession(session);
}

run();
