import geolocation from '@ohos.geolocation';

// Maps a deprecated location error code to a human-readable label, exercising every
// GeoLocationErrorCode enum member.
function describeError(code: geolocation.GeoLocationErrorCode): string {
  switch (code) {
    case geolocation.GeoLocationErrorCode.INPUT_PARAMS_ERROR:
      return 'invalid input parameters';
    case geolocation.GeoLocationErrorCode.LOCATION_REQUEST_TIMEOUT_ERROR:
      return 'location request timed out';
    case geolocation.GeoLocationErrorCode.LAST_KNOWN_LOCATION_ERROR:
      return 'last known location unavailable';
    case geolocation.GeoLocationErrorCode.LOCATION_SWITCH_ERROR:
      return 'location switch error';
    case geolocation.GeoLocationErrorCode.LOCATOR_ERROR:
      return 'locator internal error';
    case geolocation.GeoLocationErrorCode.REVERSE_GEOCODE_ERROR:
      return 'reverse geocoding failed';
    case geolocation.GeoLocationErrorCode.GEOCODE_ERROR:
      return 'geocoding failed';
    default:
      return 'unknown error';
  }
}

// Pretty-print every deprecated priority / scenario enum so each member is referenced.
function describePriority(priority: geolocation.LocationRequestPriority): string {
  switch (priority) {
    case geolocation.LocationRequestPriority.UNSET:
      return 'unset';
    case geolocation.LocationRequestPriority.ACCURACY:
      return 'accuracy-first';
    case geolocation.LocationRequestPriority.LOW_POWER:
      return 'low-power';
    case geolocation.LocationRequestPriority.FIRST_FIX:
      return 'first-fix';
    default:
      return 'custom';
  }
}

function describeScenario(scenario: geolocation.LocationRequestScenario): string {
  switch (scenario) {
    case geolocation.LocationRequestScenario.UNSET:
      return 'unset';
    case geolocation.LocationRequestScenario.NAVIGATION:
      return 'navigation';
    case geolocation.LocationRequestScenario.TRAJECTORY_TRACKING:
      return 'trajectory tracking';
    case geolocation.LocationRequestScenario.CAR_HAILING:
      return 'car hailing';
    case geolocation.LocationRequestScenario.DAILY_LIFE_SERVICE:
      return 'daily life service';
    case geolocation.LocationRequestScenario.NO_POWER:
      return 'no power';
    default:
      return 'custom';
  }
}

// Audit which location privacy types the user has granted. Iterating the enum members
// keeps a reference to each deprecated LocationPrivacyType value.
function listPrivacyTypes(): geolocation.LocationPrivacyType[] {
  return [
    geolocation.LocationPrivacyType.CORE_LOCATION,
    geolocation.LocationPrivacyType.STARTUP,
    geolocation.LocationPrivacyType.OTHERS,
  ];
}

// Build a request for the periodic cached-GNSS reporting callback.
function buildCachedGnssRequest(): geolocation.CachedGnssLocationsRequest {
  const req: geolocation.CachedGnssLocationsRequest = {
    reportingPeriodSec: 60,
    wakeUpCacheQueueFull: true,
  };
  console.debug(`cachedGnss: period=${req.reportingPeriodSec}s, wakeOnFull=${req.wakeUpCacheQueueFull}`);
  return req;
}

// Build a one-shot "where am I now" request for navigation.
function buildCurrentLocationRequest(): geolocation.CurrentLocationRequest {
  const req: geolocation.CurrentLocationRequest = {
    scenario: geolocation.LocationRequestScenario.NAVIGATION,
    priority: geolocation.LocationRequestPriority.ACCURACY,
    maxAccuracy: 10,
    timeoutMs: 15000,
  };
  console.debug(
    `currentLocation: scenario=${req.scenario}, priority=${req.priority}, ` +
      `maxAccuracy=${req.maxAccuracy}m, timeout=${req.timeoutMs}ms`
  );
  return req;
}

