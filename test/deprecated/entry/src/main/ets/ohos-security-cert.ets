import cert from '@ohos.security.cert';

declare let _v0: cert.X509Cert; _v0.getSerialNumber();
let _v1: cert.X509Crl;
declare let _v2: cert.X509Crl; _v2.getEncoded();
declare let _v3: cert.X509Crl; _v3.getIssuerName();
declare let _v4: cert.X509Crl; _v4.getLastUpdate();
declare let _v5: cert.X509Crl; _v5.getNextUpdate();
declare let _v6: cert.X509Crl; _v6.getRevokedCert(0);
declare let _v7: cert.X509Crl; _v7.getRevokedCertWithCert;
declare let _v8: cert.X509Crl; _v8.getRevokedCerts();
declare let _v9: cert.X509Crl; _v9.getSignature();
declare let _v10: cert.X509Crl; _v10.getSignatureAlgName();
declare let _v11: cert.X509Crl; _v11.getSignatureAlgOid();
declare let _v12: cert.X509Crl; _v12.getSignatureAlgParams();
declare let _v13: cert.X509Crl; _v13.getTbsInfo();
declare let _v14: cert.X509Crl; _v14.getType();
declare let _v15: cert.X509Crl; _v15.getVersion();
declare let _v16: cert.X509Crl; _v16.isRevoked;
declare let _v17: cert.X509Crl; _v17.verify;
let _v18: cert.X509CrlEntry;
declare let _v19: cert.X509CrlEntry; _v19.getCertIssuer();
declare let _v20: cert.X509CrlEntry; _v20.getEncoded();
declare let _v21: cert.X509CrlEntry; _v21.getRevocationDate();
declare let _v22: cert.X509CrlEntry; _v22.getSerialNumber();
// cert.createX509Crl({ data: new Uint8Array(0), encodingFormat: cert.EncodingFormat.FORMAT_DER });  // omitted: would not compile (2304)
