import distributedData from '@ohos.data.distributedData';

// Scenario: a distributed contacts app built on the legacy
// @ohos.data.distributedData API (deprecated since 9 in favor of
// @ohos.data.distributedKVStore). Exercises manager creation, schema-backed
// single-version and device-collaboration stores, batch writes inside a
// transaction, predicate queries with result-set traversal, cross-device sync,
// change/sync subscriptions, and teardown.

const APP_ID = 'com.example.contacts';
const STORE_ID_SINGLE = 'contacts_single';
const STORE_ID_DEVICE = 'contacts_device';

interface Contact {
  name: string;
  age: number;
  email: string;
}

// Build a Schema describing a contact record and its indexed fields.
function buildSchema(): distributedData.Schema {
  const schema: distributedData.Schema = new distributedData.Schema();
  const root: distributedData.FieldNode = new distributedData.FieldNode('contact');
  root.default = '';
  root.nullable = false;
  root.type = distributedData.ValueType.STRING;
  const nameNode: distributedData.FieldNode = new distributedData.FieldNode('name');
  const appended: boolean = root.appendChild(nameNode);
  if (!appended) {
    console.error('failed to append schema field node');
  }
  schema.root = root;
  schema.indexes = ['$.name', '$.email'];
  schema.mode = 1;
  schema.skip = 0;
  return schema;
}

// Build store Options, switching the KVStoreType / SecurityLevel by store id.
function buildOptions(storeId: string): distributedData.Options {
  const options: distributedData.Options = {};
  options.createIfMissing = true;
  options.encrypt = false;
  options.backup = true;
  options.autoSync = true;
  options.kvStoreType = storeId === STORE_ID_DEVICE
    ? distributedData.KVStoreType.DEVICE_COLLABORATION
    : distributedData.KVStoreType.SINGLE_VERSION;
  options.securityLevel = storeId === STORE_ID_DEVICE
    ? distributedData.SecurityLevel.S3
    : distributedData.SecurityLevel.S2;
  options.schema = buildSchema();
  return options;
}

// Build a batch of typed metadata entries covering every ValueType.
function buildTypedEntries(): distributedData.Entry[] {
  const strVal: distributedData.Value = { type: distributedData.ValueType.STRING, value: 'Alice' };
  const intVal: distributedData.Value = { type: distributedData.ValueType.INTEGER, value: 30 };
  const floatVal: distributedData.Value = { type: distributedData.ValueType.FLOAT, value: 1.68 };
  const dblVal: distributedData.Value = { type: distributedData.ValueType.DOUBLE, value: 95.5 };
  const boolVal: distributedData.Value = { type: distributedData.ValueType.BOOLEAN, value: true };
  const bytesVal: distributedData.Value = { type: distributedData.ValueType.BYTE_ARRAY, value: new Uint8Array([1, 2, 3, 4]) };
  const entries: distributedData.Entry[] = [
    { key: 'user_alice_name', value: strVal },
    { key: 'user_alice_age', value: intVal },
    { key: 'user_alice_height', value: floatVal },
    { key: 'user_alice_score', value: dblVal },
    { key: 'user_alice_verified', value: boolVal },
    { key: 'user_alice_avatar', value: bytesVal },
  ];
  return entries;
}

function buildContactEntries(contacts: Contact[]): distributedData.Entry[] {
  return contacts.map((c: Contact): distributedData.Entry => {
    const v: distributedData.Value = { type: distributedData.ValueType.STRING, value: `${c.name}|${c.age}|${c.email}` };
    return { key: `user_${c.email}`, value: v };
  });
}

// Batch-write contacts inside a transaction, rolling back on failure.
async function writeContactsInTransaction(kvStore: distributedData.KVStore): Promise<void> {
  const contacts: Contact[] = [
    { name: 'Alice', age: 30, email: 'alice@example.com' },
    { name: 'Bob', age: 28, email: 'bob@example.com' },
    { name: 'Carol', age: 41, email: 'carol@example.com' },
  ];
  const entries: distributedData.Entry[] = buildContactEntries(contacts);

  await kvStore.startTransaction();
  try {
    await kvStore.putBatch(entries);
    await kvStore.putBatch(buildTypedEntries());
    await kvStore.deleteBatch(['user_legacy_1', 'user_legacy_2']);
    await kvStore.commit();
  } catch (e) {
    console.error('transaction failed, rolling back', e);
    await kvStore.rollback();
  }
  await kvStore.delete('user_temp');
  await kvStore.enableSync(true);
  await kvStore.setSyncRange(['default'], ['contacts_group']);
}

