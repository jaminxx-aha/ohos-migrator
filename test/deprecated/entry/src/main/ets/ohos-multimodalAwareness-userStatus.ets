import userStatus from '@ohos.multimodalAwareness.userStatus';

// Scenario: a kid-mode gate that subscribes to age-group detection, classifies the
// current operator, acts on the result, then unsubscribes on cleanup.

const ageGroupDetectedType = 'userAgeGroupDetected';

function classifyAndAct(result: userStatus.UserClassification): void {
  // Touch the deprecated UserClassification fields.
  const ageGroup: userStatus.UserAgeGroup | undefined = result.ageGroup;
  const confidence: number | undefined = result.confidence;
  if (ageGroup === undefined || confidence === undefined) {
    return;
  }
  // Touch the deprecated UserAgeGroup enum and its members.
  if (ageGroup === userStatus.UserAgeGroup.CHILD) {
    console.info('child-mode: restricted content locked', confidence);
  } else if (ageGroup === userStatus.UserAgeGroup.OTHERS) {
    console.info('adult confirmed: full access granted', confidence);
  }
}

async function subscribeAgeGroupDetection(): Promise<void> {
  try {
    // Subscribe to age group detection events.
    userStatus.on(ageGroupDetectedType, (result: userStatus.UserClassification) => {
      try {
        classifyAndAct(result);
      } catch (e) {
        console.error('failed to handle age-group event', e);
      }
    });
  } catch (e) {
    console.error('subscribe userAgeGroupDetected failed', e);
  }
}

async function unsubscribeAgeGroupDetection(): Promise<void> {
  try {
    userStatus.off(ageGroupDetectedType);
  } catch (e) {
    console.error('unsubscribe userAgeGroupDetected failed', e);
  }
}

async function run(): Promise<void> {
  await subscribeAgeGroupDetection();
  // ... app runs, events are delivered to the callback above ...
  await unsubscribeAgeGroupDetection();
}

run();
