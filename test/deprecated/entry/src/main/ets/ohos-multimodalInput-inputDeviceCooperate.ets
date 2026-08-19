// The entire inputDeviceCooperate namespace is @deprecated since API 23
// (useinstead: ohos.cooperate/cooperate). In this SDK revision the namespace
// ships no callable members and cannot be referenced as a value, so there is
// nothing to invoke at runtime; the realistic runtime behavior is to migrate
// callers off it.

/** Name of the deprecated input-cooperation module. */
function getDeprecatedCooperateModule(): string {
  return '@ohos.multimodalInput.inputDeviceCooperate';
}

/** Name of the module that replaces it as of API 23. */
function getReplacementCooperateModule(): string {
  return '@ohos.cooperate';
}

/**
 * Build a human-readable migration notice for callers still depending on the
 * deprecated inputDeviceCooperate namespace.
 */
function buildMigrationNotice(): string {
  const deprecated = getDeprecatedCooperateModule();
  const replacement = getReplacementCooperateModule();
  return `${deprecated} is deprecated since API 23; migrate to ${replacement}.`;
}

/** Surface the migration notice so runtime logs carry the deprecation. */
async function reportCooperateMigration(): Promise<void> {
  try {
    const notice = buildMigrationNotice();
    console.warn(notice);
  } catch (e) {
    console.error('Failed to report cooperate migration', e);
  }
}

async function run(): Promise<void> {
  await reportCooperateMigration();
}

run();
