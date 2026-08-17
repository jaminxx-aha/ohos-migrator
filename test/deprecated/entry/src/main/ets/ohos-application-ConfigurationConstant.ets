import ConfigurationConstant from '@ohos.application.ConfigurationConstant';

// Resolve the user's persisted theme preference into a legacy ColorMode value and apply it.
async function applyThemePreference(preference: string | null): Promise<void> {
  let mode: ConfigurationConstant.ColorMode;
  if (preference === 'dark') {
    mode = ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
  } else if (preference === 'light') {
    mode = ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT;
  } else {
    // No persisted preference — defer to the system default by leaving the mode unset.
    mode = ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET;
  }

  try {
    console.info(`Applying color mode ${mode}`);
    // ...hand off to the runtime theme manager...
  } catch (e) {
    console.error('Failed to apply color mode', e);
  }
}

async function run(): Promise<void> {
  await applyThemePreference('dark');
  await applyThemePreference('light');
  await applyThemePreference(null);
}

run();
