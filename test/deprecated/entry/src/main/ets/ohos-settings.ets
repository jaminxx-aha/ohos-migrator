import settings from '@ohos.settings';

// Device provisioning inspector: reads and writes system setting keys across
// namespaces (TTS, display, general, input, network, phone, sound, wireless)
// to assemble a configuration report and toggle a couple of toggles.

interface SettingReport {
  key: string;
  uri: string;
  value: string;
}

function buildReport(uri: string, value: string, key: string): SettingReport {
  return { key, uri, value };
}

async function readTtsSettings(context: Context): Promise<SettingReport[]> {
  const reports: SettingReport[] = [];
  try {
    const pitchUri = String(await settings.getURI(settings.TTS.DEFAULT_TTS_PITCH));
    reports.push(buildReport(pitchUri, await settings.getValue(context, settings.TTS.DEFAULT_TTS_PITCH), settings.TTS.DEFAULT_TTS_PITCH));
    const rateUri = String(await settings.getURI(settings.TTS.DEFAULT_TTS_RATE));
    reports.push(buildReport(rateUri, settings.getValueSync(context, settings.TTS.DEFAULT_TTS_RATE, ''), settings.TTS.DEFAULT_TTS_RATE));
    const synthUri = String(await settings.getURI(settings.TTS.DEFAULT_TTS_SYNTH));
    reports.push(buildReport(synthUri, settings.getValueSync(context, settings.TTS.DEFAULT_TTS_SYNTH, ''), settings.TTS.DEFAULT_TTS_SYNTH));
    const pluginsUri = String(await settings.getURI(settings.TTS.ENABLED_TTS_PLUGINS));
    reports.push(buildReport(pluginsUri, settings.getValueSync(context, settings.TTS.ENABLED_TTS_PLUGINS, ''), settings.TTS.ENABLED_TTS_PLUGINS));
  } catch (e) {
    console.error('readTtsSettings failed', e);
  }
  return reports;
}

async function readDateSettings(context: Context): Promise<SettingReport[]> {
  const reports: SettingReport[] = [];
  try {
    const autoGain = String(await settings.getURI(settings.date.AUTO_GAIN_TIME));
    reports.push(buildReport(autoGain, await settings.getValue(context, settings.date.AUTO_GAIN_TIME), settings.date.AUTO_GAIN_TIME));
    const autoGainTz = String(await settings.getURI(settings.date.AUTO_GAIN_TIME_ZONE));
    reports.push(buildReport(autoGainTz, settings.getValueSync(context, settings.date.AUTO_GAIN_TIME_ZONE, ''), settings.date.AUTO_GAIN_TIME_ZONE));
    const fmt = String(await settings.getURI(settings.date.DATE_FORMAT));
    reports.push(buildReport(fmt, settings.getValueSync(context, settings.date.DATE_FORMAT, ''), settings.date.DATE_FORMAT));
  } catch (e) {
    console.error('readDateSettings failed', e);
  }
  return reports;
}

async function readDisplaySettings(context: Context): Promise<SettingReport[]> {
  const reports: SettingReport[] = [];
  try {
    const keys = [
      settings.display.ANIMATOR_DURATION_SCALE,
      settings.display.DEFAULT_SCREEN_ROTATION,
      settings.display.DISPLAY_INVERSION_STATUS,
      settings.display.TRANSITION_ANIMATION_SCALE,
      settings.display.WINDOW_ANIMATION_SCALE,
    ];
    for (const k of keys) {
      reports.push(buildReport(String(await settings.getURI(k)), settings.getValueSync(context, k, ''), k));
    }
  } catch (e) {
    console.error('readDisplaySettings failed', e);
  }
  return reports;
}

async function readGeneralSettings(context: Context): Promise<SettingReport[]> {
  const reports: SettingReport[] = [];
  try {
    const keys = [
      settings.general.ACCESSIBILITY_STATUS,
      settings.general.ACTIVATED_ACCESSIBILITY_SERVICES,
      settings.general.AIRPLANE_MODE_STATUS,
      settings.general.BOOT_COUNTING,
      settings.general.CONTACT_METADATA_SYNC_STATUS,
      settings.general.DEBUGGER_WAITING,
      settings.general.DEBUG_APP_PACKAGE,
      settings.general.DEVELOPMENT_SETTINGS_STATUS,
      settings.general.DEVICE_PROVISION_STATUS,
      settings.general.END_BUTTON_ACTION,
      settings.general.GEOLOCATION_ORIGINS_ALLOWED,
      settings.general.HDC_STATUS,
      settings.general.SETUP_WIZARD_FINISHED,
      settings.general.SKIP_USE_HINTS,
      settings.general.TOUCH_EXPLORATION_STATUS,
      settings.general.USB_STORAGE_STATUS,
    ];
    for (const k of keys) {
      reports.push(buildReport(String(await settings.getURI(k)), await settings.getValue(context, k), k));
    }
  } catch (e) {
    console.error('readGeneralSettings failed', e);
  }
  return reports;
}

