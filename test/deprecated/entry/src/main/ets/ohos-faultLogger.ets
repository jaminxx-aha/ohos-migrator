import FaultLogger from '@ohos.faultLogger';

// Scenario: enumerate every FaultType, then query & querySelfFaultLog to fetch
// fault log entries and render the contents of a FaultLogInfo record.

const FAULT_TYPES: FaultLogger.FaultType[] = [
  FaultLogger.FaultType.NO_SPECIFIC,
  FaultLogger.FaultType.JS_CRASH,
  FaultLogger.FaultType.CPP_CRASH,
  FaultLogger.FaultType.APP_FREEZE,
];

function formatFault(info: FaultLogger.FaultLogInfo): string {
  return [
    `pid=${info.pid}`,
    `uid=${info.uid}`,
    `type=${info.type}`,
    `timestamp=${info.timestamp}`,
    `reason=${info.reason}`,
    `module=${info.module}`,
    `summary=${info.summary}`,
  ].join(' | ') + `\n--- fullLog ---\n${info.fullLog}`;
}

async function queryFaultsByType(faultType: FaultLogger.FaultType): Promise<FaultLogger.FaultLogInfo[]> {
  return new Promise((resolve, reject) => {
    FaultLogger.query(faultType, (err: Error, infos: Array<FaultLogger.FaultLogInfo>) => {
      if (err) {
        console.error(`query failed for faultType=${faultType}`, err);
        reject(err);
        return;
      }
      resolve(infos);
    });
  });
}

async function querySelfFaults(faultType: FaultLogger.FaultType): Promise<FaultLogger.FaultLogInfo[]> {
  return new Promise((resolve, reject) => {
    FaultLogger.querySelfFaultLog(faultType, (err: Error, infos: Array<FaultLogger.FaultLogInfo>) => {
      if (err) {
        console.error(`querySelfFaultLog failed for faultType=${faultType}`, err);
        reject(err);
        return;
      }
      resolve(infos);
    });
  });
}

async function dumpRecentFaults(): Promise<void> {
  try {
    for (const ft of FAULT_TYPES) {
      const selfInfos = await querySelfFaults(ft);
      for (const info of selfInfos) {
        console.log(`[self ${ft}] ${formatFault(info)}`);
      }
      const allInfos = await queryFaultsByType(ft);
      for (const info of allInfos) {
        console.log(`[all ${ft}] ${formatFault(info)}`);
      }
    }
  } catch (e) {
    console.error('dumpRecentFaults failed', e);
  }
}

async function run(): Promise<void> {
  await dumpRecentFaults();
}

run();
