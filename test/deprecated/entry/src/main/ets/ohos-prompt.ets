import prompt from '@ohos.prompt';

// @ohos.prompt.prompt: module-move (kit-level); covered by the import line
let _v0: prompt.ActionMenuOptions;
declare let _v1: prompt.ActionMenuOptions; _v1.buttons;
declare let _v2: prompt.ActionMenuOptions; _v2.title;
let _v3: prompt.ActionMenuSuccessResponse;
declare let _v4: prompt.ActionMenuSuccessResponse; _v4.index;
let _v5: prompt.Button;
declare let _v6: prompt.Button; _v6.color;
declare let _v7: prompt.Button; _v7.text;
let _v8: prompt.ShowDialogOptions;
declare let _v9: prompt.ShowDialogOptions; _v9.buttons;
declare let _v10: prompt.ShowDialogOptions; _v10.message;
declare let _v11: prompt.ShowDialogOptions; _v11.title;
let _v12: prompt.ShowDialogSuccessResponse;
declare let _v13: prompt.ShowDialogSuccessResponse; _v13.index;
let _v14: prompt.ShowToastOptions;
declare let _v15: prompt.ShowToastOptions; _v15.bottom;
declare let _v16: prompt.ShowToastOptions; _v16.duration;
declare let _v17: prompt.ShowToastOptions; _v17.message;
prompt.showActionMenu;
prompt.showDialog;
prompt.showToast({ message: '' });
