import formInfo from '@ohos.application.formInfo';
import Want from '@ohos.app.ability.Want';

// Scenario 1: Build a form-host request Want using the deprecated FormParam keys,
// then inspect a FormInfo descriptor returned by the form manager.
function buildFormRequestWant(): Want {
  const want: Want = {
    bundleName: 'com.example.weatherapp',
    abilityName: 'WeatherFormAbility',
    parameters: {
      [formInfo.FormParam.MODULE_NAME_KEY]: 'entry',
      [formInfo.FormParam.NAME_KEY]: 'weatherCard',
      [formInfo.FormParam.DIMENSION_KEY]: 2,
      [formInfo.FormParam.WIDTH_KEY]: 800,
      [formInfo.FormParam.HEIGHT_KEY]: 400,
      [formInfo.FormParam.TEMPORARY_KEY]: false,
    },
  };
  return want;
}

function describeFormInfo(info: formInfo.FormInfo): string {
  const parts: string[] = [];
  parts.push(`bundle=${info.bundleName}`);
  parts.push(`module=${info.moduleName}`);
  parts.push(`ability=${info.abilityName}`);
  parts.push(`name=${info.name}`);
  parts.push(`desc=${info.description}`);
  parts.push(`type=${info.type}`);
  parts.push(`jsComponent=${info.jsComponentName}`);
  parts.push(`colorMode=${info.colorMode}`);
  parts.push(`isDefault=${info.isDefault}`);
  parts.push(`updateEnabled=${info.updateEnabled}`);
  parts.push(`formVisibleNotify=${info.formVisibleNotify}`);
  parts.push(`relatedBundle=${info.relatedBundleName}`);
  parts.push(`scheduledUpdateTime=${info.scheduledUpdateTime}`);
  parts.push(`formConfigAbility=${info.formConfigAbility}`);
  parts.push(`updateDuration=${info.updateDuration}`);
  parts.push(`defaultDimension=${info.defaultDimension}`);
  parts.push(`supportDimensions=${info.supportDimensions.join(',')}`);
  const customizeKeys = Object.keys(info.customizeData);
  parts.push(`customizeDataKeys=${customizeKeys.join(',')}`);
  return parts.join('; ');
}

// Scenario 2: Construct a realistic FormInfo object (as the form manager would
// return) and read every deprecated field off of it.
function inspectFormInfo(): void {
  const info: formInfo.FormInfo = {
    bundleName: 'com.example.weatherapp',
    moduleName: 'entry',
    abilityName: 'WeatherFormAbility',
    name: 'weatherCard',
    description: 'Daily weather forecast card',
    type: formInfo.FormType.JS,
    jsComponentName: 'weatherComponent',
    colorMode: formInfo.ColorMode.MODE_AUTO,
    isDefault: true,
    updateEnabled: true,
    formVisibleNotify: true,
    relatedBundleName: 'com.example.weatherapp',
    scheduledUpdateTime: '08:00',
    formConfigAbility: 'com.example.weatherapp.WeatherConfigAbility',
    updateDuration: 60,
    defaultDimension: 2,
    supportDimensions: [1, 2, 4],
    customizeData: {
      city: ['Shanghai'],
      unit: ['celsius'],
    },
  };
  console.info('formInfo detail: ' + describeFormInfo(info));

  // Touch each ColorMode literal explicitly so coverage stays stable.
  const modes: number[] = [
    formInfo.ColorMode.MODE_AUTO,
    formInfo.ColorMode.MODE_DARK,
    formInfo.ColorMode.MODE_LIGHT,
  ];
  console.info('colorModes: ' + modes.join(','));
}

// Scenario 3: Build and inspect a FormStateInfo (form state query result).
function inspectFormStateInfo(): void {
  const want: Want = buildFormRequestWant();
  const stateInfo: formInfo.FormStateInfo = {
    formState: formInfo.FormState.READY,
    want,
  };
  console.info(
    `formState=${stateInfo.formState}, want.bundle=${stateInfo.want.bundleName}`,
  );

  // Touch every FormState literal so coverage stays stable.
  const states: number[] = [
    formInfo.FormState.UNKNOWN,
    formInfo.FormState.DEFAULT,
    formInfo.FormState.READY,
  ];
  console.info('formStates: ' + states.join(','));
}

async function run(): Promise<void> {
  try {
    inspectFormInfo();
  } catch (e) {
    console.error('inspectFormInfo failed', e);
  }
  try {
    inspectFormStateInfo();
  } catch (e) {
    console.error('inspectFormStateInfo failed', e);
  }
  try {
    const want = buildFormRequestWant();
    console.info('formRequestWant: ' + JSON.stringify(want));
  } catch (e) {
    console.error('buildFormRequestWant failed', e);
  }
}

run();
