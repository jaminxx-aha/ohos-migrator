import wantConstant from '@ohos.ability.wantConstant';

// @ohos.ability.wantConstant 整模块迁移（kit-level，见 import 行）。
// 下面用废弃的 wantConstant 成员构造各类真实 Want，常见于 startAbility / commonEvent 发布。

interface WantLike {
  bundleName?: string;
  abilityName?: string;
  action?: string;
  uri?: string;
  type?: string;
  entities?: string[];
  flags?: number;
  parameters?: Record<string, Object>;
}

// 场景 1：跳转「应用详情」系统设置页（常见于「去设置开启权限」引导）。
function buildAppDetailsWant(bundleName: string): WantLike {
  return {
    action: wantConstant.Action.ACTION_APPLICATION_DETAILS_SETTINGS,
    uri: 'package:' + bundleName,
    entities: [wantConstant.Entity.ENTITY_DEFAULT],
  };
}

// 场景 2：拨打电话
function buildDialWant(phoneNumber: string): WantLike {
  return {
    action: wantConstant.Action.ACTION_DIAL,
    uri: 'tel:' + phoneNumber,
    entities: [wantConstant.Entity.ENTITY_BROWSABLE],
  };
}

// 场景 3：发送短信
function buildSendSmsWant(phoneNumber: string): WantLike {
  return {
    action: wantConstant.Action.ACTION_SEND_SMS,
    uri: 'smsto:' + phoneNumber,
  };
}

// 场景 4：选择文件（文档选择器）
function buildFileSelectWant(type: string): WantLike {
  return {
    action: wantConstant.Action.ACTION_FILE_SELECT,
    type,
    entities: [wantConstant.Entity.ENTITY_DEFAULT],
  };
}

// 场景 5：通用选择
function buildChooseWant(type: string): WantLike {
  return {
    action: wantConstant.Action.ACTION_CHOOSE,
    type,
    entities: [wantConstant.Entity.ENTITY_DEFAULT],
  };
}

// 场景 6：单条选择
function buildSelectWant(uri: string): WantLike {
  return {
    action: wantConstant.Action.ACTION_SELECT,
    uri,
  };
}

// 场景 7：编辑数据
function buildEditDataWant(uri: string): WantLike {
  return {
    action: wantConstant.Action.ACTION_EDIT_DATA,
    uri,
  };
}

// 场景 8：查看数据
function buildViewDataWant(uri: string, type: string): WantLike {
  return {
    action: wantConstant.Action.ACTION_VIEW_DATA,
    uri,
    type,
    entities: [wantConstant.Entity.ENTITY_DEFAULT],
  };
}

// 场景 9：分享单条数据（流式参数）
function buildSendDataWant(type: string, streamUri: string): WantLike {
  const parameters: Record<string, Object> = {};
  parameters[wantConstant.Action.PARAMS_STREAM] = streamUri;
  return {
    action: wantConstant.Action.ACTION_SEND_DATA,
    type,
    parameters,
  };
}

// 场景 10：批量分享（带 intent / title 参数键）
function buildSendMultipleDataWant(type: string, intent: string, title: string): WantLike {
  const parameters: Record<string, Object> = {};
  parameters[wantConstant.Action.INTENT_PARAMS_INTENT] = intent;
  parameters[wantConstant.Action.INTENT_PARAMS_TITLE] = title;
  return {
    action: wantConstant.Action.ACTION_SEND_MULTIPLE_DATA,
    type,
    parameters,
  };
}

// 场景 11：搜索
function buildSearchWant(query: string): WantLike {
  const parameters: Record<string, Object> = {};
  parameters['query'] = query;
  return {
    action: wantConstant.Action.ACTION_SEARCH,
    entities: [wantConstant.Entity.ENTITY_BROWSABLE],
    parameters,
  };
}

// 场景 12：扫描媒体文件
function buildScanMediaWant(): WantLike {
  return { action: wantConstant.Action.ACTION_SCAN_MEDIA_FILE };
}

// 场景 13：跳无线设置
function buildWirelessSettingsWant(): WantLike {
  return {
    action: wantConstant.Action.ACTION_WIRELESS_SETTINGS,
    entities: [wantConstant.Entity.ENTITY_DEFAULT],
  };
}

// 场景 14：回桌面
function buildHomeWant(): WantLike {
  return {
    action: wantConstant.Action.ACTION_HOME,
    entities: [wantConstant.Entity.ENTITY_HOME],
  };
}

// 场景 15：拍照
function buildImageCaptureWant(): WantLike {
  return {
    action: wantConstant.Action.ACTION_IMAGE_CAPTURE,
    entities: [wantConstant.Entity.ENTITY_DEFAULT],
  };
}

// 场景 16：录像
function buildVideoCaptureWant(): WantLike {
  return {
    action: wantConstant.Action.ACTION_VIDEO_CAPTURE,
    entities: [wantConstant.Entity.ENTITY_VIDEO],
  };
}

// 场景 17：语音搜索
function buildVoiceSearchWant(): WantLike {
  return {
    action: wantConstant.Action.ACTION_SEARCH,
    entities: [wantConstant.Entity.ENTITY_VOICE],
  };
}

