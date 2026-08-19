import http from '@ohos.net.http';

// Scenario: fetch a remote JSON document while observing response headers
// via the legacy "headerReceive" event (deprecated since API 8, replaced by
// on('headersReceive')). The deprecated on/off pair is still exercised here
// against a real HttpRequest instance obtained from the non-deprecated
// factory http.createHttp().

async function fetchUserProfile(url: string): Promise<void> {
  const httpRequest = http.createHttp();

  // Register a deprecated headerReceive observer before issuing the request.
  const headerCallback = (err: Error, data: Object): void => {
    if (err) {
      console.error('headerReceive error', err);
      return;
    }
    console.info('response header received', JSON.stringify(data));
  };
  httpRequest.on('headerReceive', headerCallback);

  try {
    const response = await httpRequest.request(url, {
      method: http.RequestMethod.GET,
      header: { 'Content-Type': 'application/json' },
      expectDataType: http.HttpDataType.STRING,
      connectTimeout: 5000,
      readTimeout: 5000,
    });
    console.info('status', response.responseCode);
    console.info('body', String(response.result));
  } catch (e) {
    console.error('request failed', e);
  } finally {
    // Unregister the deprecated headerReceive observer to avoid leaks.
    httpRequest.off('headerReceive', headerCallback);
    httpRequest.destroy();
  }
}

async function run(): Promise<void> {
  await fetchUserProfile('https://example.com/api/users/me');
}

run();
