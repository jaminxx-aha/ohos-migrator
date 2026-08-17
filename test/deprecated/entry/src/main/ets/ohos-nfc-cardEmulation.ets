import cardEmulation from '@ohos.nfc.cardEmulation';

cardEmulation.FeatureType;
cardEmulation.FeatureType.ESE;
cardEmulation.FeatureType.HCE;
cardEmulation.FeatureType.UICC;
declare let _v0: cardEmulation.HceService; _v0.sendResponse([]);
declare let _v1: cardEmulation.HceService; _v1.startHCE([]);
declare let _v2: cardEmulation.HceService; _v2.stopHCE();
cardEmulation.isSupported(0);
