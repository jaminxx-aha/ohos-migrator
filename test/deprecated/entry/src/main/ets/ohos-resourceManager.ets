import resourceManager from '@ohos.resourceManager';

// A reusable resource descriptor pointing at a string resource in the HAP.
const res: resourceManager.Resource = {
  bundleName: 'com.example.resourceshowcase',
  moduleName: 'entry',
  id: 0x01000001,
  params: [],
  type: 0
};

// A deprecated AsyncCallback wrapper, used to drive the callback-style
// deprecated overloads below so the compiler resolves those overloads.
function makeCallback<T>(resolve: (v: T) => void): resourceManager.AsyncCallback<T> {
  return (err: Error, data: T): void => {
    if (err) {
      console.error('resourceManager callback failed', err);
    } else {
      resolve(data);
    }
  };
}

// Shared system ResourceManager (deprecated itself), reused across scenarios so
// we touch getSystemResourceManager exactly once.
const sys: resourceManager.ResourceManager = resourceManager.getSystemResourceManager();

// Scenario 1: load localized strings, colors and config values for the about page.
async function loadAboutPageResources(): Promise<void> {

  // Synchronous deprecated lookups (by Resource).
  const appName: string = sys.getStringSync(res);
  const accentColor: number = sys.getColorSync(res);
  const featureFlag: boolean = sys.getBoolean(res);
  const versionCode: number = sys.getNumber(res);
  const symbolGlyph: number = sys.getSymbol(res);
  const taglineKeys: Array<string> = sys.getStringArrayValueSync(res);
  const pluralLabelSync: string = sys.getPluralStringByNameSync('items_count', 3);
  const intPluralSync: string = sys.getIntPluralStringValueSync(res, 3, 'screen');
  const doublePluralSync: string = sys.getDoublePluralStringValueSync(res, 3.5, 'distance');
  const mediaSync: Uint8Array = sys.getMediaContentSync(res, 0);
  const mediaBase64Sync: string = sys.getMediaContentBase64Sync(res, 0);
  console.info('about page', appName, accentColor, featureFlag, versionCode, symbolGlyph,
    taglineKeys.length, pluralLabelSync, intPluralSync, doublePluralSync,
    mediaSync.length, mediaBase64Sync.length);

  // Callback-style deprecated overloads.
  sys.getString(0x01000002, makeCallback<string>((s) => console.info('string by id', s)));
  sys.getStringArray(0x01000003, makeCallback<Array<string>>((a) => console.info('string array by id', a.length)));
  sys.getPluralString(0x01000004, 3, makeCallback<string>((s) => console.info('plural by id', s)));
  sys.getMedia(0x01000005, makeCallback<Uint8Array>((m) => console.info('media by id', m.length)));
  sys.getMediaBase64(0x01000006, makeCallback<string>((b) => console.info('media base64 by id', b.length)));
  sys.getPluralStringByName('items_count', 3, makeCallback<string>((s) => console.info('plural by name', s)));
  sys.getPluralStringValueSync(0x01000007, 3);
  sys.getColor(res, makeCallback<number>((c) => console.info('color', c)));
  sys.getStringValue(res, makeCallback<string>((s) => console.info('string value', s)));
  sys.getStringArrayValue(res, makeCallback<Array<string>>((a) => console.info('string array value', a.length)));
  sys.getMediaContent(res, makeCallback<Uint8Array>((m) => console.info('media content', m.length)));
  sys.getMediaContentBase64(res, makeCallback<string>((b) => console.info('media content base64', b.length)));
  sys.getPluralStringValue(res, 3, makeCallback<string>((s) => console.info('plural string value', s)));
  const drawable = sys.getDrawableDescriptor(res, 0, 0);
  console.info('drawable descriptor', drawable ? 'ok' : 'null');

  sys.release();
}

// Scenario 2: open and close a rawfile bundled with the HAP (e.g. a license text).
async function readRawLicenseFile(): Promise<void> {
  const path = 'rawfile/LICENSE.txt';

  sys.getRawFile(path, makeCallback<Uint8Array>((buf) => console.info('rawfile bytes', buf.length)));
  sys.getRawFileDescriptor(path, makeCallback<resourceManager.RawFileDescriptor>((fd) => {
    console.info('rawfile fd', fd.fd, fd.offset, fd.length);
    sys.closeRawFileDescriptor(path, makeCallback<void>(() => console.info('rawfile closed')));
  }));
}

async function run(): Promise<void> {
  try {
    await loadAboutPageResources();
    await readRawLicenseFile();
  } catch (e) {
    console.error('resource scenario failed', e);
  }
}

run();
