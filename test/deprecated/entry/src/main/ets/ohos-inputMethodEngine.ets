import inputMethodEngine from '@ohos.inputMethodEngine';

// Scenario: a legacy IME sets up the deprecated InputMethodEngine event wiring and
// drives the bound TextInputClient/KeyboardController once an input session starts.

async function handleInputSession(
  kbController: inputMethodEngine.KeyboardController,
  client: inputMethodEngine.TextInputClient
): Promise<void> {
  try {
    const attr = await client.getEditorAttribute();
    const pattern = attr.inputPattern;
    console.info('editor inputPattern: ' + pattern);

    const before = await client.getForward(16);
    const after = await client.getBackward(16);
    console.info('surrounding text: ' + before + '|' + after);

    await client.insertText('你好，');
    await client.deleteForward(1);
    await client.deleteBackward(1);

    const ok = await client.sendKeyFunction(inputMethodEngine.ENTER_KEY_TYPE_DONE);
    console.info('sendKeyFunction result: ' + ok);

    await kbController.hideKeyboard();
  } catch (e) {
    console.error('input session handling failed', e);
  }
}

async function setupLegacyEngine(): Promise<void> {
  const engine: inputMethodEngine.InputMethodEngine = inputMethodEngine.getInputMethodEngine();
  engine.on('inputStart', (kbController: inputMethodEngine.KeyboardController, textInputClient: inputMethodEngine.TextInputClient) => {
    handleInputSession(kbController, textInputClient);
  });
  engine.off('inputStart');
}

async function setupLegacyKeyboardDelegate(): Promise<void> {
  const delegate = inputMethodEngine.createKeyboardDelegate();
  console.info('legacy keyboard delegate ready: ' + (delegate !== undefined));
}

async function run(): Promise<void> {
  await setupLegacyEngine();
  await setupLegacyKeyboardDelegate();
}

run();
