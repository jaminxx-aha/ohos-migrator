import media from '@ohos.multimedia.media';

// Scenario 1: Build deprecated recorder config objects (exercises config field reads + enum members).
function buildAudioRecorderConfig(): media.AudioRecorderConfig {
  const cfg: media.AudioRecorderConfig = {
    audioEncoder: media.AudioEncoder.AAC_LC,
    audioEncodeBitRate: 128000,
    audioSampleRate: 44100,
    numberOfChannels: 2,
    format: media.AudioOutputFormat.MPEG_4,
    fileFormat: media.ContainerFormatType.CFT_MPEG_4,
    audioEncoderMime: media.CodecMimeType.AUDIO_AAC,
    uri: 'fd://8',
    location: { latitude: 31.23, longitude: 121.47 },
  };
  // Touch the remaining deprecated enum members for coverage.
  const nb = media.AudioEncoder.AMR_NB;
  const wb = media.AudioEncoder.AMR_WB;
  const def = media.AudioEncoder.DEFAULT;
  const he = media.AudioEncoder.HE_AAC;
  const adts = media.AudioOutputFormat.AAC_ADTS;
  const amrNb = media.AudioOutputFormat.AMR_NB;
  const amrWb = media.AudioOutputFormat.AMR_WB;
  const outFmtDef = media.AudioOutputFormat.DEFAULT;
  void nb; void wb; void def; void he; void adts; void amrNb; void amrWb; void outFmtDef;
  void cfg.audioEncoder;
  void cfg.audioEncodeBitRate;
  void cfg.audioSampleRate;
  void cfg.numberOfChannels;
  void cfg.format;
  void cfg.fileFormat;
  void cfg.audioEncoderMime;
  void cfg.uri;
  void cfg.location;
  return cfg;
}

function buildAVRecorderConfig(): media.AVRecorderConfig {
  const profile: media.AVRecorderProfile = {
    audioBitrate: 128000,
    audioChannels: 2,
    audioCodec: media.CodecMimeType.AUDIO_AAC,
    audioSampleRate: 44100,
    fileFormat: media.ContainerFormatType.CFT_MPEG_4,
    videoBitrate: 2000000,
    videoFrameHeight: 1080,
    videoFrameWidth: 1920,
  };
  const cfg: media.AVRecorderConfig = {
    profile: profile,
    url: 'fd://9',
    rotation: 90,
    location: { latitude: 31.23, longitude: 121.47 },
  };
  void cfg.rotation;
  void cfg.location;
  return cfg;
}

// Scenario 2: Play a short audio clip end-to-end using the deprecated AudioPlayer.
async function playAudioClip(): Promise<void> {
  const player = media.createAudioPlayer();
  try {
    player.on('bufferingUpdate', (_info: number, _value: number) => { /* buffering progress */ });
    player.src = 'fd://5';
    player.fdSrc = { fd: 5, offset: 0, length: 0 };
    player.loop = true;
    player.setVolume(0.8);
    player.seek(1000);
    player.play();
    const tracks = await player.getTrackDescription();
    void tracks;
    const pos = player.currentTime;
    const dur = player.duration;
    const st = player.state;
    const mode = player.audioInterruptMode;
    void pos; void dur; void st; void mode;
    player.pause();
    player.reset();
    player.stop();
  } catch (e) {
    console.error('playAudioClip failed', e);
  } finally {
    player.release();
  }
}

// Scenario 3: Record an audio note using the deprecated AudioRecorder.
async function recordAudioNote(): Promise<void> {
  const recorder = media.createAudioRecorder();
  try {
    recorder.on('prepare', () => { /* prepared */ });
    const cfg = buildAudioRecorderConfig();
    recorder.prepare(cfg);
    recorder.start();
    recorder.pause();
    recorder.resume();
    recorder.stop();
    recorder.reset();
  } catch (e) {
    console.error('recordAudioNote failed', e);
  } finally {
    recorder.release();
  }
}

// Scenario 4: Play back a video using the deprecated VideoPlayer.
async function playbackVideo(): Promise<void> {
  const player = await media.createVideoPlayer();
  try {
    player.on('playbackCompleted', () => { /* finished */ });
    player.url = 'fd://7';
    player.fdSrc = { fd: 7, offset: 0, length: 0 };
    player.loop = false;
    await player.setDisplaySurface('surface-001');
    await player.setSpeed(0);
    player.setVolume(0.5);
    await player.prepare();
    player.play();
    player.seek(2000);
    const tracks = await player.getTrackDescription();
    void tracks;
    const pos = player.currentTime;
    const dur = player.duration;
    const w = player.width;
    const h = player.height;
    const st = player.state;
    const scale = player.videoScaleType;
    const mode = player.audioInterruptMode;
    void pos; void dur; void w; void h; void st; void scale; void mode;
    player.pause();
    player.reset();
    player.stop();
  } catch (e) {
    console.error('playbackVideo failed', e);
  } finally {
    player.release();
  }
}

// Scenario 5: Inspect deprecated media error codes (read-only enum coverage).
function inspectMediaErrors(): void {
  const codes = [
    media.MediaErrorCode.MSERR_INVALID_STATE,
    media.MediaErrorCode.MSERR_INVALID_VAL,
    media.MediaErrorCode.MSERR_IO,
    media.MediaErrorCode.MSERR_NO_MEMORY,
    media.MediaErrorCode.MSERR_OK,
    media.MediaErrorCode.MSERR_OPERATION_NOT_PERMIT,
    media.MediaErrorCode.MSERR_SERVICE_DIED,
    media.MediaErrorCode.MSERR_TIMEOUT,
    media.MediaErrorCode.MSERR_UNKNOWN,
    media.MediaErrorCode.MSERR_UNSUPPORTED,
  ];
  void codes;
  // media.MediaErrorCode (enum ref) is covered by the member accesses above.
}

async function run(): Promise<void> {
  buildAVRecorderConfig();
  inspectMediaErrors();
  await playAudioClip();
  await recordAudioNote();
  await playbackVideo();
}

run();
