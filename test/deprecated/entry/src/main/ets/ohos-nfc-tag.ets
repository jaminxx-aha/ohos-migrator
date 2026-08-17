import tag from '@ohos.nfc.tag';

declare let _v0: tag.TagInfo; _v0.supportedProfiles;
declare let _v1: tag.TagSession; _v1.connectTag();
declare let _v2: tag.TagSession; _v2.getMaxSendLength();
tag.getNfcATag({ uid: [], technology: [], supportedProfiles: [] });
tag.getNfcBTag({ uid: [], technology: [], supportedProfiles: [] });
tag.getNfcFTag({ uid: [], technology: [], supportedProfiles: [] });
tag.getNfcVTag({ uid: [], technology: [], supportedProfiles: [] });
declare let _v3: tag.TagSession; _v3.getSendDataTimeout();
declare let _v4: tag.TagSession; _v4.getTagInfo();
declare let _v5: tag.TagSession; _v5.isTagConnected();
declare let _v6: tag.TagSession; _v6.reset();
declare let _v7: tag.TagSession; _v7.sendData([]);
declare let _v8: tag.TagSession; _v8.setSendDataTimeout(0);