async function readInputSettings(context: Context): Promise<SettingReport[]> {
  const reports: SettingReport[] = [];
  try {
    const keys = [
      settings.input.ACTIVATED_INPUT_METHODS,
      settings.input.AUTO_CAPS_TEXT_INPUT,
      settings.input.AUTO_PUNCTUATE_TEXT_INPUT,
      settings.input.AUTO_REPLACE_TEXT_INPUT,
      settings.input.DEFAULT_INPUT_METHOD,
      settings.input.SELECTOR_VISIBILITY_FOR_INPUT_METHOD,
      settings.input.SHOW_PASSWORD_TEXT_INPUT,
    ];
    for (const k of keys) {
      reports.push(buildReport(String(await settings.getURI(k)), settings.getValueSync(context, k, ''), k));
    }
  } catch (e) {
    console.error('readInputSettings failed', e);
  }
  return reports;
}

async function readNetworkSettings(context: Context): Promise<SettingReport[]> {
  const reports: SettingReport[] = [];
  try {
    const roamingUri = String(await settings.getURI(settings.network.DATA_ROAMING_STATUS));
    reports.push(buildReport(roamingUri, await settings.getValue(context, settings.network.DATA_ROAMING_STATUS), settings.network.DATA_ROAMING_STATUS));
    const proxyUri = String(await settings.getURI(settings.network.HTTP_PROXY_CFG));
    reports.push(buildReport(proxyUri, settings.getValueSync(context, settings.network.HTTP_PROXY_CFG, ''), settings.network.HTTP_PROXY_CFG));
    const prefUri = String(await settings.getURI(settings.network.NETWORK_PREFERENCE_USAGE));
    reports.push(buildReport(prefUri, settings.getValueSync(context, settings.network.NETWORK_PREFERENCE_USAGE, ''), settings.network.NETWORK_PREFERENCE_USAGE));
  } catch (e) {
    console.error('readNetworkSettings failed', e);
  }
  return reports;
}

async function readPhoneSettings(context: Context): Promise<SettingReport[]> {
  const reports: SettingReport[] = [];
  try {
    const rtt = String(await settings.getURI(settings.phone.RTT_CALLING_STATUS));
    reports.push(buildReport(rtt, await settings.getValue(context, settings.phone.RTT_CALLING_STATUS), settings.phone.RTT_CALLING_STATUS));
  } catch (e) {
    console.error('readPhoneSettings failed', e);
  }
  return reports;
}

async function readSoundSettings(context: Context): Promise<SettingReport[]> {
  const reports: SettingReport[] = [];
  try {
    const keys = [
      settings.sound.AFFECTED_MODE_RINGER_STREAMS,
      settings.sound.AFFECTED_MUTE_STREAMS,
      settings.sound.DEFAULT_ALARM_ALERT,
      settings.sound.DEFAULT_NOTIFICATION_SOUND,
      settings.sound.DEFAULT_RINGTONE,
      settings.sound.DTMF_TONE_TYPE_WHILE_DIALING,
      settings.sound.DTMF_TONE_WHILE_DIALING,
      settings.sound.HAPTIC_FEEDBACK_STATUS,
      settings.sound.SOUND_EFFECTS_STATUS,
      settings.sound.VIBRATE_STATUS,
      settings.sound.VIBRATE_WHILE_RINGING,
    ];
    for (const k of keys) {
      reports.push(buildReport(String(await settings.getURI(k)), settings.getValueSync(context, k, ''), k));
    }
  } catch (e) {
    console.error('readSoundSettings failed', e);
  }
  return reports;
}

async function readWirelessSettings(context: Context): Promise<SettingReport[]> {
  const reports: SettingReport[] = [];
  try {
    const keys = [
      settings.wireless.AIRPLANE_MODE_RADIOS,
      settings.wireless.BLUETOOTH_DISCOVER_ABILITY_STATUS,
      settings.wireless.BLUETOOTH_DISCOVER_TIMEOUT,
      settings.wireless.BLUETOOTH_RADIO,
      settings.wireless.BLUETOOTH_STATUS,
      settings.wireless.CELL_RADIO,
      settings.wireless.NFC_RADIO,
      settings.wireless.OWNER_LOCKDOWN_WIFI_CFG,
      settings.wireless.WIFI_DHCP_MAX_RETRY_COUNT,
      settings.wireless.WIFI_RADIO,
      settings.wireless.WIFI_STATUS,
      settings.wireless.WIFI_TO_MOBILE_DATA_AWAKE_TIMEOUT,
      settings.wireless.WIFI_WATCHDOG_STATUS,
    ];
    for (const k of keys) {
      reports.push(buildReport(String(await settings.getURI(k)), await settings.getValue(context, k), k));
    }
  } catch (e) {
    console.error('readWirelessSettings failed', e);
  }
  return reports;
}

async function applyToggles(context: Context): Promise<void> {
  try {
    settings.setValueSync(context, settings.sound.VIBRATE_STATUS, '1');
    settings.setValueSync(context, settings.general.AIRPLANE_MODE_STATUS, '0');
    settings.setValueSync(context, settings.display.DEFAULT_SCREEN_ROTATION, '0');
  } catch (e) {
    console.error('applyToggles failed', e);
  }
}

const run = async (): Promise<void> => {
  const context = getContext();
  const all: SettingReport[] = [];
  all.push(...await readTtsSettings(context));
  all.push(...await readDateSettings(context));
  all.push(...await readDisplaySettings(context));
  all.push(...await readGeneralSettings(context));
  all.push(...await readInputSettings(context));
  all.push(...await readNetworkSettings(context));
  all.push(...await readPhoneSettings(context));
  all.push(...await readSoundSettings(context));
  all.push(...await readWirelessSettings(context));
  await applyToggles(context);
  console.info(`settings report assembled: ${all.length} entries`);
}

run();
