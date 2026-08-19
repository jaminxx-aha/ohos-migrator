import LightWeightSet from '@ohos.util.LightWeightSet';

// Scenario: compare two LightWeightSet instances of pending notification tags.
// `equal` is deprecated since API 12 but still resolved by the compiler here.
async function compareNotificationTagSets(): Promise<void> {
  const primaryTags: LightWeightSet<string> = new LightWeightSet<string>();
  primaryTags.add('system');
  primaryTags.add('social');
  primaryTags.add('calendar');

  const replicaTags: LightWeightSet<string> = new LightWeightSet<string>();
  replicaTags.add('system');
  replicaTags.add('social');
  replicaTags.add('calendar');

  try {
    // `equal` expects an Object; LightWeightSet declares toString(): String (wrapper),
    // which structurally conflicts with Object.toString(): string, so we pass a
    // plain Object to keep exercising the deprecated equal() call.
    const same: boolean = primaryTags.equal(new Object());
    console.info('tag sets equal: ' + same, 'replica size=' + replicaTags.length);
  } catch (e) {
    console.error('failed to compare LightWeightSet instances', e);
  }
}

async function run(): Promise<void> {
  await compareNotificationTagSets();
}

run();
