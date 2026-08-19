import formProvider from '@ohos.app.form.formProvider';

// Scenario: enumerate the bundle's published forms and refresh metadata for a single form.

async function listAllPublishedForms(): Promise<void> {
  try {
    const infos = await formProvider.getPublishedFormInfos();
    for (const info of infos) {
      console.info('published form: bundle=' + info.bundleName + ' name=' + info.name);
    }
  } catch (e) {
    console.error('getPublishedFormInfos failed', e);
  }
}

async function lookupPublishedFormById(formId: string): Promise<void> {
  try {
    const info = await formProvider.getPublishedFormInfoById(formId);
    console.info('form ' + formId + ' bundle=' + info.bundleName);
  } catch (e) {
    console.error('getPublishedFormInfoById failed', e);
  }
}

async function run(): Promise<void> {
  await listAllPublishedForms();
  await lookupPublishedFormById('1001');
}

run();
