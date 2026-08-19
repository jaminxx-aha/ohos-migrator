import thermal from '@ohos.thermal';
import BusinessError from '@ohos.base';

// Thermal guard: a small module that turns the deprecated thermal API into a
// cohesive thermal-budget policy. It samples the current level, subscribes to
// level transitions, maps each level to a throttling decision, and exposes a
// clean subscribe/unsubscribe lifecycle so callers can attach teardown hooks.

interface ThermalBudget {
  level: thermal.ThermalLevel;
  /** Fraction of nominal duty cycle the workload is allowed to keep, 0..1. */
  dutyCycle: number;
  /** Whether background work should be paused entirely. */
  pauseBackground: boolean;
  /** Human-readable reason for the current decision. */
  reason: string;
}

type LevelListener = (budget: ThermalBudget) => void;

// Map a thermal level to a throttling budget. The thresholds mirror the
// platform's own thermal ladder so the host app can react before the OS kills
// it.
function budgetForLevel(level: thermal.ThermalLevel): ThermalBudget {
  switch (level) {
    case thermal.ThermalLevel.COOL:
    case thermal.ThermalLevel.NORMAL:
      return { level, dutyCycle: 1.0, pauseBackground: false, reason: 'nominal' };
    case thermal.ThermalLevel.WARM:
      return { level, dutyCycle: 0.75, pauseBackground: false, reason: 'reduce render rate' };
    case thermal.ThermalLevel.HOT:
      return { level, dutyCycle: 0.4, pauseBackground: true, reason: 'defer non-critical jobs' };
    case thermal.ThermalLevel.OVERHEATED:
      return { level, dutyCycle: 0.0, pauseBackground: true, reason: 'shutdown background work' };
    default:
      return { level, dutyCycle: 0.5, pauseBackground: false, reason: 'unknown level, conservative' };
  }
}

class ThermalGuard {
  private listeners: LevelListener[] = [];
  private registered = false;
  private lastBudget: ThermalBudget | null = null;

  /** Snapshot the current level and derive the budget without subscribing. */
  async sample(): Promise<ThermalBudget> {
    try {
      const level = thermal.getThermalLevel();
      const budget = budgetForLevel(level);
      this.lastBudget = budget;
      console.info(`thermal sample: level=${level} duty=${budget.dutyCycle} reason=${budget.reason}`);
      return budget;
    } catch (e) {
      console.error('failed to read thermal level', e);
      // Fail safe: assume warm so we throttle a little rather than overdrive.
      const fallback: ThermalBudget = {
        level: thermal.ThermalLevel.WARM,
        dutyCycle: 0.5,
        pauseBackground: false,
        reason: 'level read failed, assuming warm',
      };
      return fallback;
    }
  }

  /** Begin listening for level transitions. Idempotent. */
  async start(): Promise<void> {
    if (this.registered) {
      console.warn('thermal guard already subscribed');
      return;
    }
    try {
      const callback = (err: BusinessError, level: thermal.ThermalLevel) => {
        if (err) {
          console.error('thermal subscribe error', err);
          return;
        }
        const budget = budgetForLevel(level);
        this.lastBudget = budget;
        console.info(`thermal level changed: ${level} -> ${budget.reason}`);
        for (const listener of this.listeners) {
          try {
            listener(budget);
          } catch (le) {
            console.error('thermal listener threw', le);
          }
        }
      };
      thermal.subscribeThermalLevel(callback);
      this.registered = true;
      this.callback = callback;
    } catch (e) {
      console.error('thermal subscription failed', e);
      throw new Error((e as Error).message);
    }
  }

  private callback: ((err: BusinessError, level: thermal.ThermalLevel) => void) | null = null;

  /** Attach a caller-owned listener. Returns an unsubscribe handle. */
  onLevel(listener: LevelListener): () => void {
    this.listeners.push(listener);
    // Replay the latest budget so late subscribers converge quickly.
    if (this.lastBudget) {
      try {
        listener(this.lastBudget);
      } catch (e) {
        console.error('thermal replay listener threw', e);
      }
    }
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) {
        this.listeners.splice(i, 1);
      }
    };
  }

  /** Tear down the platform subscription and drop all listeners. */
  async stop(): Promise<void> {
    if (!this.registered || !this.callback) {
      this.listeners.length = 0;
      return;
    }
    try {
      thermal.unsubscribeThermalLevel();
    } catch (e) {
      console.error('thermal unsubscribe failed', e);
    } finally {
      this.registered = false;
      this.callback = null;
      this.listeners.length = 0;
    }
  }
}

// Module entrypoint: stand up the guard, sample, observe a transition window,
// then tear down cleanly so the process can exit without dangling callbacks.
async function run(): Promise<void> {
  const guard = new ThermalGuard();

  await guard.sample();

  await guard.start();
  const off = guard.onLevel(budget => {
    if (budget.pauseBackground) {
      console.warn(`pausing background work: ${budget.reason}`);
    } else if (budget.dutyCycle < 1.0) {
      console.info(`throttling workload to ${Math.round(budget.dutyCycle * 100)}%: ${budget.reason}`);
    }
  });

  try {
    // Let the subscription observe at least one polling window.
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
    const latest = await guard.sample();
    console.info(`post-window budget: ${latest.reason}`);
  } finally {
    off();
    await guard.stop();
  }
}

run().catch((e: Error) => {
  console.error('thermal guard run failed', e);
});
