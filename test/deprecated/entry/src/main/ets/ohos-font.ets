import font from '@ohos.font';

// Scenario: register a custom brand font at startup and inspect the system's font catalog.

function registerBrandFont(): void {
  // Register a custom TTF shipped with the app under the "rawfile" assets dir.
  const brandFontOptions: font.FontOptions = {
    familyName: 'BrandSans',
    familySrc: '/rawfile/fonts/brand_sans_regular.ttf',
  };
  font.registerFont(brandFontOptions);
}

function listSystemFonts(): string[] {
  // Discover the system-provided font families so the UI can render a picker.
  const systemFonts: string[] = font.getSystemFontList();
  return systemFonts;
}

function lookupBrandFontDetails(familyName: string): font.FontInfo {
  // Resolve metadata (path, weight, etc.) for a known family name.
  const info: font.FontInfo = font.getFontByName(familyName);
  return info;
}

function run(): void {
  try {
    registerBrandFont();
    const available = listSystemFonts();
    console.info('system font count: ' + available.length);
    const detail = lookupBrandFontDetails(available.length > 0 ? available[0] : 'BrandSans');
    console.info('resolved font path: ' + detail.path);
  } catch (e) {
    console.error('font initialization failed', e);
  }
}

run();
