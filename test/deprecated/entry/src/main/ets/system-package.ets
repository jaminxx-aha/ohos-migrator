import Package from '@system.package';
import { CheckPackageHasInstalledOptions, CheckPackageHasInstalledResponse } from '@system.package';

// Scenario: check whether a companion native app is installed before deeplinking into it.
async function checkCompanionAppInstalled(bundleName: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const options: CheckPackageHasInstalledOptions = {
      bundleName: bundleName,
      success: (data: CheckPackageHasInstalledResponse) => {
        const installed: boolean = data.result;
        console.info(`companion app ${bundleName} installed=${installed}`);
        resolve(installed);
      },
      fail: (data: Object, code: number) => {
        console.error(`hasInstalled failed bundle=${bundleName} code=${code}`, data);
        resolve(false);
      },
      complete: () => {
        console.info(`hasInstalled check finished for ${bundleName}`);
      },
    };
    // Exercise deprecated option/response fields directly so the compiler records each usage.
    const bn: string = options.bundleName;
    const successCb = options.success;
    const failCb = options.fail;
    const completeCb = options.complete;
    console.info(`probe options bundle=${bn} hasSuccess=${successCb != null} hasFail=${failCb != null} hasComplete=${completeCb != null}`);
    Package.hasInstalled(options);
  });
}

async function run(): Promise<void> {
  const bundle = 'com.example.companionapp';
  const installed = await checkCompanionAppInstalled(bundle);
  if (!installed) {
    console.warn(`companion app ${bundle} not present, falling back to in-app flow`);
  }
}

run();
