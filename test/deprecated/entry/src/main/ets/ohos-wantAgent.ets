import wantAgent from '@ohos.wantAgent';
import { WantAgent } from '@ohos.wantAgent';
import Want from '@ohos.app.ability.Want';

// WantAgentInfo / TriggerInfo are not re-exported by the @ohos.wantAgent namespace,
// so local structural interfaces describe the legacy argument shapes passed to the
// deprecated getWantAgent / trigger APIs.
interface WantAgentInfoLike {
  wants: Want[];
  operationType: wantAgent.OperationType;
  requestCode: number;
  wantAgentFlags: Array<wantAgent.WantAgentFlags>;
}
interface TriggerInfoLike {
  code: number;
  want: Want;
}

// Scenario: a notification-style app builds a WantAgent that fires a common event
// when the user taps a notification, triggers it, inspects the completion data,
// compares/identifies two agents, and finally cancels the agent.

// Map a business notification kind to the underlying deprecated operation type.
function resolveOperationType(kind: string): wantAgent.OperationType {
  switch (kind) {
    case 'start-ability':
      return wantAgent.OperationType.START_ABILITY;
    case 'start-abilities':
      return wantAgent.OperationType.START_ABILITIES;
    case 'start-service':
      return wantAgent.OperationType.START_SERVICE;
    case 'send-common-event':
      return wantAgent.OperationType.SEND_COMMON_EVENT;
    default:
      return wantAgent.OperationType.UNKNOWN_TYPE;
  }
}

async function buildCommonEventAgent(): Promise<WantAgent> {
  const want: Want = {
    bundleName: 'com.example.notifier',
    abilityName: 'NotificationAbility',
    action: 'ohos.action.notification.tap',
    uri: 'notif://tap/42',
    entities: ['entity.system.default'],
  };
  // A fully-replaceable, one-shot common-event agent; exercise every flag member.
  const flags: Array<wantAgent.WantAgentFlags> = [
    wantAgent.WantAgentFlags.ONE_TIME_FLAG,
    wantAgent.WantAgentFlags.NO_BUILD_FLAG,
    wantAgent.WantAgentFlags.CANCEL_PRESENT_FLAG,
    wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG,
    wantAgent.WantAgentFlags.CONSTANT_FLAG,
    wantAgent.WantAgentFlags.REPLACE_ELEMENT,
    wantAgent.WantAgentFlags.REPLACE_ACTION,
    wantAgent.WantAgentFlags.REPLACE_URI,
    wantAgent.WantAgentFlags.REPLACE_ENTITIES,
    wantAgent.WantAgentFlags.REPLACE_BUNDLE,
  ];
  const info: WantAgentInfoLike = {
    wants: [want],
    operationType: resolveOperationType('send-common-event'),
    requestCode: 42,
    wantAgentFlags: flags,
  };
  return await wantAgent.getWantAgent(info);
}

function triggerAndInspect(agent: WantAgent): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const triggerWant: Want = { action: 'ohos.action.notification.tap', uri: 'notif://tap/42' };
    const triggerInfo: TriggerInfoLike = {
      code: 42,
      want: triggerWant,
    };
    wantAgent.trigger(agent, triggerInfo, (data: wantAgent.CompleteData) => {
      try {
        // Inspect every deprecated field of the completion data.
        const triggeredAgent: WantAgent = data.info;
        const triggeredWant: Want = data.want;
        const code: number = data.finalCode;
        const payload: string = data.finalData;
        const extra: object | undefined = data.extraInfo;
        console.info('trigger complete', code, payload, !!triggeredWant, !!triggeredAgent, !!extra);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function compareAndIdentify(a: WantAgent, b: WantAgent): Promise<void> {
  const same = await wantAgent.equal(a, b);
  const bundle = await wantAgent.getBundleName(a);
  const uid = await wantAgent.getUid(a);
  console.info('agent identity', same, bundle, uid);
}

async function cancelAgent(agent: WantAgent): Promise<void> {
  await wantAgent.cancel(agent);
  console.info('agent cancelled');
}

async function run(): Promise<void> {
  try {
    const agent = await buildCommonEventAgent();
    const sibling = await buildCommonEventAgent();
    await triggerAndInspect(agent);
    await compareAndIdentify(agent, sibling);
    await cancelAgent(agent);
  } catch (e) {
    console.error('wantAgent scenario failed', e);
  }
}

run();
