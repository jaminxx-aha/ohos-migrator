import deviceInfo from '@ohos.deviceInfo';

/**
 * Collected device hardware metadata for analytics/telemetry reporting.
 */
interface DeviceProfile {
  deviceType: string;
  manufacture: string;
  brand: string;
  productModel: string;
  marketName: string;
  // Deprecated since 9; retained for legacy telemetry schema compatibility.
  hardwareProfile: string;
}

/**
 * Collects device hardware metadata for analytics/telemetry reporting.
 * Aggregates several non-deprecated deviceInfo fields plus the deprecated
 * hardwareProfile string for legacy report compatibility.
 */
function collectDeviceProfile(): DeviceProfile {
  const profile: DeviceProfile = {
    deviceType: deviceInfo.deviceType,
    manufacture: deviceInfo.manufacture,
    brand: deviceInfo.brand,
    productModel: deviceInfo.productModel,
    marketName: deviceInfo.marketName,
    hardwareProfile: deviceInfo.hardwareProfile,
  };
  return profile;
}

/**
 * Emits the collected profile to the diagnostic log.
 */
function logDeviceProfile(): void {
  const profile = collectDeviceProfile();
  console.info(`deviceProfile:deviceType=${profile.deviceType}`);
  console.info(`deviceProfile:manufacture=${profile.manufacture}`);
  console.info(`deviceProfile:brand=${profile.brand}`);
  console.info(`deviceProfile:productModel=${profile.productModel}`);
  console.info(`deviceProfile:marketName=${profile.marketName}`);
  console.info(`deviceProfile:hardwareProfile=${profile.hardwareProfile}`);
}

logDeviceProfile();
