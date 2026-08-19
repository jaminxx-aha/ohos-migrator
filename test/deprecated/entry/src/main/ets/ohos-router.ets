import router from '@ohos.router';

interface ProductParams {
  productId: string;
}

// Scenario A: legacy navigation helpers (deprecated since 9, kept for old code paths).
function legacyNavigateToLogin(): void {
  router.push({ url: 'pages/Login' });
}

function legacyReplaceWithHome(): void {
  router.replace({ url: 'pages/Home' });
}

// Scenario B: modern push/replace by URL (deprecated since 18, still wired in app shell).
async function navigateToProductDetail(productId: string): Promise<void> {
  try {
    await router.pushUrl({ url: 'pages/ProductDetail', params: { productId } });
  } catch (e) {
    console.error('pushUrl to ProductDetail failed', e);
  }
}

async function replaceWithProductDetail(productId: string): Promise<void> {
  try {
    await router.replaceUrl({ url: 'pages/ProductDetail', params: { productId } });
  } catch (e) {
    console.error('replaceUrl to ProductDetail failed', e);
  }
}

// Scenario C: named-route navigation (deprecated since 18).
async function pushNamedProductPage(routeName: string, params?: ProductParams): Promise<void> {
  try {
    await router.pushNamedRoute({ name: routeName, params });
  } catch (e) {
    console.error('pushNamedRoute failed', e);
  }
}

async function replaceWithNamedPage(routeName: string, params?: ProductParams): Promise<void> {
  try {
    await router.replaceNamedRoute({ name: routeName, params });
  } catch (e) {
    console.error('replaceNamedRoute failed', e);
  }
}

// Scenario D: confirm-before-back guards for unsaved-edit pages.
function enableBackGuard(): void {
  router.enableAlertBeforeBackPage({ message: 'You have unsaved changes. Leave this page?' });
  router.showAlertBeforeBackPage({ message: 'You have unsaved changes. Leave this page?' });
}

function disableBackGuard(): void {
  router.disableAlertBeforeBackPage();
  router.hideAlertBeforeBackPage();
}

// Scenario E: inspect the router stack to drive UI state.
function inspectStack(): void {
  const length: string = router.getLength();
  const params: Object = router.getParams();
  const current = router.getState();
  const topState = router.getStateByIndex(0);
  const detailStates = router.getStateByUrl('pages/ProductDetail');
  console.info('router stack length', length, 'current state', JSON.stringify(current),
    'top state', JSON.stringify(topState), 'detail states', detailStates.length);
  void params;
}

// Scenario F: teardown / exit navigation.
function clearStackAndBack(): void {
  router.clear();
  router.back();
}

async function run(): Promise<void> {
  legacyNavigateToLogin();
  await navigateToProductDetail('sku-12345');
  await replaceWithProductDetail('sku-12345');
  const productParams: ProductParams = { productId: 'sku-12345' };
  await pushNamedProductPage('ProductDetail', productParams);
  await replaceWithNamedPage('ProductDetail', productParams);
  inspectStack();
  enableBackGuard();
  disableBackGuard();
  clearStackAndBack();
}

run();
