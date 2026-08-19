import rdb from '@ohos.data.rdb';

// Scenario: a "USER" relational + distributed table with full CRUD, query, and
// cross-device sync. Exercises the legacy (since-9) rdb API surface.

const STORE_CONFIG: rdb.StoreConfig = {
  name: 'USER.db',
};
STORE_CONFIG.name; // StoreConfig.name (deprecated accessor)

async function openStore(context: Context): Promise<rdb.RdbStore> {
  return await rdb.getRdbStore(context, STORE_CONFIG, 1); // getRdbStore (deprecated)
}

async function createSchema(store: rdb.RdbStore): Promise<void> {
  try {
    await store.executeSql( // RdbStore.executeSql
      'CREATE TABLE IF NOT EXISTS USER (id INTEGER PRIMARY KEY, name TEXT, age INTEGER, profile BLOB)'
    );
  } catch (e) {
    console.error('createSchema failed', e);
  }
}

// Build a rich predicates chain covering the deprecated query-builder API.
function buildAdultPredicates(): rdb.RdbPredicates {
  // RdbPredicates (class ref) is covered by `new rdb.RdbPredicates(...)` below.
  const p = new rdb.RdbPredicates('USER');
  p.and(); // and
  p.beginWrap(); // beginWrap
  p.beginsWith('name', 'A'); // beginsWith
  p.between('age', 18, 65); // between
  p.contains('name', 'a'); // contains
  p.distinct(); // distinct
  p.endWrap(); // endWrap
  p.endsWith('name', 'n'); // endsWith
  p.equalTo('age', 30); // equalTo
  p.glob('name', '*A*'); // glob
  p.greaterThan('age', 17); // greaterThan
  p.greaterThanOrEqualTo('age', 18); // greaterThanOrEqualTo
  p.groupBy(['age']); // groupBy
  p.in('name', ['Alice', 'Anna']); // in
  p.inAllDevices(); // inAllDevices
  p.inDevices(['device-1']); // inDevices
  p.indexedBy('idx_user_name'); // indexedBy
  p.isNotNull('profile'); // isNotNull
  p.isNull('profile'); // isNull
  p.lessThan('age', 66); // lessThan
  p.lessThanOrEqualTo('age', 65); // lessThanOrEqualTo
  p.like('name', '%li%'); // like
  p.limitAs(20); // limitAs
  p.notBetween('age', 0, 17); // notBetween
  p.notEqualTo('name', 'admin'); // notEqualTo
  p.notIn('name', ['root', 'guest']); // notIn
  p.offsetAs(0); // offsetAs
  p.or(); // or
  p.orderByAsc('age'); // orderByAsc
  p.orderByDesc('name'); // orderByDesc
  return p;
}

async function insertUsers(store: rdb.RdbStore): Promise<void> {
  const alice: rdb.ValuesBucket = { id: 1, name: 'Alice', age: 30, profile: new Uint8Array([1, 2]) };
  const anna: rdb.ValuesBucket = { id: 2, name: 'Anna', age: 25, profile: new Uint8Array([3]) };
  try {
    await store.insert('USER', alice); // RdbStore.insert
    await store.batchInsert('USER', [alice, anna]); // RdbStore.batchInsert
    store.beginTransaction(); // RdbStore.beginTransaction
    await store.insert('USER', anna);
    store.commit(); // RdbStore.commit
  } catch (e) {
    store.rollBack(); // RdbStore.rollBack
    console.error('insertUsers failed', e);
  }
}

async function updateAndDelete(store: rdb.RdbStore): Promise<void> {
  const patch: rdb.ValuesBucket = { age: 31 };
  const matchAge: rdb.RdbPredicates = new rdb.RdbPredicates('USER');
  matchAge.equalTo('name', 'Alice');
  try {
    await store.update(patch, matchAge); // RdbStore.update
    const stale: rdb.RdbPredicates = new rdb.RdbPredicates('USER');
    stale.equalTo('name', 'guest');
    await store.delete(stale); // RdbStore.delete
  } catch (e) {
    console.error('updateAndDelete failed', e);
  }
}

