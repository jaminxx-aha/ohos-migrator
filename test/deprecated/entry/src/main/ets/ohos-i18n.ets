import i18n from '@ohos.i18n';

// Inspects the unicode category of each character in a user-provided nickname,
// so the registration screen can reject names that mix scripts or contain digits.
async function analyzeNicknameCharacters(nickname: string): Promise<void> {
  const charInspector: i18n.Character = new i18n.Character();
  for (let i = 0; i < nickname.length; i++) {
    const ch = nickname.charAt(i);
    const type: string = charInspector.getType(ch);
    const isLetter: boolean = charInspector.isLetter(ch);
    const isDigit: boolean = charInspector.isDigit(ch);
    const isIdeograph: boolean = charInspector.isIdeograph(ch);
    const isLowerCase: boolean = charInspector.isLowerCase(ch);
    const isUpperCase: boolean = charInspector.isUpperCase(ch);
    const isSpace: boolean = charInspector.isSpaceChar(ch);
    const isWhitespace: boolean = charInspector.isWhitespace(ch);
    const isRtl: boolean = charInspector.isRTL(ch);
    console.info(`char='${ch}' type=${type} letter=${isLetter} digit=${isDigit} ` +
      `ideograph=${isIdeograph} lower=${isLowerCase} upper=${isUpperCase} ` +
      `space=${isSpace} whitespace=${isWhitespace} rtl=${isRtl}`);
  }
}

// Converts a product weight from kilograms to pounds for a cross-region store listing.
async function formatLocalizedUnits(): Promise<void> {
  const unitConverter: i18n.Util = {
    unitConvert: (fromUnit, toUnit, value, locale, style) =>
      i18n.I18NUtil.unitConvert(fromUnit, toUnit, value, locale, style)
  };
  const fromUnit: i18n.UnitInfo = { unit: 'kilogram', measureSystem: 'METRIC' };
  const toUnit: i18n.UnitInfo = { unit: 'pound', measureSystem: 'US' };
  try {
    const formatted: string = unitConverter.unitConvert(fromUnit, toUnit, 2.5, 'en-US', 'long');
    console.info(`Converted weight: ${formatted}`);
  } catch (e) {
    console.error('Unit conversion failed', e);
  }
}

// Reads the device's current locale, language, region and clock format so the
// onboarding screen can mirror them in its UI. Also toggles the 24-hour clock.
async function inspectDeviceLocale(): Promise<void> {
  try {
    const systemLocale: string = i18n.System.getSystemLocale();
    const systemLanguage: string = i18n.getSystemLanguage();
    const systemRegion: string = i18n.getSystemRegion();
    const legacySystemLocale: string = i18n.getSystemLocale();
    const using24Hour: boolean = i18n.is24HourClock();
    console.info(`locale=${systemLocale} language=${systemLanguage} region=${systemRegion} 24h=${using24Hour}`);

    const displayCountry: string = i18n.getDisplayCountry('US', systemLocale, true);
    const displayLanguage: string = i18n.getDisplayLanguage('zh', systemLocale, true);
    console.info(`Display country: ${displayCountry}, display language: ${displayLanguage}`);

    const switched: boolean = i18n.set24HourClock(true);
    console.info(`set24HourClock(true) -> ${switched}`);
  } catch (e) {
    console.error('Failed to inspect device locale', e);
  }
}

// Manages the user's preferred-language list when they pick a new app language
// in settings, then reads back the resulting preference order.
async function managePreferredLanguages(newLanguage: string): Promise<void> {
  try {
    const added: boolean = i18n.addPreferredLanguage(newLanguage, 0);
    if (!added) {
      console.warn(`Failed to add preferred language: ${newLanguage}`);
    }
    const preferredList: Array<string> = i18n.getPreferredLanguageList();
    const firstPreferred: string = i18n.getFirstPreferredLanguage();
    console.info(`First preferred: ${firstPreferred}, full list: ${preferredList.join(', ')}`);

    if (preferredList.length > 3) {
      const removed: boolean = i18n.removePreferredLanguage(preferredList.length - 1);
      console.info(`Removed trailing preferred language: ${removed}`);
    }
  } catch (e) {
    console.error('Failed to manage preferred languages', e);
  }
}

// Builds localized date and number formatters for a receipts screen using both
// pattern- and skeleton-based factories.
async function buildReceiptFormatters(locale: string): Promise<void> {
  try {
    const patternFormatter: i18n.SimpleDateTimeFormat =
      i18n.getSimpleDateTimeFormatByPattern('yyyy-MM-dd HH:mm', new Intl.Locale(locale));
    const skeletonFormatter: i18n.SimpleDateTimeFormat =
      i18n.getSimpleDateTimeFormatBySkeleton('yMMMd', new Intl.Locale(locale));
    const numberFormatter: i18n.SimpleNumberFormat =
      i18n.getSimpleNumberFormatBySkeleton('currency/CNY', new Intl.Locale(locale));
    console.info(`Built formatters: pattern=${typeof patternFormatter} ` +
      `skeleton=${typeof skeletonFormatter} number=${typeof numberFormatter}`);
  } catch (e) {
    console.error('Failed to build receipt formatters', e);
  }
}

// Wraps a localized file path so RTL segments render in the correct display order.
async function wrapLocalizedFilePath(rawPath: string, locale: string): Promise<void> {
  try {
    const wrapped: string =
      i18n.I18NUtil.getUnicodeWrappedFilePath(rawPath, '/', new Intl.Locale(locale));
    console.info(`Wrapped file path: ${wrapped}`);
  } catch (e) {
    console.error('Failed to wrap file path', e);
  }
}

async function run(): Promise<void> {
  await analyzeNicknameCharacters('Alice_测试123');
  await formatLocalizedUnits();
  await inspectDeviceLocale();
  await managePreferredLanguages('zh-Hans-CN');
  await buildReceiptFormatters('zh-Hans-CN');
  await wrapLocalizedFilePath('res/zh-Hans-CN/images/封面.png', 'zh-Hans-CN');
}

run();
