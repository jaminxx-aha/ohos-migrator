import Battery from '@system.battery';
import { BatteryResponse, GetStatusOptions } from '@system.battery';

/**
 * Reads the device battery status (charging state + level) using the legacy
 * @system.battery module. Wrapped in a small battery-service scenario.
 */
async function readBatteryStatus(): Promise<BatteryResponse | undefined> {
  return new Promise<BatteryResponse | undefined>((resolve) => {
    const options: GetStatusOptions = {};
    options.success = (data: BatteryResponse) => {
      const chargingLabel = data.charging ? 'charging' : 'on battery';
      const percent = Math.round(data.level * 100);
      console.info(`battery: ${percent}% (${chargingLabel})`);
      resolve(data);
    };
    options.fail = (data: string, code: number) => {
      console.error(`battery status failed: code=${code} data=${data}`);
      resolve(undefined);
    };
    options.complete = () => {
      console.info('battery status query completed');
    };
    Battery.getStatus(options);
  });
}

async function run(): Promise<void> {
  const status = await readBatteryStatus();
  if (status === undefined) {
    console.warn('could not retrieve battery status; falling back to defaults');
    return;
  }
  // Warn the user when the battery is low and not actively charging.
  if (!status.charging && status.level <= 0.15) {
    console.warn('low battery: please connect a charger');
  }
}

run();
