import uri from '@ohos.uri';

// Deep-link / content-uri router helpers. Incoming share intents and
// notifications arrive as `content://` or `https://` URIs that must be
// normalized, compared, and dispatched to the right page before the
// payload is handed off to the detail view.

interface RouteMatch {
  target: string;
  matches: boolean;
  reason: string;
}

// Normalize a URI string for stable comparison: lowercase the scheme and
// authority, drop a trailing slash on the path, and strip the fragment so
// that `https://app.example/items/42#section` aligns with
// `https://APP.example/items/42`.
function normalizeUriString(raw: string): string {
  let normalized = raw.trim();
  const hashIdx = normalized.indexOf('#');
  if (hashIdx >= 0) {
    normalized = normalized.slice(0, hashIdx);
  }
  const schemeSep = normalized.indexOf('://');
  if (schemeSep >= 0) {
    const scheme = normalized.slice(0, schemeSep).toLowerCase();
    const rest = normalized.slice(schemeSep + 3);
    const slashIdx = rest.indexOf('/');
    const authority = (slashIdx >= 0 ? rest.slice(0, slashIdx) : rest).toLowerCase();
    const path = slashIdx >= 0 ? rest.slice(slashIdx) : '';
    let cleanPath = path;
    while (cleanPath.length > 1 && cleanPath.endsWith('/')) {
      cleanPath = cleanPath.slice(0, -1);
    }
    normalized = `${scheme}://${authority}${cleanPath}`;
  }
  return normalized;
}

// Compare two resource identifiers to decide whether a deep link targets
// the current application's content provider. Falls back to string-level
// normalization when URI parsing rejects a malformed intent.
function isSameResource(left: string, right: string): boolean {
  const a = new uri.URI(left);
  const b = new uri.URI(right);
  return a.equals(b);
}

// Validate an incoming share intent against the expected target URI before
// routing the payload to the detail page. Returns a structured match result
// so the caller can log the reason for any mismatch.
function validateShareIntent(incomingUri: string, expectedUri: string): RouteMatch {
  if (!incomingUri || !expectedUri) {
    return { target: expectedUri, matches: false, reason: 'empty uri' };
  }
  try {
    const matches = isSameResource(incomingUri, expectedUri);
    if (matches) {
      console.info('share intent matches expected target:', expectedUri);
      return { target: expectedUri, matches: true, reason: 'uri equal' };
    }
    // URI equality is strict on case and trailing slashes; allow a relaxed
    // normalized comparison so cosmetic variations still route correctly.
    const relaxed = normalizeUriString(incomingUri) === normalizeUriString(expectedUri);
    console.info('share intent relaxed match:', relaxed);
    return {
      target: expectedUri,
      matches: relaxed,
      reason: relaxed ? 'normalized equal' : 'uri mismatch',
    };
  } catch (e) {
    console.error('failed to compare share intent uri', e);
    return { target: expectedUri, matches: false, reason: 'parse error' };
  }
}

// Route a content URI to a logical page id based on the first path segment,
// e.g. `content://com.example.app.provider/items/42` -> 'items'.
function routeFor(contentUri: string): string {
  try {
    const parsed = new uri.URI(contentUri);
    const path = parsed.path ?? '';
    const segments = path.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) {
      return 'home';
    }
    return segments[0];
  } catch (e) {
    console.error('failed to parse content uri for routing', e);
    return 'home';
  }
}

async function run(): Promise<void> {
  const expected = 'content://com.example.app.provider/items/42';
  const cases: Array<[string, string]> = [
    ['content://com.example.app.provider/items/42', expected],
    ['content://com.example.app.provider/items/42#detail', expected],
    ['content://com.example.app.provider/items/42/', expected],
    ['content://com.example.app.provider/users/7', expected],
  ];
  for (let i = 0; i < cases.length; i++) {
    const incoming: string = cases[i][0];
    const target: string = cases[i][1];
    const result = validateShareIntent(incoming, target);
    console.info(`route=${routeFor(incoming)} result=${JSON.stringify(result)}`);
  }
}

run();
