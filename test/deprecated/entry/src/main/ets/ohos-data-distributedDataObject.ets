import distributedDataObject from '@ohos.data.distributedDataObject';

// Scenario: sync a small user-profile record across devices using the legacy
// DistributedObject API (deprecated since 9 in favor of ohos.distributedDataObject).

interface UserProfile {
  name: string;
  age: number;
  email: string;
}

async function syncProfileAcrossDevices(): Promise<void> {
  const source: UserProfile = {
    name: 'Alice',
    age: 28,
    email: 'alice@example.com',
  };

  // createDistributedObject: build the distributed object from a source object.
  const obj: distributedDataObject.DistributedObject =
    distributedDataObject.createDistributedObject(source);

  const onChange = (sessionId: string, fields: Array<string>): void => {
    console.info('profile changed', sessionId, fields.join(','));
  };

  // on: subscribe to data-change events from peer devices.
  obj.on('change', onChange);

  // setSessionId: join the collaborative session so edits start syncing.
  const sessionId = 'profile-session-001';
  const joined: boolean = obj.setSessionId(sessionId);
  if (!joined) {
    console.error('failed to join distributed object session', sessionId);
    return;
  }

  // Mutate a field; change listeners on other devices will fire.
  source.age = 29;

  // off: unsubscribe the change handler once syncing is finished.
  obj.off('change', onChange);
}

async function run(): Promise<void> {
  try {
    await syncProfileAcrossDevices();
  } catch (e) {
    console.error('distributed profile sync failed', e);
  }
}

run();
