import avSession from '@ohos.multimedia.avsession';

declare let _v0: avSession.AVSession; _v0.off('playFromAssetId');
declare let _v1: avSession.AVSession; _v1.on('playFromAssetId', () => {});
