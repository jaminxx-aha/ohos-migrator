import dataUriUtils from '@ohos.ability.dataUriUtils';

// Scenario: managing the numeric record ID embedded at the end of a data URI's
// path component (e.g. "dataability://com.example.contacts/Users/42").

const BASE_USER_URI = 'dataability://com.example.contacts/Users';

// Compose a record URI by attaching the numeric ID to the end of the base path.
function buildUserUri(userId: number): string {
  const withId: string = dataUriUtils.attachId(BASE_USER_URI, userId);
  console.info(`composed user uri: ${withId}`);
  return withId;
}

// Resolve the ID carried at the end of the path component.
function readUserId(uri: string): number {
  const id: number = dataUriUtils.getId(uri);
  console.info(`resolved user id: ${id}`);
  return id;
}

// Replace the trailing ID with a new value (update, not append).
function changeUserId(uri: string, newId: number): string {
  const updated: string = dataUriUtils.updateId(uri, newId);
  console.info(`updated uri: ${updated}`);
  return updated;
}

// Drop the trailing ID, restoring the base collection path.
function stripUserId(uri: string): string {
  const stripped: string = dataUriUtils.deleteId(uri);
  console.info(`stripped uri: ${stripped}`);
  return stripped;
}

async function run(): Promise<void> {
  try {
    const uri = buildUserUri(42);
    const id = readUserId(uri);
    if (id !== 42) {
      console.error('unexpected id resolved from uri');
    }
    const movedUri = changeUserId(uri, 99);
    const cleaned = stripUserId(movedUri);
    console.info(`finished uri lifecycle, base restored: ${cleaned}`);
  } catch (e) {
    console.error('dataUriUtils lifecycle failed', e);
  }
}

run();
