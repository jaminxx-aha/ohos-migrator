import audio from '@ohos.multimedia.audio';

// Legacy enum namespaces (ActiveDeviceType / ContentType / InterruptActionType) are
// exercised via their member accesses in the scenarios below — the deprecated symbols resolve.

// Scenario 1: inspect the deprecated AudioInterrupt / InterruptAction field model
// and the deprecated ContentType / InterruptActionType / ActiveDeviceType enums.
function inspectLegacyInterruptModel(): void {
  const interrupt: audio.AudioInterrupt = {
    streamUsage: audio.StreamUsage.STREAM_USAGE_MEDIA,
    contentType: audio.ContentType.CONTENT_TYPE_MUSIC,
    pauseWhenDucked: true,
  };
  const action: audio.InterruptAction = {
    actionType: audio.InterruptActionType.TYPE_INTERRUPT,
  };
  // Field reads below reference the deprecated AudioInterrupt / InterruptAction members.
  const usage = interrupt.streamUsage;
  const content = interrupt.contentType;
  const duckable = interrupt.pauseWhenDucked;
  const kind = action.actionType;
  const evtType = action.type;
  const evtHint = action.hint;
  const activated = action.activated;
  void usage; void content; void duckable; void kind; void evtType; void evtHint; void activated;

  // Deprecated ContentType members, retained for legacy routing decisions.
  const contentTypes: number[] = [
    audio.ContentType.CONTENT_TYPE_UNKNOWN,
    audio.ContentType.CONTENT_TYPE_SPEECH,
    audio.ContentType.CONTENT_TYPE_MUSIC,
    audio.ContentType.CONTENT_TYPE_MOVIE,
    audio.ContentType.CONTENT_TYPE_SONIFICATION,
    audio.ContentType.CONTENT_TYPE_RINGTONE,
  ];
  void contentTypes;

  // Deprecated InterruptActionType members.
  const actionTypeNormal = audio.InterruptActionType.TYPE_ACTIVATED;
  const actionTypeInterrupt = audio.InterruptActionType.TYPE_INTERRUPT;
  void actionTypeNormal; void actionTypeInterrupt;

  // Deprecated ActiveDeviceType members used by AudioManager device APIs.
  const speaker = audio.ActiveDeviceType.SPEAKER;
  const btSco = audio.ActiveDeviceType.BLUETOOTH_SCO;
  void speaker; void btSco;

  // Deprecated StreamUsage members.
  const mediaUsage = audio.StreamUsage.STREAM_USAGE_MEDIA;
  const ringUsage = audio.StreamUsage.STREAM_USAGE_NOTIFICATION_RINGTONE;
  void mediaUsage; void ringUsage;

  // Deprecated playback-capture source type.
  const playbackSource = audio.SourceType.SOURCE_TYPE_PLAYBACK_CAPTURE;
  void playbackSource;
}

// Scenario 2: drive the deprecated AudioManager surface (device, ringer, volume, mic, params, events).
async function manageAudioManagerDevices(): Promise<void> {
  const manager: audio.AudioManager = audio.getAudioManager();

  const onDeviceChange = (action: audio.DeviceChangeAction): void => { console.info('deviceChange', action); };
  manager.on('deviceChange', onDeviceChange);
  manager.off('deviceChange', onDeviceChange);

  const descriptors = await manager.getDevices(audio.DeviceFlag.OUTPUT_DEVICES_FLAG);
  void descriptors;
  await manager.setDeviceActive(audio.ActiveDeviceType.SPEAKER, false);
  const speakerActive = await manager.isDeviceActive(audio.ActiveDeviceType.SPEAKER);
  void speakerActive;

  const maxCall = await manager.getMaxVolume(audio.AudioVolumeType.VOICE_CALL);
  const minCall = await manager.getMinVolume(audio.AudioVolumeType.VOICE_CALL);
  let callVol = await manager.getVolume(audio.AudioVolumeType.VOICE_CALL);
  const callActive = await manager.isActive(audio.AudioVolumeType.VOICE_CALL);
  void maxCall; void minCall; void callActive;
  try {
    await manager.setVolume(audio.AudioVolumeType.VOICE_CALL, Math.min(maxCall, callVol + 1));
    callVol = await manager.getVolume(audio.AudioVolumeType.VOICE_CALL);
  } catch (e) { console.error('setVolume failed', e); }

  await manager.mute(audio.AudioVolumeType.VOICE_CALL, false);
  const muted = await manager.isMute(audio.AudioVolumeType.VOICE_CALL);
  void muted;

  await manager.setMicrophoneMute(false);
  const micMuted = await manager.isMicrophoneMute();
  void micMuted;

  await manager.setRingerMode(audio.AudioRingMode.RINGER_MODE_SILENT);
  const ringer = await manager.getRingerMode();
  void ringer;

  await manager.setAudioParameter('key_routing', 'speaker');
  const param = await manager.getAudioParameter('key_routing');
  void param;
}

