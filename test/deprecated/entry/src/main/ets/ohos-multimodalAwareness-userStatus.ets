import userStatus from '@ohos.multimodalAwareness.userStatus';

// @ohos.multimodalAwareness.userStatus.userStatus: namespace; detected via the import line; usage omitted
userStatus.UserAgeGroup;
userStatus.UserAgeGroup.CHILD;
userStatus.UserAgeGroup.OTHERS;
let _v0: userStatus.UserClassification;
declare let _v1: userStatus.UserClassification; _v1.ageGroup;
declare let _v2: userStatus.UserClassification; _v2.confidence;
userStatus.off('userAgeGroupDetected');
userStatus.on('userAgeGroupDetected', () => {});
