import abilityDelegatorRegistry from '@ohos.application.abilityDelegatorRegistry';

// Scenario: enumerate the ability lifecycle states and obtain the delegator/args
// registered for the current test session.

type LifecycleState = abilityDelegatorRegistry.AbilityLifecycleState;

const STATE_LABELS: Map<LifecycleState, string> = new Map<LifecycleState, string>([
  [abilityDelegatorRegistry.AbilityLifecycleState.UNINITIALIZED, 'ability has not been initialized yet'],
  [abilityDelegatorRegistry.AbilityLifecycleState.CREATE, 'ability has just been created'],
  [abilityDelegatorRegistry.AbilityLifecycleState.FOREGROUND, 'ability is about to enter the foreground'],
  [abilityDelegatorRegistry.AbilityLifecycleState.BACKGROUND, 'ability is moving to the background'],
  [abilityDelegatorRegistry.AbilityLifecycleState.DESTROY, 'ability is being destroyed'],
]);

async function runDelegatorScenario(): Promise<void> {
  const delegator = abilityDelegatorRegistry.getAbilityDelegator();
  const args = abilityDelegatorRegistry.getArguments();

  const testCase: string = args.testCaseNames ?? '<unknown>';
  console.info(`Running delegator scenario for test case: ${testCase}`);

  STATE_LABELS.forEach((label: string, key: LifecycleState) => {
    try {
      const numericKey: number = key as number;
      console.info(`Lifecycle ${numericKey} -> ${label}`);
    } catch (e) {
      console.error('Failed to describe lifecycle state', e);
    }
  });

  try {
    console.info('Delegator and args retrieved; lifecycle states enumerated.');
  } catch (e) {
    console.error('Delegator scenario failed', e);
  }
}

runDelegatorScenario();
