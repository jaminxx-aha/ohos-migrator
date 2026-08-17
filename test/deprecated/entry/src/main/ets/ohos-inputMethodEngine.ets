import inputMethodEngine from '@ohos.inputMethodEngine';

let _v0: inputMethodEngine.InputMethodEngine;
declare let _v1: inputMethodEngine.InputMethodEngine; _v1.off('inputStart');
declare let _v2: inputMethodEngine.InputMethodEngine; _v2.on('inputStart', () => {});
declare let _v3: inputMethodEngine.KeyboardController; _v3.hideKeyboard();
let _v4: inputMethodEngine.TextInputClient;
declare let _v5: inputMethodEngine.TextInputClient; _v5.deleteBackward(0);
declare let _v6: inputMethodEngine.TextInputClient; _v6.deleteForward(0);
declare let _v7: inputMethodEngine.TextInputClient; _v7.getBackward(0);
declare let _v8: inputMethodEngine.TextInputClient; _v8.getEditorAttribute();
declare let _v9: inputMethodEngine.TextInputClient; _v9.getForward(0);
declare let _v10: inputMethodEngine.TextInputClient; _v10.insertText('');
declare let _v11: inputMethodEngine.TextInputClient; _v11.sendKeyFunction(0);
inputMethodEngine.createKeyboardDelegate();
inputMethodEngine.getInputMethodEngine();
