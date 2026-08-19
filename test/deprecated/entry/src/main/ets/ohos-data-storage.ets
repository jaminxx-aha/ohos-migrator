import storage from '@ohos.data.storage';

// Module-level deprecated constants
const maxKey = storage.MAX_KEY_LENGTH;
const maxVal = storage.MAX_VALUE_LENGTH;

const PREFS_PATH = '/data/storage/el2/database/myapp/preferences/user_prefs.xml';
const FLAG_KEY = 'startup_initialized';

// Observer used to subscribe/unsubscribe; touches StorageObserver type + key field
const observer: storage.StorageObserver = { key: FLAG_KEY };

// Sync scenario: write prefs, read them back, then tear down.
function writePrefsSync(): void {
  const store: storage.Storage = storage.getStorageSync(PREFS_PATH);

  store.putSync('theme', 'dark');
  store.putSync('volume', 80);
  store.flushSync();

  const theme: storage.ValueType = store.getSync('theme', 'light');
  const present: boolean = store.hasSync('volume');
  console.info('sync prefs', theme, present, maxKey, maxVal);

  store.deleteSync('theme');
  store.clearSync();

  storage.removeStorageFromCacheSync(PREFS_PATH);
  storage.deleteStorageSync(PREFS_PATH);
}

// Async scenario: bootstrap user prefs with defaults, observe changes, then clean up.
async function bootstrapUserPrefs(): Promise<void> {
  const store: storage.Storage = await storage.getStorage(PREFS_PATH);

  store.on('change', (data: storage.StorageObserver) => {
    console.info('prefs changed', data.key);
  });
  store.off('change', (data: storage.StorageObserver) => { console.info('unsubscribed', observer.key); });

  const exists: boolean = await store.has(FLAG_KEY);
  if (!exists) {
    const flag: storage.ValueType = true;
    await store.put(FLAG_KEY, flag);
    await store.put('theme', 'light');
    await store.put('launch_count', 0);
    await store.flush();
  }

  const theme: storage.ValueType = await store.get('theme', 'light');
  const count: storage.ValueType = await store.get('launch_count', 0);
  console.info('loaded prefs', theme, count);

  await store.delete(FLAG_KEY);
  await store.clear();

  await storage.removeStorageFromCache(PREFS_PATH);
  await storage.deleteStorage(PREFS_PATH);
}

async function run(): Promise<void> {
  try {
    writePrefsSync();
    await bootstrapUserPrefs();
  } catch (e) {
    console.error('storage scenario failed', e);
  }
}

run();
