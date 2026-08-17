import { Configuration } from '@ohos.application.Configuration';

// Scenario: inspect the device's application configuration to drive
// locale + color-mode based theming decisions at startup.
async function resolveStartupConfig(): Promise<void> {
  try {
    const config: Configuration = new Configuration();
    const language: string | undefined = config.language;
    const colorMode = config.colorMode;

    const locale: string = language ?? 'en-US';
    const dark: boolean = colorMode === 1; // ConfigurationConstant.ColorMode.COLOR_MODE_DARK

    console.info(`startup locale=${locale}, darkMode=${dark}`);
  } catch (e) {
    console.error('Failed to resolve startup configuration', e);
  }
}

async function run(): Promise<void> {
  await resolveStartupConfig();
}

run();
