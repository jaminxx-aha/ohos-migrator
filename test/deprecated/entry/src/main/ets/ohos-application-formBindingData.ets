import formBindingData from '@ohos.application.formBindingData';

// Scenario: build a form-binding payload for a weather widget, then read back its data field.
async function buildWeatherFormBinding(): Promise<void> {
  const city = 'Shenzhen';
  const temperature = 26;
  const condition = 'Cloudy';

  // createFormBindingData accepts an Object or JSON string describing the card's data.
  const binding: formBindingData.FormBindingData = formBindingData.createFormBindingData({
    city,
    temperature,
    condition,
    updatedAt: Date.now(),
  });

  try {
    // Read back the deprecated `data` property to forward to a legacy renderer.
    const payload: Object = binding.data;
    console.info('weather form binding payload:', JSON.stringify(payload));
  } catch (e) {
    console.error('read form binding data failed', e);
  }
}

async function run(): Promise<void> {
  await buildWeatherFormBinding();
}

run();
