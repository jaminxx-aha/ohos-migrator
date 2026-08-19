import webview from '@ohos.web.webview';

const SITE_URL = 'https://www.example.com';
const SESSION_COOKIE = 'sessionToken=abc123; Path=/; Secure; HttpOnly';

// Cookie management scenario: configure and clear cookies for a site.
function manageSiteCookies(): void {
  // Set a session cookie before loading the site so auth state persists.
  webview.WebCookieManager.setCookie(SITE_URL, SESSION_COOKIE);
  // Read back the cookies that would be sent with the next request to this URL.
  const cookieHeader: string = webview.WebCookieManager.getCookie(SITE_URL);
  if (cookieHeader.length === 0) {
    console.warn('no cookies registered for', SITE_URL);
  }
  // On logout, drop session-only cookies but keep persistent ones.
  webview.WebCookieManager.deleteSessionCookie();
  // On full reset, wipe everything for the site.
  webview.WebCookieManager.deleteEntireCookie();
}

// Hit-test scenario: inspect what the user tapped inside the web component.
async function inspectLastHitTarget(): Promise<void> {
  const controller: webview.WebviewController = new webview.WebviewController();
  try {
    // Determine the category of element under the last tap (link/image/etc).
    const hitType: webview.WebHitTestType = controller.getHitTest();
    console.info('last hit test type:', hitType);
    // Pull detailed info about that element for analytics.
    const hitValue: webview.HitTestValue = controller.getHitTestValue();
    console.info('hit target extra:', hitValue.extra);
  } catch (e) {
    // 17100001: controller not yet bound to a Web component.
    console.error('hit test failed before Web component attached', e);
  }
}

async function run(): Promise<void> {
  manageSiteCookies();
  await inspectLastHitTarget();
}

run();
