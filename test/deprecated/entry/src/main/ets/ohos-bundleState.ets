import bundleState from '@ohos.bundleState';

// Scenario: enumerate the supported IntervalType values for a usage report
function reportIntervalTypes(): void {
  const supported: bundleState.IntervalType[] = [
    bundleState.IntervalType.BY_OPTIMIZED,
    bundleState.IntervalType.BY_DAILY,
    bundleState.IntervalType.BY_WEEKLY,
    bundleState.IntervalType.BY_MONTHLY,
    bundleState.IntervalType.BY_ANNUALLY,
  ];
  console.log('supported interval types:', supported.length);
}

// Scenario: check whether a target application is currently idle
async function checkAppIdleState(bundleName: string): Promise<boolean> {
  try {
    const idle: boolean = await bundleState.isIdleState(bundleName);
    console.log(`app ${bundleName} idle=${idle}`);
    return idle;
  } catch (e) {
    console.error('isIdleState failed', e);
    return false;
  }
}

// Scenario: query the calling application's usage priority group
async function queryAppPriorityGroup(): Promise<number> {
  try {
    const group: number = await bundleState.queryAppUsagePriorityGroup();
    console.log('current app priority group:', group);
    return group;
  } catch (e) {
    console.error('queryAppUsagePriorityGroup failed', e);
    return -1;
  }
}

// Scenario: query the current bundle's foreground events over a time window
async function queryCurrentBundleStates(begin: number, end: number): Promise<void> {
  try {
    const states: Array<bundleState.BundleActiveState> =
      await bundleState.queryCurrentBundleActiveStates(begin, end);
    for (const s of states) {
      const group = s.appUsagePriorityGroup;
      const name = s.bundleName;
      const link = s.indexOfLink;
      const cls = s.nameOfClass;
      const occurred = s.stateOccurredTime;
      const type = s.stateType;
      console.log('event', name, cls, link, occurred, type, group);
    }
  } catch (e) {
    console.error('queryCurrentBundleActiveStates failed', e);
  }
}

// Scenario: build and merge BundleStateInfo usage summaries for one bundle
async function summarizeBundleStateInfo(): Promise<void> {
  const base: bundleState.BundleStateInfo = {
    id: 1001,
    abilityInFgTotalTime: 32000,
    abilityPrevAccessTime: Date.now() - 600000,
    abilityPrevSeenTime: Date.now() - 600000,
    abilitySeenTotalTime: 15000,
    bundleName: 'com.example.notes',
    fgAbilityAccessTotalTime: 8000,
    fgAbilityPrevAccessTime: Date.now() - 300000,
    infosBeginTime: Date.now() - 3600000,
    infosEndTime: Date.now(),
    merge(toMerge: bundleState.BundleStateInfo): void { void toMerge; },
  };
  const extra: bundleState.BundleStateInfo = {
    id: 1001,
    abilityInFgTotalTime: 10000,
    abilityPrevAccessTime: Date.now() - 120000,
    abilityPrevSeenTime: Date.now() - 120000,
    abilitySeenTotalTime: 5000,
    bundleName: 'com.example.notes',
    fgAbilityAccessTotalTime: 4000,
    fgAbilityPrevAccessTime: Date.now() - 90000,
    infosBeginTime: Date.now() - 1800000,
    infosEndTime: Date.now() - 600000,
    merge(toMerge: bundleState.BundleStateInfo): void { void toMerge; },
  };
  base.merge(extra);
  console.log(
    'merged summary:',
    base.bundleName,
    'fgTotal=', base.abilityInFgTotalTime,
    'seenTotal=', base.abilitySeenTotalTime,
    'fgAbilityTotal=', base.fgAbilityAccessTotalTime,
    'fgAbilityPrev=', base.fgAbilityPrevAccessTime,
    'prevAccess=', base.abilityPrevAccessTime,
    'prevSeen=', base.abilityPrevSeenTime,
    'begin=', base.infosBeginTime,
    'end=', base.infosEndTime,
    'id=', base.id,
  );
}

async function run(): Promise<void> {
  reportIntervalTypes();
  await checkAppIdleState('com.example.target');
  await queryAppPriorityGroup();
  const dayMs: number = 24 * 60 * 60 * 1000;
  await queryCurrentBundleStates(Date.now() - dayMs, Date.now());
  await summarizeBundleStateInfo();
}

run();