// 场景 18：管理应用设置
function buildManageAppsWant(): WantLike {
  return { action: wantConstant.Action.ACTION_MANAGE_APPLICATIONS_SETTINGS };
}

// 场景 19：app account oauth 授权
function buildAppAccountOauthWant(): WantLike {
  return { action: wantConstant.Action.ACTION_APP_ACCOUNT_OAUTH };
}

// 场景 20：闹钟类动作
function buildDismissAlarmWant(): WantLike {
  return { action: wantConstant.Action.ACTION_DISMISS_ALARM };
}
function buildSnoozeAlarmWant(): WantLike {
  return { action: wantConstant.Action.ACTION_SNOOZE_ALARM };
}
function buildShowAlarmsWant(): WantLike {
  return { action: wantConstant.Action.ACTION_SHOW_ALARMS };
}
function buildSetAlarmWant(): WantLike {
  return { action: wantConstant.Action.ACTION_SET_ALARM };
}
function buildDismissTimerWant(): WantLike {
  return { action: wantConstant.Action.ACTION_DISMISS_TIMER };
}

// 场景 21：跨设备迁移续接（continuation + 新任务 + 栈顶）
function buildContinuationWant(bundleName: string, abilityName: string): WantLike {
  return {
    bundleName,
    abilityName,
    action: wantConstant.Action.ACTION_HOME,
    flags: wantConstant.Flags.FLAG_ABILITY_CONTINUATION
      | wantConstant.Flags.FLAG_ABILITY_NEW_MISSION
      | wantConstant.Flags.FLAG_ABILITY_MISSION_TOP,
  };
}

// 场景 22：多设备启动
function buildMultiDeviceWant(bundleName: string, abilityName: string): WantLike {
  return {
    bundleName,
    abilityName,
    flags: wantConstant.Flags.FLAG_ABILITYSLICE_MULTI_DEVICE
      | wantConstant.Flags.FLAG_NOT_OHOS_COMPONENT,
  };
}

// 场景 23：清空任务栈后启动
function buildClearMissionWant(bundleName: string, abilityName: string): WantLike {
  return {
    bundleName,
    abilityName,
    flags: wantConstant.Flags.FLAG_ABILITY_CLEAR_MISSION,
  };
}

// 场景 24：转发结果
function buildForwardResultWant(bundleName: string, abilityName: string): WantLike {
  return {
    bundleName,
    abilityName,
    flags: wantConstant.Flags.FLAG_ABILITY_FORWARD_RESULT,
  };
}

// 场景 25：启用卡片
function buildFormEnabledWant(bundleName: string, abilityName: string): WantLike {
  return {
    bundleName,
    abilityName,
    flags: wantConstant.Flags.FLAG_ABILITY_FORM_ENABLED,
  };
}

// 场景 26：前台启动 + 安装态
function buildForegroundWant(bundleName: string, abilityName: string): WantLike {
  return {
    bundleName,
    abilityName,
    flags: wantConstant.Flags.FLAG_START_FOREGROUND_ABILITY
      | wantConstant.Flags.FLAG_INSTALL_ON_DEMAND
      | wantConstant.Flags.FLAG_INSTALL_WITH_BACKGROUND_MODE,
  };
}

// 场景 27：授权 URI 读写
function buildAuthUriWant(bundleName: string, abilityName: string, uri: string): WantLike {
  return {
    bundleName,
    abilityName,
    uri,
    flags: wantConstant.Flags.FLAG_AUTH_READ_URI_PERMISSION
      | wantConstant.Flags.FLAG_AUTH_WRITE_URI_PERMISSION,
  };
}

// 汇总：构造好的 Want 交 ability context 的 startAbility(want) 使用。
function buildSampleWants(): WantLike[] {
  return [
    buildAppDetailsWant('com.example.app'),
    buildDialWant('10086'),
    buildSendSmsWant('10086'),
    buildFileSelectWant('text/plain'),
    buildChooseWant('image/*'),
    buildSelectWant('content://contacts/1'),
    buildEditDataWant('content://contacts/1'),
    buildViewDataWant('content://contacts/1', 'vnd.android.cursor.item/contact'),
    buildSendDataWant('text/plain', 'content://share/1'),
    buildSendMultipleDataWant('image/*', 'gallery', '分享图片'),
    buildSearchWant('鸿蒙'),
    buildScanMediaWant(),
    buildWirelessSettingsWant(),
    buildHomeWant(),
    buildImageCaptureWant(),
    buildVideoCaptureWant(),
    buildVoiceSearchWant(),
    buildManageAppsWant(),
    buildAppAccountOauthWant(),
    buildDismissAlarmWant(),
    buildSnoozeAlarmWant(),
    buildShowAlarmsWant(),
    buildSetAlarmWant(),
    buildDismissTimerWant(),
    buildContinuationWant('com.example.app', 'MainAbility'),
    buildMultiDeviceWant('com.example.app', 'MainAbility'),
    buildClearMissionWant('com.example.app', 'MainAbility'),
    buildForwardResultWant('com.example.app', 'MainAbility'),
    buildFormEnabledWant('com.example.app', 'FormAbility'),
    buildForegroundWant('com.example.app', 'MainAbility'),
    buildAuthUriWant('com.example.app', 'MainAbility', 'content://files/1'),
  ];
}

buildSampleWants();
