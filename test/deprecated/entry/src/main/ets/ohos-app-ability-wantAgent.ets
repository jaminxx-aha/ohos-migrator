import wantAgent from '@ohos.app.ability.wantAgent';
import Want from '@ohos.app.ability.Want';

// Scenario: build a WantAgent that launches a specific ability when a notification is tapped,
// using the legacy (since-11) WantAgentInfo fields operationType and wantAgentFlags.

async function buildLaunchAbilityAgent(): Promise<wantAgent.WantAgent> {
  const targetWant: Want = {
    bundleName: 'com.example.notifications',
    abilityName: 'DetailAbility',
    uri: 'entity://item/1024',
  };

  const info: wantAgent.WantAgentInfo = {
    wants: [targetWant],
    requestCode: 1001,
    // Deprecated since 11; use actionType instead.
    operationType: wantAgent.OperationType.START_ABILITY,
    // Deprecated since 11; use actionFlags instead.
    wantAgentFlags: [wantAgent.WantAgentFlags.ONE_TIME_FLAG,
      wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
    extraInfo: { source: 'notification', tid: '1024' },
  };

  try {
    const agent = await wantAgent.getWantAgent(info);
    // Read the legacy (since-11) fields back for logging before migrating to actionType/actionFlags.
    const legacyOpType: wantAgent.OperationType | undefined = info.operationType;
    const legacyFlags: Array<wantAgent.WantAgentFlags> | undefined = info.wantAgentFlags;
    const opType = await wantAgent.getOperationType(agent);
    console.info('built WantAgent opType=' + opType +
      ' legacy.operationType=' + legacyOpType +
      ' legacy.wantAgentFlags=' + (legacyFlags ? legacyFlags.length : 0));
    return agent;
  } catch (e) {
    console.error('failed to build launch-ability WantAgent', e);
    throw e;
  }
}

async function run(): Promise<void> {
  await buildLaunchAbilityAgent();
}

run();