// Build a continuous-location request used when registering for `locationChange`.
function buildLocationRequest(): geolocation.LocationRequest {
  const req: geolocation.LocationRequest = {
    scenario: geolocation.LocationRequestScenario.TRAJECTORY_TRACKING,
    priority: geolocation.LocationRequestPriority.LOW_POWER,
    timeInterval: 5,
    distanceInterval: 10,
    maxAccuracy: 20,
  };
  return req;
}

// Build a reverse-geocode request (coordinate -> address).
function buildReverseGeoCodeRequest(latitude: number, longitude: number): geolocation.ReverseGeoCodeRequest {
  const req: geolocation.ReverseGeoCodeRequest = {
    latitude,
    longitude,
    maxItems: 5,
    locale: 'zh_CN',
  };
  console.debug(`reverseGeocode: (${req.latitude},${req.longitude}), locale=${req.locale}, maxItems=${req.maxItems}`);
  return req;
}

// Build a forward-geocode request (description -> coordinates) bounded by a viewport.
function buildGeoCodeRequest(): geolocation.GeoCodeRequest {
  const req: geolocation.GeoCodeRequest = {
    description: '北京市朝阳区望京SOHO',
    maxItems: 5,
    locale: 'zh_CN',
    minLatitude: 39.8,
    minLongitude: 116.3,
    maxLatitude: 40.0,
    maxLongitude: 116.5,
  };
  console.debug(
    `geoCode: desc="${req.description}", locale=${req.locale}, maxItems=${req.maxItems}, ` +
      `viewport=[${req.minLatitude},${req.minLongitude} -> ${req.maxLatitude},${req.maxLongitude}]`
  );
  return req;
}

// Build a circular geofence around a point of interest.
function buildGeofence(): geolocation.Geofence {
  const fence: geolocation.Geofence = {
    latitude: 39.9928,
    longitude: 116.4736,
    radius: 500,
    expiration: 3600_000,
  };
  return fence;
}

function buildGeofenceRequest(): geolocation.GeofenceRequest {
  const req: geolocation.GeofenceRequest = {
    priority: geolocation.LocationRequestPriority.ACCURACY,
    scenario: geolocation.LocationRequestScenario.DAILY_LIFE_SERVICE,
    geofence: buildGeofence(),
  };
  return req;
}

// Build a command to push to the location subsystem (e.g. tweak GNSS reporting).
function buildLocationCommand(): geolocation.LocationCommand {
  const cmd: geolocation.LocationCommand = {
    scenario: geolocation.LocationRequestScenario.NO_POWER,
    command: 'SCENE_NAVIGATION',
  };
  return cmd;
}

// Print every field of a resolved GeoAddress (forward/reverse geocode result).
function describeGeoAddress(addr: geolocation.GeoAddress): string {
  return [
    `place=${addr.placeName}`,
    `locality=${addr.locality}`,
    `subLocality=${addr.subLocality}`,
    `adminArea=${addr.administrativeArea}`,
    `subAdminArea=${addr.subAdministrativeArea}`,
    `country=${addr.countryName}(${addr.countryCode})`,
    `postal=${addr.postalCode}`,
    `road=${addr.roadName}`,
    `subRoad=${addr.subRoadName}`,
    `premises=${addr.premises}`,
    `phone=${addr.phoneNumber}`,
    `url=${addr.addressUrl}`,
    `locale=${addr.locale}`,
    `descSize=${addr.descriptionsSize}`,
    `descriptions=${addr.descriptions ? addr.descriptions.join(';') : ''}`,
    `lat=${addr.latitude}`,
    `lon=${addr.longitude}`,
  ].join(', ');
}

// Print every field of a Location fix so every deprecated Location property is read.
function describeLocation(loc: geolocation.Location): string {
  return [
    `lat=${loc.latitude}`,
    `lon=${loc.longitude}`,
    `alt=${loc.altitude}`,
    `accuracy=${loc.accuracy}`,
    `speed=${loc.speed}`,
    `direction=${loc.direction}`,
    `timeStamp=${loc.timeStamp}`,
    `boot=${loc.timeSinceBoot}`,
    `addSize=${loc.additionSize}`,
    `additions=${loc.additions ? loc.additions.join(';') : ''}`,
  ].join(', ');
}

