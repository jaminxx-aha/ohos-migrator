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
  displayNameId: 0,
  description: '2x1 weather card',
  descriptionId: 0,
  type: formInfo.FormType.JS,
  jsComponentName: 'WeatherForm',
  colorMode: resolveColorMode('auto'),
  isDefault: true,
  updateEnabled: true,
  formVisibleNotify: false,
  scheduledUpdateTime: '00:00',
  formConfigAbility: 'com.example.weather.FormConfigAbility',
  updateDuration: 1,
  defaultDimension: formInfo.FormDimension.Dimension_2_1,
  supportDimensions: [formInfo.FormDimension.Dimension_2_1],
  customizeData: new Object() as Record<string, string>,
  isDynamic: true,
  transparencyEnabled: false,
  supportedShapes: [0],
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
