import runningLock from '@ohos.runningLock';

declare let _v0: runningLock.RunningLock; _v0.isUsed();
declare let _v1: runningLock.RunningLock; _v1.lock(0);
declare let _v2: runningLock.RunningLock; _v2.unlock();
runningLock.RunningLockType.BACKGROUND;
runningLock.createRunningLock('', runningLock.RunningLockType.BACKGROUND);
runningLock.isRunningLockTypeSupported(runningLock.RunningLockType.BACKGROUND);