// Scenario 3: exercise the deprecated AudioVolumeGroupManager / AudioVolumeManager / AudioStreamManager surface.
async function manageVolumeAndStreamState(): Promise<void> {
  const manager: audio.AudioManager = audio.getAudioManager();
  const volumeManager: audio.AudioVolumeManager = manager.getVolumeManager();
  const streamManager: audio.AudioStreamManager = manager.getStreamManager();

  const onVolumeChange = (event: audio.VolumeEvent): void => { console.info('volumeChange', event); };
  volumeManager.on('volumeChange', onVolumeChange);
  volumeManager.off('volumeChange', onVolumeChange);

  const group: audio.AudioVolumeGroupManager = await volumeManager.getVolumeGroupManager(0);
  const gMax = await group.getMaxVolume(audio.AudioVolumeType.VOICE_CALL);
  const gMaxSync = group.getMaxVolumeSync(audio.AudioVolumeType.VOICE_CALL);
  const gMin = await group.getMinVolume(audio.AudioVolumeType.VOICE_CALL);
  const gMinSync = group.getMinVolumeSync(audio.AudioVolumeType.VOICE_CALL);
  const gVol = await group.getVolume(audio.AudioVolumeType.VOICE_CALL);
  const gVolSync = group.getVolumeSync(audio.AudioVolumeType.VOICE_CALL);
  void gMax; void gMaxSync; void gMin; void gMinSync; void gVol; void gVolSync;

  const gMuted = await group.isMute(audio.AudioVolumeType.VOICE_CALL);
  const gMutedSync = group.isMuteSync(audio.AudioVolumeType.VOICE_CALL);
  void gMuted; void gMutedSync;
  try {
    await group.setMicrophoneMute(false);
  } catch (e) { console.error('group.setMicrophoneMute failed', e); }

  const db = await group.getSystemVolumeInDb(audio.AudioVolumeType.VOICE_CALL, 0, audio.DeviceType.INVALID);
  const dbSync = group.getSystemVolumeInDbSync(audio.AudioVolumeType.VOICE_CALL, 0, audio.DeviceType.INVALID);
  void db; void dbSync;

  const streamActive = await streamManager.isActive(audio.AudioVolumeType.VOICE_CALL);
  const streamActiveSync = streamManager.isActiveSync(audio.AudioVolumeType.VOICE_CALL);
  void streamActive; void streamActiveSync;
}

// Scenario 4: play back audio with a deprecated-content AudioRenderer and adjust render rate.
async function playbackAndTuneRenderRate(): Promise<void> {
  const rendererInfo: audio.AudioRendererInfo = {
    content: audio.ContentType.CONTENT_TYPE_MUSIC,
    usage: audio.StreamUsage.STREAM_USAGE_MEDIA,
    rendererFlags: 0,
  };
  const streamInfo: audio.AudioStreamInfo = {
    samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_44100,
    channels: audio.AudioChannel.CHANNEL_2,
    sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
    encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW,
  };
  const rendererOptions: audio.AudioRendererOptions = { streamInfo, rendererInfo };
  const renderer: audio.AudioRenderer = await audio.createAudioRenderer(rendererOptions);

  // The deprecated `content` field on AudioRendererInfo, read for legacy logging.
  const legacyContent = rendererInfo.content;
  void legacyContent;

  await renderer.setRenderRate(audio.AudioRendererRate.RENDER_RATE_NORMAL);
  const rate = await renderer.getRenderRate();
  const rateSync = renderer.getRenderRateSync();
  void rate; void rateSync;
}

// Scenario 5: capture playback streams using the deprecated playback-capture configuration tree.
async function capturePlaybackStream(): Promise<void> {
  const filter: audio.CaptureFilterOptions = {
    usages: [audio.StreamUsage.STREAM_USAGE_MEDIA, audio.StreamUsage.STREAM_USAGE_NOTIFICATION_RINGTONE],
  };
  const captureConfig: audio.AudioPlaybackCaptureConfig = { filterOptions: filter };
  const capturerInfo: audio.AudioCapturerInfo = {
    source: audio.SourceType.SOURCE_TYPE_PLAYBACK_CAPTURE,
    capturerFlags: 0,
  };
  const streamInfo: audio.AudioStreamInfo = {
    samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_48000,
    channels: audio.AudioChannel.CHANNEL_2,
    sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
    encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW,
  };
  const capturerOptions: audio.AudioCapturerOptions = {
    streamInfo,
    capturerInfo,
    playbackCaptureConfig: captureConfig,
  };
  // Read the deprecated playback-capture config / filter-options fields for logging.
  const cfg = capturerOptions.playbackCaptureConfig;
  if (cfg === undefined) {
    throw new Error('playbackCaptureConfig is required');
  }
  const usages = cfg.filterOptions.usages;
  void usages;

  const capturer: audio.AudioCapturer = await audio.createAudioCapturer(capturerOptions);
  try {
    const buf: ArrayBuffer = await capturer.read(2048, false);
    void buf;
  } catch (e) { console.error('capturer.read failed', e); }
}

async function run(): Promise<void> {
  inspectLegacyInterruptModel();
  try { await manageAudioManagerDevices(); } catch (e) { console.error('manageAudioManagerDevices failed', e); }
  try { await manageVolumeAndStreamState(); } catch (e) { console.error('manageVolumeAndStreamState failed', e); }
  try { await playbackAndTuneRenderRate(); } catch (e) { console.error('playbackAndTuneRenderRate failed', e); }
  try { await capturePlaybackStream(); } catch (e) { console.error('capturePlaybackStream failed', e); }
}

run();
