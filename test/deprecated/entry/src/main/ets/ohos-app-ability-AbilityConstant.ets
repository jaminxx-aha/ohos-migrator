import AbilityConstant from '@ohos.app.ability.AbilityConstant';

// Inspect the last exit reason recorded for this ability and report whether
// the previous instance was killed for not responding.
async function reportLastExitReason(): Promise<void> {
  try {
    // In a real ability the value would come from launchParameters /
    // AbilityConstant.LaunchParam.lastExitReason. Compare against the legacy
    // ANR enum member still surfaced for back-compat diagnostics.
    const lastReason: AbilityConstant.LastExitReason =
      AbilityConstant.LastExitReason.ABILITY_NOT_RESPONDING;
    console.error(
      `Previous ability instance exit reason: ${lastReason} (ANR / not responding).`
    );
  } catch (e) {
    console.error('Failed to evaluate last exit reason', e);
  }
}

export async function run(): Promise<void> {
  await reportLastExitReason();
}

run();
