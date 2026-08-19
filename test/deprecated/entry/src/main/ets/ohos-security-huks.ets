import huks from '@ohos.security.huks';

// Maps a HUKS numeric error code to a human-readable label, covering every
// deprecated member of the HuksErrorCode enum so the runtime can surface a
// descriptive message for any failure returned by the (also deprecated)
// legacy HUKS callback APIs below.
function describeHuksError(code: number): string {
  switch (code) {
    case huks.HuksErrorCode.HUKS_SUCCESS:
      return 'success';
    case huks.HuksErrorCode.HUKS_FAILURE:
      return 'generic failure';
    case huks.HuksErrorCode.HUKS_ERROR_BAD_STATE:
      return 'bad state';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_ARGUMENT:
      return 'invalid argument';
    case huks.HuksErrorCode.HUKS_ERROR_NOT_SUPPORTED:
      return 'not supported';
    case huks.HuksErrorCode.HUKS_ERROR_NO_PERMISSION:
      return 'no permission';
    case huks.HuksErrorCode.HUKS_ERROR_INSUFFICIENT_DATA:
      return 'insufficient data';
    case huks.HuksErrorCode.HUKS_ERROR_BUFFER_TOO_SMALL:
      return 'buffer too small';
    case huks.HuksErrorCode.HUKS_ERROR_INSUFFICIENT_MEMORY:
      return 'insufficient memory';
    case huks.HuksErrorCode.HUKS_ERROR_COMMUNICATION_FAILURE:
      return 'communication failure';
    case huks.HuksErrorCode.HUKS_ERROR_STORAGE_FAILURE:
      return 'storage failure';
    case huks.HuksErrorCode.HUKS_ERROR_HARDWARE_FAILURE:
      return 'hardware failure';
    case huks.HuksErrorCode.HUKS_ERROR_ALREADY_EXISTS:
      return 'already exists';
    case huks.HuksErrorCode.HUKS_ERROR_NOT_EXIST:
      return 'not exist';
    case huks.HuksErrorCode.HUKS_ERROR_NULL_POINTER:
      return 'null pointer';
    case huks.HuksErrorCode.HUKS_ERROR_FILE_SIZE_FAIL:
      return 'file size fail';
    case huks.HuksErrorCode.HUKS_ERROR_READ_FILE_FAIL:
      return 'read file fail';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_PUBLIC_KEY:
      return 'invalid public key';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_PRIVATE_KEY:
      return 'invalid private key';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_KEY_INFO:
      return 'invalid key info';
    case huks.HuksErrorCode.HUKS_ERROR_HASH_NOT_EQUAL:
      return 'hash not equal';
    case huks.HuksErrorCode.HUKS_ERROR_MALLOC_FAIL:
      return 'malloc fail';
    case huks.HuksErrorCode.HUKS_ERROR_WRITE_FILE_FAIL:
      return 'write file fail';
    case huks.HuksErrorCode.HUKS_ERROR_REMOVE_FILE_FAIL:
      return 'remove file fail';
    case huks.HuksErrorCode.HUKS_ERROR_OPEN_FILE_FAIL:
      return 'open file fail';
    case huks.HuksErrorCode.HUKS_ERROR_CLOSE_FILE_FAIL:
      return 'close file fail';
    case huks.HuksErrorCode.HUKS_ERROR_MAKE_DIR_FAIL:
      return 'make dir fail';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_KEY_FILE:
      return 'invalid key file';
    case huks.HuksErrorCode.HUKS_ERROR_IPC_MSG_FAIL:
      return 'ipc msg fail';
    case huks.HuksErrorCode.HUKS_ERROR_REQUEST_OVERFLOWS:
      return 'request overflows';
    case huks.HuksErrorCode.HUKS_ERROR_PARAM_NOT_EXIST:
      return 'param not exist';
    case huks.HuksErrorCode.HUKS_ERROR_CRYPTO_ENGINE_ERROR:
      return 'crypto engine error';
    case huks.HuksErrorCode.HUKS_ERROR_COMMUNICATION_TIMEOUT:
      return 'communication timeout';
    case huks.HuksErrorCode.HUKS_ERROR_IPC_INIT_FAIL:
      return 'ipc init fail';
    case huks.HuksErrorCode.HUKS_ERROR_IPC_DLOPEN_FAIL:
      return 'ipc dlopen fail';
    case huks.HuksErrorCode.HUKS_ERROR_EFUSE_READ_FAIL:
      return 'efuse read fail';
    case huks.HuksErrorCode.HUKS_ERROR_NEW_ROOT_KEY_MATERIAL_EXIST:
      return 'new root key material exist';
    case huks.HuksErrorCode.HUKS_ERROR_UPDATE_ROOT_KEY_MATERIAL_FAIL:
      return 'update root key material fail';
    case huks.HuksErrorCode.HUKS_ERROR_VERIFICATION_FAILED:
      return 'verification failed';
    case huks.HuksErrorCode.HUKS_ERROR_CHECK_GET_ALG_FAIL:
      return 'check get alg fail';
    case huks.HuksErrorCode.HUKS_ERROR_CHECK_GET_KEY_SIZE_FAIL:
      return 'check get key size fail';
    case huks.HuksErrorCode.HUKS_ERROR_CHECK_GET_DIGEST_FAIL:
      return 'check get digest fail';
    case huks.HuksErrorCode.HUKS_ERROR_CHECK_GET_PADDING_FAIL:
      return 'check get padding fail';
    case huks.HuksErrorCode.HUKS_ERROR_CHECK_GET_MODE_FAIL:
      return 'check get mode fail';
    case huks.HuksErrorCode.HUKS_ERROR_CHECK_GET_NONCE_FAIL:
      return 'check get nonce fail';
    case huks.HuksErrorCode.HUKS_ERROR_CHECK_GET_AAD_FAIL:
      return 'check get aad fail';
    case huks.HuksErrorCode.HUKS_ERROR_CHECK_GET_AE_TAG_FAIL:
      return 'check get ae tag fail';
    case huks.HuksErrorCode.HUKS_ERROR_CHECK_GET_SALT_FAIL:
      return 'check get salt fail';
    case huks.HuksErrorCode.HUKS_ERROR_CHECK_GET_IV_FAIL:
      return 'check get iv fail';
    case huks.HuksErrorCode.HUKS_ERROR_CHECK_GET_PURPOSE_FAIL:
      return 'check get purpose fail';
    case huks.HuksErrorCode.HUKS_ERROR_CHECK_GET_ITERATION_FAIL:
      return 'check get iteration fail';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_ALGORITHM:
      return 'invalid algorithm';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_KEY_SIZE:
      return 'invalid key size';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_DIGEST:
      return 'invalid digest';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_PADDING:
      return 'invalid padding';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_MODE:
      return 'invalid mode';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_NONCE:
      return 'invalid nonce';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_AAD:
      return 'invalid aad';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_AE_TAG:
      return 'invalid ae tag';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_SALT:
      return 'invalid salt';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_IV:
      return 'invalid iv';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_PURPOSE:
      return 'invalid purpose';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_ITERATION:
      return 'invalid iteration';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_SIGNATURE_SIZE:
      return 'invalid signature size';
    case huks.HuksErrorCode.HUKS_ERROR_INVALID_OPERATION:
      return 'invalid operation';
    case huks.HuksErrorCode.HUKS_ERROR_INTERNAL_ERROR:
      return 'internal error';
    case huks.HuksErrorCode.HUKS_ERROR_UNKNOWN_ERROR:
      return 'unknown error';
    default:
      return 'unmapped error ' + code;
  }
}

