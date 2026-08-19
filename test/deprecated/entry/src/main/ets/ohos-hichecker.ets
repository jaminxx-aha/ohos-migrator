import hichecker from '@ohos.hichecker';

// Scenario: configure runtime caution rules for a long-running ability, verify they are
// active while it runs, then tear them down on cleanup.

const ALL_RULES: bigint =
  hichecker.RULE_CAUTION_PRINT_LOG |
  hichecker.RULE_CAUTION_TRIGGER_CRASH |
  hichecker.RULE_CHECK_ABILITY_CONNECTION_LEAK;
const LEAK_RULE: bigint = hichecker.RULE_CHECK_ABILITY_CONNECTION_LEAK;

function enableDiagnosticsRules(): void {
  // Arm log + crash caution rules together with the ability-connection-leak check
  // before entering the hot path of the ability.
  hichecker.addRule(ALL_RULES);
}

function verifyRulesActive(): boolean {
  // Confirm the leak rule (the one we selectively revoke later) is armed before dispatching work.
  return hichecker.contains(LEAK_RULE);
}

function teardownDiagnosticsRules(): void {
  // Tear down every armed rule on cleanup.
  hichecker.removeRule(ALL_RULES);
}

async function runAbilityWithDiagnostics(): Promise<void> {
  try {
    enableDiagnosticsRules();
    const armed = verifyRulesActive();
    if (!armed) {
      console.error('hichecker: expected rules not armed, aborting ability dispatch');
      return;
    }
    // ... ability work would run here ...
  } catch (e) {
    console.error('hichecker: diagnostics setup failed', e);
  } finally {
    try {
      teardownDiagnosticsRules();
    } catch (e) {
      console.error('hichecker: teardown failed', e);
    }
  }
}

runAbilityWithDiagnostics();
