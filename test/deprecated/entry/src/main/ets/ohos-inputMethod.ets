import inputMethod from '@ohos.inputMethod';

// Scenario: enumerate installed input methods and surface the legacy
// IME picker dialog while stopping the active input session.
// Exercises the deprecated surface of @ohos.inputMethod end-to-end.

// Obtain the deprecated singleton handles once and reuse them.
const setting: inputMethod.InputMethodSetting = inputMethod.getInputMethodSetting();
const controller: inputMethod.InputMethodController = inputMethod.getInputMethodController();

function listInputMethodsAsync(): Promise<Array<inputMethod.InputMethodProperty>> {
  return new Promise((resolve, reject) => {
    setting.listInputMethod((err, props) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(props);
    });
  });
}

function showOptionalInputMethodsAsync(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    setting.showOptionalInputMethods((err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
  });
}

function displayOptionalInputMethodAsync(): Promise<void> {
  return new Promise((resolve, reject) => {
    setting.displayOptionalInputMethod((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function stopInputAsync(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    controller.stopInput((err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
  });
}

async function listInstalledKeyboards(): Promise<void> {
  try {
    const methods: Array<inputMethod.InputMethodProperty> = await listInputMethodsAsync();
    for (const prop of methods) {
      // Read the deprecated methodId / packageName fields to log IME identity.
      const id: string = prop.methodId;
      const pkg: string = prop.packageName;
      console.info(`installed IME: id=${id} package=${pkg}`);
    }
  } catch (e) {
    console.error('listInstalledKeyboards failed', e);
  }
}

async function openImePicker(): Promise<void> {
  try {
    await showOptionalInputMethodsAsync();
    // Fallback path on older platform: the legacy display dialog.
    await displayOptionalInputMethodAsync();
  } catch (e) {
    console.error('openImePicker failed', e);
  }
}

async function finishActiveSession(): Promise<void> {
  try {
    const stopped: boolean = await stopInputAsync();
    console.info(`stopInput result=${stopped}`);
  } catch (e) {
    console.error('finishActiveSession failed', e);
  }
}

async function run(): Promise<void> {
  await listInstalledKeyboards();
  await openImePicker();
  await finishActiveSession();
}

run();