// Builds a diagnostic record of every deprecated HUKS_TAG_* tag, exposing the
// (deprecated) tag identifiers that legacy key-attestation and key-derivation
// flows historically consulted. Each entry pairs the tag with a placeholder
// numeric value.
function buildDeprecatedTagRegistry(): Array<huks.HuksParam> {
  const entries: Array<huks.HuksParam> = [];
  entries.push({ tag: huks.HuksTag.HUKS_TAG_INVALID, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ACCESS_TIME, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ACTIVE_DATETIME, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ATTESTATION_ID_BRAND, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ATTESTATION_ID_DEVICE, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ATTESTATION_ID_IMEI, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ATTESTATION_ID_MANUFACTURER, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ATTESTATION_ID_MEID, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ATTESTATION_ID_MODEL, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ATTESTATION_ID_PRODUCT, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ATTESTATION_ID_SERIAL, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ATTESTATION_ID_SOCID, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ATTESTATION_ID_UDID, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_CREATION_DATETIME, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_CRYPTO_CTX, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_DERIVE_ALG, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_DERIVE_FACTOR, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_DERIVE_MAIN_KEY, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_IS_KEY_HANDLE, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_KEY_VERSION, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_ORIGINATION_EXPIRE_DATETIME, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_OS_PATCHLEVEL, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_OS_VERSION, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_PACKAGE_NAME, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_PAYLOAD_LEN, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_PROCESS_NAME, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_PWD, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_SECURE_KEY_ALIAS, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_SECURE_KEY_UUID, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_USAGE_EXPIRE_DATETIME, value: 0 });
  entries.push({ tag: huks.HuksTag.HUKS_TAG_USES_TIME, value: 0 });
  return entries;
}

