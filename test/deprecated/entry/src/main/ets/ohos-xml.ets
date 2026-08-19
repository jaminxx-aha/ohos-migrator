import xml from '@ohos.xml';
import util from '@ohos.util';

interface AppConfig {
  appName: string;
  version: string;
  permissions: string[];
}

// Parses an XML app-config document using the (deprecated) parse() API and
// collects the declared permissions into a structured config object.
function parseAppConfig(xmlText: string): AppConfig {
  const bytes: Uint8Array = new util.TextEncoder().encode(xmlText);
  const xmlBuf: ArrayBuffer = bytes.buffer as ArrayBuffer;
  const parser = new xml.XmlPullParser(xmlBuf, 'utf8');

  const config: AppConfig = { appName: '', version: '', permissions: [] };

  const options: xml.ParseOptions = {
    supportDoctype: false,
    ignoreNameSpace: true,
    tagValueCallbackFunction: (name: string, value: string): boolean => {
      if (name === 'app-name') {
        config.appName = value;
      } else if (name === 'version') {
        config.version = value;
      } else if (name === 'permission') {
        if (value) {
          config.permissions.push(value);
        }
      }
      return true;
    },
  };

  parser.parse(options);
  return config;
}

// Runs the end-to-end scenario: parse a sample manifest and report the result.
function run(): void {
  const sampleManifest =
    '<app><app-name>HarmonyDemo</app-name><version>2.1.0</version>' +
    '<permission>ohos.permission.INTERNET</permission>' +
    '<permission>ohos.permission.READ_MEDIA</permission></app>';

  try {
    const parsed = parseAppConfig(sampleManifest);
    console.info(
      `parsed config: ${parsed.appName} v${parsed.version}, ` +
      `permissions=${parsed.permissions.length}`
    );
  } catch (e) {
    console.error('failed to parse app config xml', e);
  }
}

run();
