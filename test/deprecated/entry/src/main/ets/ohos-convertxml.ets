import xml from '@ohos.convertxml';

// Scenario: parse an XML configuration document into a JavaScript object so the
// application can read device pairing settings. The deprecated ConvertXML APIs
// are exercised once each against a realistic XML payload.

const PAIRING_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<pairing>' +
    '<device id="sensor-01" type="thermostat">' +
      '<name>Living Room Thermostat</name>' +
      '<firmware version="2.4.1"/>' +
      '<location lat="31.23" lon="121.47"/>' +
    '</device>' +
    '<device id="sensor-02" type="humidity">' +
      '<name>Basement Hygrometer</name>' +
      '<firmware version="1.0.9"/>' +
    '</device>' +
  '</pairing>';

const PAIRING_OPTIONS: xml.ConvertOptions = {
  trim: true,
  ignoreDeclaration: true,
  ignoreInstruction: true,
  ignoreAttributes: false,
  ignoreComment: true,
  ignoreCDATA: true,
  ignoreDoctype: true,
  ignoreText: false,
  declarationKey: '_declaration',
  instructionKey: '_instruction',
  attributesKey: '_attributes',
  textKey: '_text',
  cdataKey: '_cdata',
  doctypeKey: '_doctype',
  commentKey: '_comment',
  parentKey: '_parent',
  typeKey: '_type',
  nameKey: '_name',
  elementsKey: '_elements',
};

async function parsePairingConfigLegacy(): Promise<Object> {
  const converter = new xml.ConvertXML();
  // convert() predates fastConvertToJSObject; still used by older callers.
  const result: Object = converter.convert(PAIRING_XML, PAIRING_OPTIONS);
  return result;
}

async function parsePairingConfig(): Promise<Object> {
  const converter = new xml.ConvertXML();
  // convertToJSObject() is the newer-but-deprecated variant; preferred is
  // fastConvertToJSObject (not exercised here).
  const result: Object = converter.convertToJSObject(PAIRING_XML, PAIRING_OPTIONS);
  return result;
}

async function run(): Promise<void> {
  try {
    const legacyObj = await parsePairingConfigLegacy();
    console.info('parsed pairing config (convert): %s', JSON.stringify(legacyObj));
  } catch (e) {
    console.error('convert() failed to parse pairing XML', e);
  }

  try {
    const obj = await parsePairingConfig();
    console.info('parsed pairing config (convertToJSObject): %s', JSON.stringify(obj));
  } catch (e) {
    console.error('convertToJSObject() failed to parse pairing XML', e);
  }
}

run();
