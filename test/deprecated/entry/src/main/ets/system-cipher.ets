import Cipher from '@system.cipher';
import { CipherAesOptions, CipherResponse, CipherRsaOptions } from '@system.cipher';

// AES-CBC encryption of a sensitive payload using a Base64 key + IV.
async function aesEncrypt(plaintext: string, base64Key: string, base64Iv: string): Promise<string> {
  let resolveFn: (value: string) => void = (value: string): void => { void value; };
  let rejectFn: (reason: Error) => void = (reason: Error): void => { void reason; };
  const pending = new Promise<string>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const options: CipherAesOptions = {
    action: 'encrypt',
    text: plaintext,
    key: base64Key,
    iv: base64Iv,
    ivOffset: '0',
    ivLen: '16',
    transformation: 'AES/CBC/PKCS5Padding',
    success: (data: CipherResponse) => {
      const resultText: string = data.text;
      resolveFn(resultText);
    },
    fail: (data: string, code: number) => {
      rejectFn(new Error(`aes encrypt failed code=${code} data=${data}`));
    },
    complete: () => {
      console.info('aes encrypt complete');
    },
  };

  // Validate the resolved option fields before invoking the cipher.
  console.info(
    'aes cfg',
    options.action,
    options.text.length,
    options.key.length,
    options.iv,
    options.ivOffset,
    options.ivLen,
    options.transformation,
    typeof options.success,
    typeof options.fail,
    typeof options.complete,
  );

  Cipher.aes(options);
  return pending;
}

// RSA-OAEP encryption of a short secret using a public key in PEM form.
async function rsaEncrypt(secret: string, publicKeyPem: string): Promise<string> {
  let resolveFn: (value: string) => void = (value: string): void => { void value; };
  let rejectFn: (reason: Error) => void = (reason: Error): void => { void reason; };
  const pending = new Promise<string>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const options: CipherRsaOptions = {
    action: 'encrypt',
    text: secret,
    key: publicKeyPem,
    transformation: 'RSA/None/OAEPWithSHA256AndMGF1Padding',
    success: (data: CipherResponse) => {
      const resultText: string = data.text;
      resolveFn(resultText);
    },
    fail: (data: string, code: number) => {
      rejectFn(new Error(`rsa encrypt failed code=${code} data=${data}`));
    },
    complete: () => {
      console.info('rsa encrypt complete');
    },
  };

  console.info(
    'rsa cfg',
    options.action,
    options.text.length,
    options.key.length,
    options.transformation,
    typeof options.success,
    typeof options.fail,
    typeof options.complete,
  );

  Cipher.rsa(options);
  return pending;
}

// Round-trip scenario: encrypt a payload with AES, then encrypt a short
// secret with RSA, using the @system.cipher legacy API surface.
async function run(): Promise<void> {
  try {
    const aesKey = 'AAECAwQFBgcICQoLDA0ODx=='; // 16-byte key, Base64
    const aesIv = 'AAECAwQFBgcICQoLDA0ODw=='; // 16-byte IV, Base64
    const encrypted = await aesEncrypt('account=12345&token=ab12', aesKey, aesIv);
    console.info('aes ciphertext length', encrypted.length);

    const rsaPub =
      '-----BEGIN PUBLIC KEY-----\n' +
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SUj5xGq3h3I0lF\n' +
      '-----END PUBLIC KEY-----';
    const rsaCipher = await rsaEncrypt('session-key', rsaPub);
    console.info('rsa ciphertext length', rsaCipher.length);
  } catch (e) {
    console.error('cipher scenario failed', e);
  }
}

run();