// Options describing a persistent AES-512 key used to wrap device secrets.
function buildAesKeyOptions(): huks.HuksOptions {
  return {
    properties: [
      { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
      { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT },
      { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_512 },
      { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_NONE },
      { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_GCM },
    ],
  };
}

const KEY_ALIAS = 'com.example.app.deviceWrappingKey';

// Scenario 1: report the HUKS SDK version and ensure a persistent AES key is
// present, (re)generating it when missing.
async function ensureWrappingKeyExists(): Promise<void> {
  const sdkVersion: string = huks.getSdkVersion(buildAesKeyOptions());
  console.info('huks sdk version: ' + sdkVersion);

  const options = buildAesKeyOptions();
  let exists = false;
  try {
    exists = await huks.isKeyExist(KEY_ALIAS, options);
  } catch (e) {
    console.error('isKeyExist failed', e);
  }

  if (exists) {
    console.info('wrapping key already present, skipping generation');
    return;
  }
  try {
    const genResult: huks.HuksResult = await huks.generateKey(KEY_ALIAS, options);
    if (genResult.errorCode !== huks.HuksErrorCode.HUKS_SUCCESS) {
      throw new Error('generateKey failed: ' + describeHuksError(genResult.errorCode));
    }
    console.info('wrapping key generated');
  } catch (e) {
    console.error('generateKey failed', e);
  }
}

// Scenario 2: export the wrapping key, inspect its properties, and re-import it
// under a fresh alias (simulating a key-rotation / migration step).
async function exportAndReimportKey(): Promise<void> {
  const options = buildAesKeyOptions();
  try {
    const exported: huks.HuksResult = await huks.exportKey(KEY_ALIAS, options);
    if (exported.errorCode !== huks.HuksErrorCode.HUKS_SUCCESS) {
      throw new Error('exportKey failed: ' + describeHuksError(exported.errorCode));
    }
    if (exported.outData) {
      const importOptions: huks.HuksOptions = { properties: options.properties, inData: exported.outData };
      const imported: huks.HuksResult = await huks.importKey(KEY_ALIAS + '.rotated', importOptions);
      if (imported.errorCode !== huks.HuksErrorCode.HUKS_SUCCESS) {
        throw new Error('importKey failed: ' + describeHuksError(imported.errorCode));
      }
    }
  } catch (e) {
    console.error('export/import failed', e);
  }

  try {
    const props: huks.HuksResult = await huks.getKeyProperties(KEY_ALIAS, options);
    if (props.properties) {
      console.info('key property count: ' + props.properties.length);
    }
  } catch (e) {
    console.error('getKeyProperties failed', e);
  }
}

// Scenario 3: run an encrypt session (init -> update -> finish) over a small
// payload, falling back to abort on any failure. The deprecated HuksHandle and
// HuksResult shapes are inspected along the way.
async function encryptSecretWithWrappingKey(plaintext: Uint8Array): Promise<void> {
  const options: huks.HuksOptions = {
    properties: [
      { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
      { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT },
      { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_512 },
      { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_GCM },
      { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_NONE },
      { tag: huks.HuksTag.HUKS_TAG_NONCE, value: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) },
      { tag: huks.HuksTag.HUKS_TAG_ASSOCIATED_DATA, value: new Uint8Array([]) },
    ],
    inData: plaintext,
  };

  let handle: huks.HuksHandle;
  try {
    handle = await huks.init(KEY_ALIAS, options);
    if (handle.errorCode !== huks.HuksErrorCode.HUKS_SUCCESS) {
      throw new Error('init failed: ' + describeHuksError(handle.errorCode));
    }
    console.info('session handle: ' + handle.handle);
    if (handle.token) {
      console.info('session token length: ' + handle.token.length);
    }
  } catch (e) {
    console.error('init failed', e);
    return;
  }

  try {
    const updated: huks.HuksResult = await huks.update(handle.handle, handle.token, options);
    if (updated.errorCode !== huks.HuksErrorCode.HUKS_SUCCESS) {
      throw new Error('update failed: ' + describeHuksError(updated.errorCode));
    }
  } catch (e) {
    console.error('update failed', e);
    try {
      await huks.abort(handle.handle, options);
    } catch (e2) {
      console.error('abort after update failed', e2);
    }
    return;
  }

  try {
    const finished: huks.HuksResult = await huks.finish(handle.handle, options);
    if (finished.errorCode !== huks.HuksErrorCode.HUKS_SUCCESS) {
      throw new Error('finish failed: ' + describeHuksError(finished.errorCode));
    }
    if (finished.outData) {
      console.info('ciphertext length: ' + finished.outData.length);
    }
    if (finished.properties) {
      console.info('result property count: ' + finished.properties.length);
    }
    if (finished.certChains) {
      console.info('cert chain count: ' + finished.certChains.length);
    }
  } catch (e) {
    console.error('finish failed', e);
    try {
      await huks.abort(handle.handle, options);
    } catch (e2) {
      console.error('abort after finish failed', e2);
    }
  }
}

// Scenario 4: tear down the wrapping key once the device is deprovisioned.
async function deleteWrappingKey(): Promise<void> {
  const options = buildAesKeyOptions();
  try {
    const result: huks.HuksResult = await huks.deleteKey(KEY_ALIAS, options);
    if (result.errorCode !== huks.HuksErrorCode.HUKS_SUCCESS) {
      throw new Error('deleteKey failed: ' + describeHuksError(result.errorCode));
    }
    console.info('wrapping key deleted');
  } catch (e) {
    console.error('deleteKey failed', e);
  }
}

async function run(): Promise<void> {
  // Touch the deprecated enum namespaces so the legacy symbol set is preserved.
  const _keySizeRef = huks.HuksKeySize.HUKS_AES_KEY_SIZE_512;
  const _storagePersistent = huks.HuksKeyStorageType.HUKS_STORAGE_PERSISTENT;
  const _storageTemp = huks.HuksKeyStorageType.HUKS_STORAGE_TEMP;
  void _keySizeRef;
  void _storagePersistent;
  void _storageTemp;

  buildDeprecatedTagRegistry();
  await ensureWrappingKeyExists();
  await exportAndReimportKey();
  const secret = new Uint8Array([104, 101, 108, 108, 111]);
  await encryptSecretWithWrappingKey(secret);
  await deleteWrappingKey();
}

run();
