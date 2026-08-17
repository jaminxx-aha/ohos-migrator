import deviceInfo from '@ohos.deviceInfo';

/**
 * Collects device hardware metadata for analytics/telemetry reporting.
 * Aggregates several non-deprecated deviceInfo fields plus the deprecated
 * hardwareProfile string for legacy report compatibility.
 */
function collectDeviceProfile(): Record<string, string> {
  const profile: Record<string, string> = {
    deviceType: deviceInfo.deviceType,
    manufacture: deviceInfo.manufacture,
    brand: deviceInfo.brand,
    productModel: deviceInfo.productModel,
    marketName: deviceInfo.marketName,
    // Deprecated since 9; retained for legacy telemetry schema compatibility.
    hardwareProfile: deviceInfo.hardwareProfile,
  };
  return profile;
}

/**
 * Emits the collected profile to the diagnostic log.
 */
function logDeviceProfile(): void {
  const profile = collectDeviceProfile();
  for (const key of Object.keys(profile)) {
    console.info(`deviceProfile:${key}=${profile[key]}`);
  }
}

logDeviceProfile();
