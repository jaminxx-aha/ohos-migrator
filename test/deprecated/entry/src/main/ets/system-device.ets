import Device from '@system.device';
import { DeviceResponse, GetDeviceOptions } from '@system.device';

interface DeviceProfile {
  apiVersion: number;
  brand: string;
  manufacturer: string;
  model: string;
  product: string;
  deviceType: string;
  language: string;
  region: string;
}

// Scenario 1: collect a device profile for analytics, using @system.device.getInfo.
async function collectDeviceProfile(): Promise<DeviceResponse> {
  return new Promise<DeviceResponse>((resolve, reject) => {
    const options: GetDeviceOptions = {};
    options.success = (data: DeviceResponse) => {
      const profile: DeviceProfile = {
        apiVersion: data.apiVersion,
        brand: data.brand,
        manufacturer: data.manufacturer,
        model: data.model,
        product: data.product,
        deviceType: data.deviceType,
        language: data.language,
        region: data.region,
      };
      console.info('device profile: ' + JSON.stringify(profile));
      resolve(data);
    };
    options.fail = (data: Object, code: number) => {
      console.error('device.getInfo failed', code, data);
      reject(new Error('device.getInfo failed: ' + code));
    };
    options.complete = () => {
      console.info('device.getInfo request finalized');
    };
    Device.getInfo(options);
  });
}

// Scenario 2: adapt UI layout to the device screen geometry.
function applyResponsiveLayout(data: DeviceResponse): void {
  const density: number = data.screenDensity;
  const shape: 'rect' | 'circle' = data.screenShape;
  const width: number = data.windowWidth;
  const height: number = data.windowHeight;
  const ratio = width / height;
  console.info(`layout: ${width}x${height} density=${density} shape=${shape} ratio=${ratio}`);
}

async function run(): Promise<void> {
  try {
    const info = await collectDeviceProfile();
    applyResponsiveLayout(info);
  } catch (e) {
    console.error('device scenario failed', e);
  }
}

run();
