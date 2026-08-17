import FaultLogger from '@ohos.faultLogger';

// @ohos.faultLogger.FaultLogger: module-move (kit-level); covered by the import line
let _v0: FaultLogger.FaultLogInfo;
declare let _v1: FaultLogger.FaultLogInfo; _v1.fullLog;
declare let _v2: FaultLogger.FaultLogInfo; _v2.module;
declare let _v3: FaultLogger.FaultLogInfo; _v3.pid;
declare let _v4: FaultLogger.FaultLogInfo; _v4.reason;
declare let _v5: FaultLogger.FaultLogInfo; _v5.summary;
declare let _v6: FaultLogger.FaultLogInfo; _v6.timestamp;
declare let _v7: FaultLogger.FaultLogInfo; _v7.type;
declare let _v8: FaultLogger.FaultLogInfo; _v8.uid;
FaultLogger.FaultType;
FaultLogger.FaultType.APP_FREEZE;
FaultLogger.FaultType.CPP_CRASH;
FaultLogger.FaultType.JS_CRASH;
FaultLogger.FaultType.NO_SPECIFIC;
FaultLogger.query(FaultLogger.FaultType.NO_SPECIFIC);
FaultLogger.querySelfFaultLog(FaultLogger.FaultType.NO_SPECIFIC);
