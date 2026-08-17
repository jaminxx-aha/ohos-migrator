import hiAppEvent from '@ohos.hiAppEvent';

// @ohos.hiAppEvent.hiAppEvent: module-move (kit-level); covered by the import line
// @ohos.hiAppEvent.Event: namespace; detected via the import line; usage omitted
// @ohos.hiAppEvent.Param: namespace; detected via the import line; usage omitted
let _v0: hiAppEvent.ConfigOption;
declare let _v1: hiAppEvent.ConfigOption; _v1.disable;
declare let _v2: hiAppEvent.ConfigOption; _v2.maxStorage;
hiAppEvent.Event.DISTRIBUTED_SERVICE_START;
hiAppEvent.Event.USER_LOGIN;
hiAppEvent.Event.USER_LOGOUT;
hiAppEvent.EventType;
hiAppEvent.EventType.BEHAVIOR;
hiAppEvent.EventType.FAULT;
hiAppEvent.EventType.SECURITY;
hiAppEvent.EventType.STATISTIC;
hiAppEvent.Param.DISTRIBUTED_SERVICE_INSTANCE_ID;
hiAppEvent.Param.DISTRIBUTED_SERVICE_NAME;
hiAppEvent.Param.USER_ID;
hiAppEvent.configure;
hiAppEvent.write;