// Inspect every field of a SatelliteStatusInfo snapshot reported by `gnssStatusChange`.
function describeSatelliteStatus(info: geolocation.SatelliteStatusInfo): string {
  return [
    `satellites=${info.satellitesNumber}`,
    `ids=${info.satelliteIds ? info.satelliteIds.join(',') : ''}`,
    `altitudes=${info.altitudes ? info.altitudes.join(',') : ''}`,
    `azimuths=${info.azimuths ? info.azimuths.join(',') : ''}`,
    `carrierFreq=${info.carrierFrequencies ? info.carrierFrequencies.join(',') : ''}`,
    `cn0=${info.carrierToNoiseDensitys ? info.carrierToNoiseDensitys.join(',') : ''}`,
  ].join(', ');
}

// Scenario 1: make sure the location switch is on before anything else.
async function ensureLocationEnabled(): Promise<boolean> {
  try {
    const alreadyOn: boolean = await geolocation.isLocationEnabled();
    if (alreadyOn) {
      return true;
    }
    const granted: boolean = await geolocation.requestEnableLocation();
    return granted;
  } catch (e) {
    console.error('ensureLocationEnabled failed', e);
    return false;
  }
}

// Scenario 2: query whether the device supports geo services, then fetch the current fix.
async function fetchCurrentLocation(): Promise<void> {
  try {
    const available: boolean = await geolocation.isGeoServiceAvailable();
    if (!available) {
      console.error('geo service unavailable on this device');
      return;
    }
    const request: geolocation.CurrentLocationRequest = buildCurrentLocationRequest();
    const location: geolocation.Location = await geolocation.getCurrentLocation(request);
    console.info('current location: ' + describeLocation(location));
  } catch (e) {
    console.error('fetchCurrentLocation failed', e);
  }
}

// Scenario 3: read the last known fix (cheap, no fresh GNSS acquisition).
async function fetchLastKnownLocation(): Promise<void> {
  try {
    const last: geolocation.Location = await geolocation.getLastLocation();
    console.info('last known location: ' + describeLocation(last));
  } catch (e) {
    console.error('fetchLastKnownLocation failed', e);
  }
}

// Scenario 4: reverse-geocode the last known coordinate into a street address.
async function reverseGeocode(latitude: number, longitude: number): Promise<void> {
  try {
    const request: geolocation.ReverseGeoCodeRequest = buildReverseGeoCodeRequest(latitude, longitude);
    const addresses: Array<geolocation.GeoAddress> = await geolocation.getAddressesFromLocation(request);
    if (addresses.length === 0) {
      console.info('no reverse-geocoded addresses found');
      return;
    }
    console.info('reverse geocode: ' + describeGeoAddress(addresses[0]));
  } catch (e) {
    console.error('reverseGeocode failed', e);
  }
}

// Scenario 5: forward-geocode a place description into candidate coordinates.
async function forwardGeocode(): Promise<void> {
  try {
    const request: geolocation.GeoCodeRequest = buildGeoCodeRequest();
    const addresses: Array<geolocation.GeoAddress> = await geolocation.getAddressesFromLocationName(request);
    for (const addr of addresses) {
      console.info('forward geocode: ' + describeGeoAddress(addr));
    }
  } catch (e) {
    console.error('forwardGeocode failed', e);
  }
}

// Scenario 6: drain the cached-GNSS buffer and report its size before flushing.
async function drainCachedGnssLocations(): Promise<void> {
  try {
    const cachedRequest: geolocation.CachedGnssLocationsRequest = buildCachedGnssRequest();
    void cachedRequest; // request reserved for a future on('cachedGnssLocationsReporting', ...)
    const size: number = await geolocation.getCachedGnssLocationsSize();
    console.info(`cached GNSS locations pending: ${size}`);
    if (size > 0) {
      const flushed: boolean = await geolocation.flushCachedGnssLocations();
      console.info(`flushed cached GNSS locations: ${flushed}`);
    }
  } catch (e) {
    console.error('drainCachedGnssLocations failed', e);
  }
}

