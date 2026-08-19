import Router from '@system.router';
import { BackRouterOptions, DisableAlertBeforeBackPageOptions, EnableAlertBeforeBackPageOptions, ParamsInterface, RouterOptions, RouterState } from '@system.router';

// Inspect the current page-stack state and the params handed to the current page.
function inspectStack(): void {
  const state: RouterState = Router.getState();
  const index: number = state.index;
  const name: string = state.name;
  const path: string = state.path;
  const length: string = Router.getLength();
  const params: ParamsInterface = Router.getParams();
  console.info(`stack length=${length}, top index=${index}, name=${name}, path=${path}, params=${JSON.stringify(params)}`);
}

// Navigate to a detail page, passing a record id as params.
function navigateToDetail(recordId: string): void {
  const opts: RouterOptions = { uri: 'pages/detail/detail', params: { id: recordId } };
  const uri: string = opts.uri;
  const params: Object | undefined = opts.params;
  console.info(`pushing to ${uri} with params=${JSON.stringify(params)}`);
  Router.push(opts);
}

// Replace the current page with the login page (current page is destroyed).
function replaceWithLogin(): void {
  const opts: RouterOptions = { uri: 'pages/login/login', params: { redirect: true } };
  Router.replace(opts);
}

// Return to a specific page in the stack, forwarding a result payload.
function goBackToHome(result: string): void {
  const opts: BackRouterOptions = { uri: 'pages/index/index', params: { result } };
  const uri: string | undefined = opts.uri;
  const params: Object | undefined = opts.params;
  console.info(`backing to ${uri} with params=${JSON.stringify(params)}`);
  Router.back(opts);
}

// Show a confirm dialog before navigating back.
function enableBackConfirm(): void {
  const opts: EnableAlertBeforeBackPageOptions = {
    message: 'Are you sure you want to leave? Unsaved changes will be lost.',
    success: (errMsg: string) => { console.info('alert shown: ' + errMsg); },
    cancel: (errMsg: string) => { console.warn('alert cancelled: ' + errMsg); },
    complete: () => { console.info('alert dialog closed'); },
  };
  const message: string = opts.message;
  const success: ((errMsg: string) => void) | undefined = opts.success;
  const cancel: ((errMsg: string) => void) | undefined = opts.cancel;
  const complete: (() => void) | undefined = opts.complete;
  console.info(`enabling back confirm: ${message}, hasSuccess=${success != null}, hasCancel=${cancel != null}, hasComplete=${complete != null}`);
  Router.enableAlertBeforeBackPage(opts);
}

// Dismiss the confirm dialog previously enabled.
function disableBackConfirm(): void {
  const opts: DisableAlertBeforeBackPageOptions = {
    success: (errMsg: string) => { console.info('alert hidden: ' + errMsg); },
    cancel: (errMsg: string) => { console.warn('hide cancelled: ' + errMsg); },
    complete: () => { console.info('hide dialog closed'); },
  };
  const success: ((errMsg: string) => void) | undefined = opts.success;
  const cancel: ((errMsg: string) => void) | undefined = opts.cancel;
  const complete: (() => void) | undefined = opts.complete;
  console.info(`disabling back confirm: hasSuccess=${success != null}, hasCancel=${cancel != null}, hasComplete=${complete != null}`);
  Router.disableAlertBeforeBackPage(opts);
}

// Clear history, keeping only the top page.
function clearHistory(): void {
  Router.clear();
}

// Entry: a small navigation session.
function run(): void {
  inspectStack();
  navigateToDetail('order-1024');
  enableBackConfirm();
  disableBackConfirm();
  replaceWithLogin();
  goBackToHome('ok');
  clearHistory();
}

run();