async function queryUsers(store: rdb.RdbStore): Promise<void> {
  const predicates = buildAdultPredicates();
  try {
    const rs: rdb.ResultSet = await store.query(predicates); // RdbStore.query
    await consumeResultSet(rs);
    const rs2: rdb.ResultSet = await store.querySql('SELECT * FROM USER WHERE age > 18'); // RdbStore.querySql
    await consumeResultSet(rs2);
  } catch (e) {
    console.error('queryUsers failed', e);
  }
}

async function consumeResultSet(rs: rdb.ResultSet): Promise<void> {
  rs.goToFirstRow(); // ResultSet.goToFirstRow
  rs.goTo(-1); // ResultSet.goTo
  rs.goToFirstRow();
  while (rs.goToNextRow()) { // ResultSet.goToNextRow
    const idx: number = rs.getColumnIndex('name'); // ResultSet.getColumnIndex
    const colName: string = rs.getColumnName(0); // ResultSet.getColumnName
    rs.getString(idx); // ResultSet.getString
    const nameVal: rdb.ValueType = rs.getString(idx); // ValueType (type annotation)
    rs.getLong(0); // ResultSet.getLong
    rs.getDouble(0); // ResultSet.getDouble
    rs.getBlob(0); // ResultSet.getBlob
    rs.isColumnNull(0); // ResultSet.isColumnNull
    rs.rowIndex; // ResultSet.rowIndex
    rs.isAtFirstRow; // ResultSet.isAtFirstRow
  }
  rs.goToLastRow(); // ResultSet.goToLastRow
  rs.goToPreviousRow(); // ResultSet.goToPreviousRow
  rs.goToRow(0); // ResultSet.goToRow
  rs.isAtLastRow; // ResultSet.isAtLastRow
  rs.isStarted; // ResultSet.isStarted
  rs.isEnded; // ResultSet.isEnded
  rs.rowCount; // ResultSet.rowCount
  rs.columnCount; // ResultSet.columnCount
  rs.columnNames; // ResultSet.columnNames
  rs.isClosed; // ResultSet.isClosed
  rs.close(); // ResultSet.close
}

async function distributedSync(store: rdb.RdbStore): Promise<void> {
  // SyncMode / SubscribeType (enum refs) are covered by the member accesses below.
  rdb.SyncMode.SYNC_MODE_PULL; // SyncMode.SYNC_MODE_PULL
  rdb.SyncMode.SYNC_MODE_PUSH; // SyncMode.SYNC_MODE_PUSH
  rdb.SubscribeType.SUBSCRIBE_TYPE_REMOTE; // SubscribeType.SUBSCRIBE_TYPE_REMOTE
  try {
    await store.setDistributedTables(['USER']); // RdbStore.setDistributedTables
    const remoteTable: string = await store.obtainDistributedTableName('device-1', 'USER'); // RdbStore.obtainDistributedTableName
    const predicates = new rdb.RdbPredicates('USER');
    store.on('dataChange', rdb.SubscribeType.SUBSCRIBE_TYPE_REMOTE, () => {}); // RdbStore.on
    await store.sync(rdb.SyncMode.SYNC_MODE_PUSH, predicates); // RdbStore.sync
    await store.sync(rdb.SyncMode.SYNC_MODE_PULL, predicates);
    store.off('dataChange', rdb.SubscribeType.SUBSCRIBE_TYPE_REMOTE, () => {}); // RdbStore.off
  } catch (e) {
    console.error('distributedSync failed', e);
  }
}

async function teardown(context: Context): Promise<void> {
  rdb.deleteRdbStore; // deleteRdbStore (function ref)
  try {
    await rdb.deleteRdbStore(context, STORE_CONFIG.name); // deleteRdbStore (deprecated)
  } catch (e) {
    console.error('teardown failed', e);
  }
}

async function run(context: Context): Promise<void> {
  const store: rdb.RdbStore = await openStore(context); // RdbStore (type ref)
  await createSchema(store);
  await insertUsers(store);
  await updateAndDelete(store);
  await queryUsers(store);
  await distributedSync(store);
  await teardown(context);
}

run(getContext() as Context);