// Scenario 7: push a scene command to the location subsystem (e.g. force NAVIGATION).
async function pushLocationCommand(): Promise<void> {
  try {
    const command: geolocation.LocationCommand = buildLocationCommand();
    const ok: boolean = await geolocation.sendCommand(command);
    console.info(`sendCommand(${command.command}, scenario=${describeScenario(command.scenario)}) -> ${ok}`);
  } catch (e) {
    console.error('pushLocationCommand failed', e);
  }
}

// Scenario 8: register for locationServiceState notifications and tear down after.
function registerServiceStateListener(): void {
  const handle = (enabled: boolean) => {
    console.info(`location service state changed: enabled=${enabled}`);
  };
  geolocation.on('locationServiceState', handle);
  // ... later, when the screen is torn down ...
  geolocation.off('locationServiceState', handle);
}

// Scenario 9: build geofence / continuous-location request objects (the deprecated
// module exposes no function that consumes a GeofenceRequest directly, so we just
// construct and validate them here for downstream WantAgent consumers).
function prepareGeofenceAndTrackingRequests(): void {
  const fenceReq: geolocation.GeofenceRequest = buildGeofenceRequest();
  const trackReq: geolocation.LocationRequest = buildLocationRequest();
  console.info(
    'geofence: ' +
      `center=(${fenceReq.geofence.latitude},${fenceReq.geofence.longitude}),` +
      `radius=${fenceReq.geofence.radius},expiration=${fenceReq.geofence.expiration},` +
      `priority=${describePriority(fenceReq.priority)},scenario=${describeScenario(fenceReq.scenario)}`
  );
  console.info(
    'tracking: ' +
      `interval=${trackReq.timeInterval}s/${trackReq.distanceInterval}m,` +
      `maxAccuracy=${trackReq.maxAccuracy},priority=${describePriority(trackReq.priority)},` +
      `scenario=${describeScenario(trackReq.scenario)}`
  );
}

// Scenario 10: surface privacy types and a synthetic satellite snapshot for diagnostics.
function reportDiagnostics(): void {
  const privacyTypes: geolocation.LocationPrivacyType[] = listPrivacyTypes();
  console.info(`privacy types granted: ${privacyTypes.length}`);
  const satelliteSnapshot: geolocation.SatelliteStatusInfo = {
    satellitesNumber: 12,
    satelliteIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    altitudes: [23000000, 23100000, 23200000, 23300000, 23400000, 23500000, 23600000, 23700000, 23800000, 23900000, 24000000, 24100000],
    azimuths: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
    carrierFrequencies: [1575.42, 1575.42, 1575.42, 1575.42, 1575.42, 1575.42, 1575.42, 1575.42, 1575.42, 1575.42, 1575.42, 1575.42],
    carrierToNoiseDensitys: [40, 41, 42, 43, 44, 45, 38, 37, 36, 35, 39, 41],
  };
  console.info('satellite status: ' + describeSatelliteStatus(satelliteSnapshot));
}

async function run(): Promise<void> {
  reportDiagnostics();
  prepareGeofenceAndTrackingRequests();
  registerServiceStateListener();
  const ok: boolean = await ensureLocationEnabled();
  if (!ok) {
    console.error('location remains disabled; aborting scenario');
    describeError(geolocation.GeoLocationErrorCode.LOCATION_SWITCH_ERROR);
    return;
  }
  await fetchCurrentLocation();
  await fetchLastKnownLocation();
  try {
    const last: geolocation.Location = await geolocation.getLastLocation();
    await reverseGeocode(last.latitude, last.longitude);
  } catch (e) {
    console.error('reverse geocode precondition failed', e);
    describeError(geolocation.GeoLocationErrorCode.LAST_KNOWN_LOCATION_ERROR);
  }
  await forwardGeocode();
  await drainCachedGnssLocations();
  await pushLocationCommand();
}

run();
