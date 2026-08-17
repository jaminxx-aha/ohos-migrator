import inputMethod from '@ohos.inputMethod';

declare let _v0: inputMethod.InputMethodController; _v0.stopInput();
declare let _v1: inputMethod.InputMethodProperty; _v1.methodId;
declare let _v2: inputMethod.InputMethodProperty; _v2.packageName;
declare let _v3: inputMethod.InputMethodSetting; _v3.displayOptionalInputMethod();
declare let _v4: inputMethod.InputMethodSetting; _v4.listInputMethod();
declare let _v5: inputMethod.InputMethodSetting; _v5.showOptionalInputMethods();
inputMethod.getInputMethodController();
inputMethod.getInputMethodSetting();
