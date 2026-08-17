import Want from '@ohos.application.Want';

// Scenario: construct and inspect a Want used to launch an explicit ability,
// then read back each deprecated field when forwarding the request.

function buildExplicitWant(): Want {
  const want: Want = {
    bundleName: 'com.example.contacts',
    abilityName: 'EntryAbility',
    deviceId: '0',
    entities: ['entity.system.home'],
    action: 'action.system.home',
    flags: 0x00000001,
    type: 'text/plain',
    uri: 'tel:10086',
    parameters: { contactId: '1024', source: 'shortcut' }
  };
  return want;
}

function describeWant(want: Want): void {
  const bn = want.bundleName;
  const an = want.abilityName;
  const dv = want.deviceId;
  const ents = want.entities;
  const act = want.action;
  const fl = want.flags;
  const ty = want.type;
  const u = want.uri;
  const ps = want.parameters;
  console.info('describeWant', bn, an, dv, act, ents, fl, ty, u, ps);
}

async function run(): Promise<void> {
  try {
    const want = buildExplicitWant();
    describeWant(want);
  } catch (e) {
    console.error('build/describe want failed', e);
  }
}

run();
