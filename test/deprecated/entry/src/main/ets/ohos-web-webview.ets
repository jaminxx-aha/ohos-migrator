import webview from '@ohos.web.webview';

webview.WebCookieManager.deleteEntireCookie();
webview.WebCookieManager.deleteSessionCookie();
webview.WebCookieManager.getCookie('');
webview.WebCookieManager.setCookie('', '');
declare let _v0: webview.WebviewController; _v0.getHitTest();
declare let _v1: webview.WebviewController; _v1.getHitTestValue();
