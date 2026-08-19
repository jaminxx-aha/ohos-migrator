import pasteboard from '@ohos.pasteboard';
import Want from '@ohos.app.ability.Want';

// Scenario 1: Build a rich PasteData carrying several record kinds, using the
// legacy per-type add*Record instance methods and the module-level create*Record
// / create*Data factory functions (all deprecated since 9). Also exercises the
// index-based record management APIs (getRecordAt, hasMimeType, replaceRecordAt,
// removeRecordAt) and the cross-device ShareOption (deprecated since 12).
function buildRichPasteData(): pasteboard.PasteData {
  const html: string = '<p><b>Meeting notes</b> — Q3 roadmap review</p>';
  const text: string = 'Meeting notes — Q3 roadmap review';
  const uri: string = 'https://example.com/notes/q3-roadmap';
  const want: Want = { bundleName: 'com.example.notes', action: 'action.system.home', entities: ['entity.system.home'] };

  // Module-level factory functions (deprecated since 9) — one each of Data/Record.
  const htmlData: pasteboard.PasteData = pasteboard.createHtmlData(html);
  const plainRecord: pasteboard.PasteDataRecord = pasteboard.createPlainTextRecord(text);
  const htmlRecord: pasteboard.PasteDataRecord = pasteboard.createHtmlTextRecord(html);
  const uriRecord: pasteboard.PasteDataRecord = pasteboard.createUriRecord(uri);
  const wantRecord: pasteboard.PasteDataRecord = pasteboard.createWantRecord(want);
  const uriData: pasteboard.PasteData = pasteboard.createUriData(uri);
  const wantData: pasteboard.PasteData = pasteboard.createWantData(want);

  // Start from a plain-text payload, then append the other record kinds via
  // the deprecated per-type add*Record instance methods.
  const data: pasteboard.PasteData = pasteboard.createPlainTextData(text);
  data.addHtmlRecord(html);
  data.addTextRecord('plain copy of the notes');
  data.addUriRecord(uri);
  data.addWantRecord(want);

  // Index-based record management (deprecated since 9): check type, replace,
  // and remove the last record.
  const isHtml: boolean = data.hasMimeType(pasteboard.MIMETYPE_TEXT_HTML);
  const replaced: boolean = data.replaceRecordAt(0, htmlRecord);
  const removed: boolean = data.removeRecordAt(data.getRecordCount() - 1);
  console.info('rich paste built', 'records=' + data.getRecordCount(), 'isHtml=' + isHtml, 'replaced=' + replaced, 'removed=' + removed, htmlData, plainRecord, uriRecord, wantRecord, uriData, wantData);

  // Reference the deprecated cross-device share option (deprecated since 12).
  const crossDevice: pasteboard.ShareOption = pasteboard.ShareOption.CROSSDEVICE;
  data.getProperty().shareOption = crossDevice;

  return data;
}

// Scenario 2: Move a PasteData through the system pasteboard using the legacy
// callback-based SystemPasteboard APIs (deprecated since 9), round-trip the
// records back out, read one via getRecordAt, and convert it to plain text via
// the deprecated PasteDataRecord.convertToText(callback) form.
async function syncWithSystemPasteboard(data: pasteboard.PasteData): Promise<void> {
  const board: pasteboard.SystemPasteboard = pasteboard.getSystemPasteboard();

  // setPasteData(data, callback) — deprecated.
  await new Promise<void>((resolve, reject) => {
    board.setPasteData(data, (err: Error) => {
      if (err) { reject(err); } else { resolve(); }
    });
  });

  // hasPasteData(callback) — deprecated.
  const has: boolean = await new Promise<boolean>((resolve, reject) => {
    board.hasPasteData((err: Error, ok: boolean) => {
      if (err) { reject(err); } else { resolve(ok); }
    });
  });
  console.info('system pasteboard hasData=' + has);

  // getPasteData(callback) — deprecated.
  const fetched: pasteboard.PasteData = await new Promise<pasteboard.PasteData>((resolve, reject) => {
    board.getPasteData((err: Error, d: pasteboard.PasteData) => {
      if (err) { reject(err); } else { resolve(d); }
    });
  });

  // Read the first fetched record (deprecated getRecordAt) and convert it to
  // plain text via the deprecated PasteDataRecord.convertToText(callback).
  const first: pasteboard.PasteDataRecord = fetched.getRecordAt(0);
  const asText: string = await new Promise<string>((resolve, reject) => {
    first.convertToText((err: Error, t: string) => {
      if (err) { reject(err); } else { resolve(t); }
    });
  });
  console.info('first record as text:', asText);

  // clear(callback) — deprecated.
  await new Promise<void>((resolve, reject) => {
    board.clear((err: Error) => {
      if (err) { reject(err); } else { resolve(); }
    });
  });
}

async function run(): Promise<void> {
  try {
    const data: pasteboard.PasteData = buildRichPasteData();
    await syncWithSystemPasteboard(data);
  } catch (e) {
    console.error('pasteboard scenario failed', e);
  }
}

run();
