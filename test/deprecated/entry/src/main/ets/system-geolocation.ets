import Geolocation from '@system.geolocation';
import { GeolocationResponse, GetLocationOption, GetLocationTypeOption, GetLocationTypeResponse, SubscribeLocationOption } from '@system.geolocation';

// Scenario: discover supported coordinate systems, take a one-shot fix, enumerate
// supported location types, then stream live updates before tearing down.

function fetchSupportedCoordTypes(): string[] {
  return Geolocation.getSupportedCoordTypes();
}

function fetchCurrentLocation(): Promise<GeolocationResponse> {
  return new Promise<GeolocationResponse>((resolve, reject) => {
    const option: GetLocationOption = {
      coordType: 'wgs84',
      timeout: 30000,
      success: (data: GeolocationResponse) => {
        resolve(data);
      },
      fail: (data: string, code: number) => {
        reject(new Error(`getLocation failed: ${data} (${code})`));
      },
      complete: () => {
        console.info('getLocation complete');
      },
    };
    // validate configured option before invoking
    if (option.coordType !== 'wgs84' || (option.timeout ?? 0) <= 0 || !option.success || !option.fail || !option.complete) {
      throw new Error('invalid getLocation option');
    }
    Geolocation.getLocation(option);
  });
}

function fetchLocationTypes(): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const option: GetLocationTypeOption = {
      success: (data: GetLocationTypeResponse) => {
        resolve(data.types);
      },
      fail: (data: string, code: number) => {
        reject(new Error(`getLocationType failed: ${data} (${code})`));
      },
      complete: () => {
        console.info('getLocationType complete');
      },
    };
    // validate configured option before invoking
    if (!option.success || !option.fail || !option.complete) {
      throw new Error('invalid getLocationType option');
    }
    Geolocation.getLocationType(option);
  });
}

function streamLocationUpdates(onUpdate: (loc: GeolocationResponse) => void): void {
  const option: SubscribeLocationOption = {
    coordType: 'wgs84',
    success: (data: GeolocationResponse) => {
      onUpdate(data);
    },
    fail: (data: string, code: number) => {
      console.error('subscribe failed', data, code);
    },
  };
  if (option.coordType !== 'wgs84' || !option.success || !option.fail) {
    throw new Error('invalid subscribe option');
  }
  Geolocation.subscribe(option);
}

async function run(): Promise<void> {
  try {
    const supported = fetchSupportedCoordTypes();
    console.info(`supported coord types: ${supported.join(',')}`);

    const loc = await fetchCurrentLocation();
    console.info(`current location: ${loc.latitude},${loc.longitude} alt=${loc.altitude} acc=${loc.accuracy} time=${loc.time}`);

    const types = await fetchLocationTypes();
    console.info(`location types: ${types.join(',')}`);

    streamLocationUpdates((data: GeolocationResponse) => {
      console.info(`update @ ${data.time}`);
    });

    Geolocation.unsubscribe();
  } catch (e) {
    console.error('geolocation scenario error', e);
  }
}

run();