// Query the single-version store and traverse the result set.
async function queryAndReadResultSet(store: distributedData.SingleKVStore): Promise<void> {
  const query: distributedData.Query = new distributedData.Query();
  query.prefixKey('user_');
  query.equalTo('$.age', 30);
  query.notEqualTo('$.status', 'inactive');
  query.greaterThan('$.age', 17);
  query.greaterThanOrEqualTo('$.score', 60);
  query.lessThan('$.age', 65);
  query.lessThanOrEqualTo('$.score', 100);
  query.isNull('$.nickname');
  query.isNotNull('$.email');
  query.inNumber('$.level', [1, 2, 3]);
  query.inString('$.role', ['admin', 'user']);
  query.notInNumber('$.level', [9]);
  query.notInString('$.role', ['banned']);
  query.like('$.name', 'Ali%');
  query.unlike('$.name', '%spam%');
  query.and();
  query.or();
  query.beginGroup();
  query.equalTo('$.verified', true);
  query.endGroup();
  query.orderByAsc('$.name');
  query.orderByDesc('$.score');
  query.limit(10, 0);
  query.setSuggestIndex('idx_role');
  query.deviceId('peerDeviceA');
  const sql: string = query.getSqlLike();
  console.info('compiled query', sql);

  const matched: distributedData.Entry[] = await store.getEntries(query);
  console.info('matched entries', matched.length);

  const size: number = await store.getResultSize(query);
  console.info('result size', size);

  const rs: distributedData.KvStoreResultSet = await store.getResultSet(query);
  const total: number = rs.getCount();
  const pos: number = rs.getPosition();
  const beforeFirst: boolean = rs.isBeforeFirst();
  console.info('result set', total, pos, beforeFirst);
  rs.moveToFirst();
  do {
    const e: distributedData.Entry = rs.getEntry();
    const v: distributedData.Value = e.value;
    console.info('row', e.key, v.type, v.value);
  } while (rs.moveToNext());
  if (rs.isAfterLast()) {
    rs.moveToPrevious();
  }
  rs.moveToLast();
  if (rs.isLast()) {
    rs.move(-1);
  }
  rs.moveToPosition(0);
  if (rs.isFirst()) {
    console.info('cursor reset to first');
  }
  await store.closeResultSet(rs);
  query.reset();

  const value = await store.get('user_alice@example.com');
  console.info('looked up', value);
  const level: distributedData.SecurityLevel = await store.getSecurityLevel();
  console.info('security level', level);
}

// Query and read data scoped to a remote device via the DeviceKVStore.
async function deviceStoreScenario(store: distributedData.DeviceKVStore): Promise<void> {
  const peerDevice = 'peerDeviceA';
  const entries: distributedData.Entry[] = await store.getEntries(peerDevice, 'user_');
  console.info('peer entries', entries.length);
  const value = await store.get(peerDevice, 'user_alice@example.com');
  console.info('peer value', value);

  const rs: distributedData.KvStoreResultSet = await store.getResultSet(peerDevice, 'user_');
  console.info('peer result set count', rs.getCount());
  await store.closeResultSet(rs);

  const query: distributedData.Query = new distributedData.Query();
  query.prefixKey('user_');
  const size: number = await store.getResultSize(query);
  console.info('peer result size', size);

  await store.removeDeviceData(peerDevice);
}

// Subscribe to data-change and sync-complete events, then unsubscribe.
function subscribeAndUnsubscribe(
  baseStore: distributedData.KVStore,
  singleStore: distributedData.SingleKVStore,
  deviceStore: distributedData.DeviceKVStore,
): void {
  const onSyncComplete = (results: Array<[string, number]>): void => {
    for (const r of results) {
      console.info('sync complete', r[0], r[1]);
    }
  };
  const onDataChanged = (data: distributedData.ChangeNotification): void => {
    const ins: distributedData.Entry[] = data.insertEntries;
    const upd: distributedData.Entry[] = data.updateEntries;
    const del: distributedData.Entry[] = data.deleteEntries;
    const fromDevice: string = data.deviceId;
    for (const e of ins) {
      const v: distributedData.Value = e.value;
      console.info('insert', fromDevice, e.key, v.type, v.value);
    }
    for (const e of upd) {
      console.info('update', fromDevice, e.key);
    }
    for (const e of del) {
      console.info('delete', fromDevice, e.key);
    }
  };

  baseStore.on('dataChange', distributedData.SubscribeType.SUBSCRIBE_TYPE_ALL, onDataChanged);
  singleStore.on('dataChange', distributedData.SubscribeType.SUBSCRIBE_TYPE_LOCAL, onDataChanged);
  deviceStore.on('dataChange', distributedData.SubscribeType.SUBSCRIBE_TYPE_REMOTE, onDataChanged);

  singleStore.on('syncComplete', onSyncComplete);
  deviceStore.on('syncComplete', onSyncComplete);
  baseStore.on('syncComplete', onSyncComplete);

  baseStore.off('dataChange');
  singleStore.off('dataChange');
  deviceStore.off('dataChange');
  singleStore.off('syncComplete', onSyncComplete);
  deviceStore.off('syncComplete', onSyncComplete);
}

