import formInfo from '@ohos.app.form.formInfo';

// Scenario: build a FormInfo descriptor for a 2x1 weather widget and report its color mode.

function resolveColorMode(preference: 'auto' | 'dark' | 'light'): formInfo.ColorMode {
  switch (preference) {
    case 'dark':
      return formInfo.ColorMode.MODE_DARK;
    case 'light':
      return formInfo.ColorMode.MODE_LIGHT;
    default:
      return formInfo.ColorMode.MODE_AUTO;
  }
}

const weatherWidget: formInfo.FormInfo = {
  bundleName: 'com.example.weather',
  moduleName: 'entry',
  abilityName: 'WeatherFormAbility',
  name: 'com.example.weather.WeatherForm',
  displayName: 'Weather',
  description: '2x1 weather card',
  type: 0,
  colorMode: resolveColorMode('auto'),
  supportDimensions: [formInfo.FormDimension.Dimension_2_1],
  defaultDimension: formInfo.FormDimension.Dimension_2_1,
};

async function run(): Promise<void> {
  try {
    const mode: formInfo.ColorMode = weatherWidget.colorMode;
    console.info(`weather widget color mode: ${mode}`);
  } catch (e) {
    console.error('failed to read form info', e);
  }
}

run();
