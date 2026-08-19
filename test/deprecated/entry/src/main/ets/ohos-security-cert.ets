import cert from '@ohos.security.cert';
import cryptoFramework from '@ohos.security.cryptoFramework';

// Minimal DER blobs. In production these would be real certificate / CRL bytes
// fetched from the network or a local trust store.
const CERT_DER: Uint8Array = new Uint8Array([0x30, 0x82, 0x03, 0x50, 0x02, 0x01, 0x02]);
const CRL_DER: Uint8Array = new Uint8Array([0x30, 0x82, 0x01, 0xc2, 0x30, 0x82, 0x01, 0x4a]);

function derBlob(data: Uint8Array): cert.EncodingBlob {
  return { data, encodingFormat: cert.EncodingFormat.FORMAT_DER };
}

// Load an X509 certificate through the non-deprecated factory.
async function loadCertificate(): Promise<cert.X509Cert> {
  return await cert.createX509Cert(derBlob(CERT_DER));
}

// Load a CRL through the non-deprecated factory and view it through the legacy
// X509Crl type so the platform's deprecated (since 11) accessors are exercised.
async function loadLegacyCrl(): Promise<cert.X509Crl> {
  const crl = await cert.createX509CRL(derBlob(CRL_DER));
  return crl as object as cert.X509Crl;
}

// Inspect a revoked-certificate entry using the deprecated X509CrlEntry accessors.
async function inspectCrlEntry(entry: cert.X509CrlEntry): Promise<void> {
  const serial: number = entry.getSerialNumber();
  const revokedAt: string = entry.getRevocationDate();
  const issuer = entry.getCertIssuer();
  const encoded = await entry.getEncoded();
  console.info(`revoked cert #${serial} at ${revokedAt}; issuer=${issuer.data.length}B, entry=${encoded.data.length}B`);
}

// Verify a CRL's signature against an issuer public key.
async function verifyCrlSignature(crl: cert.X509Crl, pubKey: cryptoFramework.PubKey): Promise<void> {
  await crl.verify(pubKey);
}

// Walk the revoked-certificate list of a CRL and report metadata, mirroring a
// trust-validation step that an MDM / TLS gateway might run before accepting a peer.
async function reviewRevokedCertificates(): Promise<void> {
  const x509Cert = await loadCertificate();
  const crl = await loadLegacyCrl();

  // CRL-level metadata (deprecated since 11 accessors on the legacy X509Crl).
  const type: string = crl.getType();
  const version: number = crl.getVersion();
  const issuerName = crl.getIssuerName();
  const lastUpdate: string = crl.getLastUpdate();
  const nextUpdate: string = crl.getNextUpdate();
  const signature = crl.getSignature();
  const sigAlgName: string = crl.getSignatureAlgName();
  const sigAlgOid: string = crl.getSignatureAlgOid();
  const sigAlgParams = crl.getSignatureAlgParams();
  const tbsInfo = crl.getTbsInfo();
  const crlEncoded = await crl.getEncoded();
  console.info(`CRL type=${type} v${version} issuer=${issuerName.data.length}B last=${lastUpdate} next=${nextUpdate}`);
  console.info(`sig=${signature.data.length}B alg=${sigAlgName}(${sigAlgOid}) params=${sigAlgParams.data.length}B tbs=${tbsInfo.data.length}B der=${crlEncoded.data.length}B`);

  // Enumerate every revoked entry, then drill into specific entries by serial / by cert.
  const allEntries: Array<cert.X509CrlEntry> = await crl.getRevokedCerts();
  for (const entry of allEntries) {
    await inspectCrlEntry(entry);
  }

  const certSerial: number = x509Cert.getSerialNumber();
  const bySerial: cert.X509CrlEntry = crl.getRevokedCert(certSerial);
  await inspectCrlEntry(bySerial);

  const byCert: cert.X509CrlEntry = crl.getRevokedCertWithCert(x509Cert);
  await inspectCrlEntry(byCert);

  const revoked: boolean = crl.isRevoked(x509Cert);
  console.info(`peer cert (serial ${certSerial}) revoked=${revoked}`);

  // Verify the CRL signature against the issuer's public key.
  const keyPair = await cryptoFramework.createAsyKeyGenerator('RSA2048').generateKeyPair();
  try {
    await verifyCrlSignature(crl, keyPair.pubKey);
  } catch (e) {
    console.error('CRL signature verification failed', e);
  }
}

async function run(): Promise<void> {
  try {
    await reviewRevokedCertificates();
  } catch (e) {
    console.error('CRL review failed', e);
  }
}

run();
