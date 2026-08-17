import router from '@ohos.router';

router.back();
router.clear();
router.disableAlertBeforeBackPage();
router.enableAlertBeforeBackPage({ message: '' });
router.getLength();
router.getParams();
router.getState();
router.getStateByIndex(0);
router.getStateByUrl('');
router.hideAlertBeforeBackPage();
router.push({ url: '' });
router.pushNamedRoute({ name: '' });
router.pushUrl({ url: '' });
router.replace({ url: '' });
router.replaceNamedRoute({ name: '' });
router.replaceUrl({ url: '' });
router.showAlertBeforeBackPage({ message: '' });
