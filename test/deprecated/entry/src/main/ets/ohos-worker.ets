import worker from '@ohos.worker';
import { DedicatedWorkerGlobalScope, EventListener, EventTarget } from '@ohos.worker';

let _v0: EventListener;
let _v1: EventTarget;
// let _v2: WorkerGlobalScope;  // omitted: would not compile (2304)
let _v3: DedicatedWorkerGlobalScope;
worker.Worker;
declare let _v4: worker.Worker; _v4.off('');
declare let _v5: worker.Worker; _v5.on;
declare let _v6: worker.Worker; _v6.once;
declare let _v7: worker.Worker; _v7.onerror;
declare let _v8: worker.Worker; _v8.onexit;
declare let _v9: worker.Worker; _v9.onmessage;
declare let _v10: worker.Worker; _v10.onmessageerror;
declare let _v11: worker.Worker; _v11.postMessage;
declare let _v12: worker.Worker; _v12.terminate();
declare let _v13: EventTarget; _v13.addEventListener;
declare let _v14: DedicatedWorkerGlobalScope; _v14.close();
declare let _v15: EventTarget; _v15.dispatchEvent({ type: '', timeStamp: 0 });
// declare let _v16: WorkerGlobalScope; _v16.name;  // omitted: would not compile (2304)
// declare let _v17: WorkerGlobalScope; _v17.onerror;  // omitted: would not compile (2304)
declare let _v18: DedicatedWorkerGlobalScope; _v18.onmessage;
declare let _v19: DedicatedWorkerGlobalScope; _v19.onmessageerror;
worker.parentPort;
declare let _v20: DedicatedWorkerGlobalScope; _v20.postMessage;
declare let _v21: EventTarget; _v21.removeAllListener();
declare let _v22: EventTarget; _v22.removeEventListener('');
// declare let _v23: WorkerGlobalScope; _v23.self;  // omitted: would not compile (2304)