// Configure sync parameters and push/pull data to peer devices.
async function syncStores(
  singleStore: distributedData.SingleKVStore,
  deviceStore: distributedData.DeviceKVStore,
): Promise<void> {
  await singleStore.setSyncParam(500);
  singleStore.sync(['peerDeviceA'], distributedData.SyncMode.PUSH_PULL, 200);
  singleStore.sync([], distributedData.SyncMode.PULL_ONLY);
  deviceStore.sync(['peerDeviceB'], distributedData.SyncMode.PUSH_ONLY);
  await singleStore.removeDeviceData('peerDeviceC');
}

// Enumerate stores, register a death listener, then close and delete stores.
async function enumerateAndTeardown(
  manager: distributedData.KVManager,
  singleStore: distributedData.SingleKVStore,
  deviceStore: distributedData.DeviceKVStore,
): Promise<void> {
  const storeIds: string[] = await manager.getAllKVStoreId(APP_ID);
  console.info('store ids', storeIds.join(','));
  const deathCb = (): void => { console.info('distributed data service died'); };
  manager.on('distributedDataServiceDie', deathCb);
  manager.off('distributedDataServiceDie', deathCb);
  await manager.closeKVStore(APP_ID, STORE_ID_SINGLE, singleStore);
  await manager.closeKVStore(APP_ID, STORE_ID_DEVICE, deviceStore);
  await manager.deleteKVStore(APP_ID, STORE_ID_SINGLE);
  await manager.deleteKVStore(APP_ID, STORE_ID_DEVICE);
}

async function run(): Promise<void> {
  // Validate supported security levels and store types up front.
  const supportedLevels: distributedData.SecurityLevel[] = [
    distributedData.SecurityLevel.NO_LEVEL,
    distributedData.SecurityLevel.S0,
    distributedData.SecurityLevel.S1,
    distributedData.SecurityLevel.S2,
    distributedData.SecurityLevel.S3,
    distributedData.SecurityLevel.S4,
  ];
  const supportedTypes: distributedData.KVStoreType[] = [
    distributedData.KVStoreType.SINGLE_VERSION,
    distributedData.KVStoreType.DEVICE_COLLABORATION,
    distributedData.KVStoreType.MULTI_VERSION,
  ];
  // Capacity guards for keys, values, queries, and batches.
  const maxKey: number = distributedData.Constants.MAX_KEY_LENGTH;
  const maxKeyDev: number = distributedData.Constants.MAX_KEY_LENGTH_DEVICE;
  const maxVal: number = distributedData.Constants.MAX_VALUE_LENGTH;
  const maxStore: number = distributedData.Constants.MAX_STORE_ID_LENGTH;
  const maxQuery: number = distributedData.Constants.MAX_QUERY_LENGTH;
  const maxBatch: number = distributedData.Constants.MAX_BATCH_SIZE;
  console.info('limits', maxKey, maxKeyDev, maxVal, maxStore, maxQuery, maxBatch, supportedLevels.length, supportedTypes.length);

  const userInfo: distributedData.UserInfo = {
    userId: 'user_100',
    userType: distributedData.UserType.SAME_USER_ID,
  };
  const config: distributedData.KVManagerConfig = {
    bundleName: APP_ID,
    userInfo: userInfo,
  };
  const cfgBundle: string = config.bundleName;
  const cfgUser: distributedData.UserInfo = config.userInfo;
  const uid: string | undefined = cfgUser.userId;
  const utype: distributedData.UserType | undefined = cfgUser.userType;
  console.info('config', cfgBundle, uid, utype);

  const manager: distributedData.KVManager = await distributedData.createKVManager(config);

  const singleStore: distributedData.SingleKVStore =
    await manager.getKVStore<distributedData.SingleKVStore>(STORE_ID_SINGLE, buildOptions(STORE_ID_SINGLE));
  const deviceStore: distributedData.DeviceKVStore =
    await manager.getKVStore<distributedData.DeviceKVStore>(STORE_ID_DEVICE, buildOptions(STORE_ID_DEVICE));
  const baseStore: distributedData.KVStore = singleStore;

  try {
    await writeContactsInTransaction(baseStore);
    await queryAndReadResultSet(singleStore);
    await deviceStoreScenario(deviceStore);
    subscribeAndUnsubscribe(baseStore, singleStore, deviceStore);
    await syncStores(singleStore, deviceStore);
  } catch (e) {
    console.error('distributed contacts scenario failed', e);
  } finally {
    await enumerateAndTeardown(manager, singleStore, deviceStore);
  }
}

run();
