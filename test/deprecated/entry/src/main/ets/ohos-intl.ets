import intl from '@ohos.intl';

// Scenario: build a localized activity-log timestamp for the device locale, exercising
// every deprecated DateTimeOptions field plus DateTimeFormat.format / formatRange / resolvedOptions.
async function formatActivityLogTimestamp(): Promise<void> {
  const options: intl.DateTimeOptions = {
    locale: 'zh-Hans-CN',
    dateStyle: 'long',
    timeStyle: 'medium',
    hourCycle: 'h23',
    timeZone: 'Asia/Shanghai',
    numberingSystem: 'latn',
    hour12: false,
    weekday: 'long',
    era: 'short',
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'long',
    dayPeriod: 'short',
    localeMatcher: 'best fit',
    formatMatcher: 'basic',
  };
  // Read each deprecated DateTimeOptions field so the compiler resolves every property symbol.
  const summary: string = [
    options.locale, options.dateStyle, options.timeStyle, options.hourCycle,
    options.timeZone, options.numberingSystem, String(options.hour12), options.weekday,
    options.era, options.year, options.month, options.day, options.hour,
    options.minute, options.second, options.timeZoneName, options.dayPeriod,
    options.localeMatcher, options.formatMatcher,
  ].join('|');
  console.info('activity options:', summary);

  const formatter = new intl.DateTimeFormat('zh-Hans-CN', options);
  const startedAt = new Date(2026, 4, 17, 9, 30, 0);
  const endedAt = new Date(2026, 4, 17, 11, 0, 0);
  try {
    const stamp = formatter.format(startedAt);
    console.info('activity timestamp:', stamp);
    const window = formatter.formatRange(startedAt, endedAt);
    console.info('activity window:', window);
    const resolved = formatter.resolvedOptions();
    console.info('resolved:', resolved.locale, resolved.dateStyle, resolved.timeZone);
  } catch (e) {
    console.error('formatActivityLogTimestamp failed', e);
  }
}

// Scenario: resolve the device locale, exercising every deprecated LocaleOptions field and
// every deprecated Locale property / method.
async function resolveDeviceLocale(): Promise<void> {
  const localeOptions: intl.LocaleOptions = {
    calendar: 'gregory',
    collation: 'pinyin',
    hourCycle: 'h24',
    numberingSystem: 'latn',
    numeric: true,
    caseFirst: 'upper',
  };
  const optsDigest: string = [
    localeOptions.calendar, localeOptions.collation, localeOptions.hourCycle,
    localeOptions.numberingSystem, String(localeOptions.numeric), localeOptions.caseFirst,
  ].join('|');
  console.info('locale options:', optsDigest);

  const locale = new intl.Locale('zh-Hans-CN', localeOptions);
  try {
    const portrait: string = [
      locale.baseName, locale.language, locale.script, locale.region,
      locale.calendar, locale.collation, locale.caseFirst, locale.hourCycle,
      locale.numberingSystem, String(locale.numeric),
    ].join('|');
    console.info('locale portrait:', portrait);
    console.info('locale toString:', locale.toString());
    const maximized = locale.maximize();
    const minimized = locale.minimize();
    console.info('maximized:', maximized.toString(), 'minimized:', minimized.toString());
  } catch (e) {
    console.error('resolveDeviceLocale failed', e);
  }
}

// Scenario: render a localized countdown for a notification, exercising every deprecated
// RelativeTimeFormatInputOptions and RelativeTimeFormatResolvedOptions field.
async function formatNotificationCountdown(): Promise<void> {
  const inputOptions: intl.RelativeTimeFormatInputOptions = {
    localeMatcher: 'best fit',
    numeric: 'auto',
    style: 'long',
  };
  console.info('countdown input options:',
    inputOptions.localeMatcher, inputOptions.numeric, inputOptions.style);

  const relTime = new intl.RelativeTimeFormat('zh-Hans-CN', inputOptions);
  try {
    const phrase = relTime.format(-3, 'day');
    console.info('countdown phrase:', phrase);
    const parts = relTime.formatToParts(2, 'hour');
    console.info('countdown parts:', JSON.stringify(parts));
    const resolved: intl.RelativeTimeFormatResolvedOptions = relTime.resolvedOptions();
    console.info('countdown resolved:',
      resolved.locale, resolved.style, resolved.numeric, resolved.numberingSystem);
  } catch (e) {
    console.error('formatNotificationCountdown failed', e);
  }
}

// Scenario: pick a pluralized label for a badge count, exercising every deprecated
// PluralRulesOptions field plus PluralRules.select.
async function pickPluralLabel(): Promise<void> {
  const pluralOptions: intl.PluralRulesOptions = {
    localeMatcher: 'best fit',
    type: 'cardinal',
    minimumIntegerDigits: 1,
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
    minimumSignificantDigits: 1,
    maximumSignificantDigits: 21,
  };
  console.info('plural options:',
    pluralOptions.localeMatcher, pluralOptions.type, pluralOptions.minimumIntegerDigits,
    pluralOptions.minimumFractionDigits, pluralOptions.maximumFractionDigits,
    pluralOptions.minimumSignificantDigits, pluralOptions.maximumSignificantDigits);

  const rules = new intl.PluralRules('en-US', pluralOptions);
  try {
    const category = rules.select(1);
    console.info('badge plural category:', category);
    console.info('badge plural for 0:', rules.select(0));
  } catch (e) {
    console.error('pickPluralLabel failed', e);
  }
}

async function run(): Promise<void> {
  await formatActivityLogTimestamp();
  await resolveDeviceLocale();
  await formatNotificationCountdown();
  await pickPluralLabel();
}

run();
