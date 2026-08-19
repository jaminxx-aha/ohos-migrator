import worker from '@ohos.worker';
import { DedicatedWorkerGlobalScope, ErrorEvent, Event, EventListener, EventTarget, MessageEvent } from '@ohos.worker';

const WORKER_SCRIPT = 'entry/ets/workers/task-worker.js';

// Host-thread side: spawn a deprecated Worker to offload a chunk of work,
// wire up lifecycle handlers, exchange a message, then tear it down.
async function runHostWorker(): Promise<void> {
  const w = new worker.Worker(WORKER_SCRIPT);

  w.onmessage = (event: MessageEvent<Object>) => {
    console.info('host received result:', event.data);
  };
  w.onerror = (err: ErrorEvent) => {
    console.error('worker raised an error:', err.message);
  };
  w.onexit = (code: number) => {
    console.info('worker exited with code', code);
  };
  w.onmessageerror = (event: MessageEvent<Object>) => {
    console.error('host received an unserializable message:', event.data);
  };

  const onMessage: EventListener = () => { /* handle message */ };
  // The deprecated Worker class nominally `implements EventTarget` but its
  // .d.ts body does not redeclare the EventTarget members, so `w` is not
  // structurally assignable to EventTarget. Use an EventTarget-typed stub
  // so the deprecated EventTarget.* methods are still exercised for coverage.
  const eventTarget: EventTarget = {
    addEventListener(_type: string, _listener: EventListener): void {},
    dispatchEvent(_event: Event): boolean { return false; },
    removeEventListener(_type: string, _callback?: EventListener): void {},
    removeAllListener(): void {},
  };
  eventTarget.addEventListener('message', onMessage);
  eventTarget.dispatchEvent({ type: 'message', timeStamp: 0 });

  w.on('message', onMessage);
  w.once('message', onMessage);

  try {
    w.postMessage({ cmd: 'start', payload: { rows: 1000 } });
  } catch (e) {
    console.error('postMessage to worker failed', e);
  }

  w.off('message', onMessage);
  eventTarget.removeEventListener('message', onMessage);
  eventTarget.removeAllListener();

  try {
    w.terminate();
  } catch (e) {
    console.error('terminate failed', e);
  }
}

// Worker-thread side: the body of the spawned worker script. Uses the
// deprecated DedicatedWorkerGlobalScope (exposed as worker.parentPort) to
// receive a task, post a result back, and shut itself down.
async function runWorkerSide(): Promise<void> {
  const scope: DedicatedWorkerGlobalScope = worker.parentPort;

  scope.onmessage = (event: MessageEvent<Object>) => {
    console.info('worker received task:', event.data);
    scope.postMessage({ result: 'done', input: event.data });
  };
  scope.onmessageerror = (event: MessageEvent<Object>) => {
    console.error('worker could not deserialize message:', event.data);
  };

  try {
    scope.postMessage({ status: 'ready' });
  } catch (e) {
    console.error('worker postMessage failed', e);
  }

  scope.close();
}

async function run(): Promise<void> {
  await runHostWorker();
  await runWorkerSide();
}

run();
