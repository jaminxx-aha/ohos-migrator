import url from '@ohos.url';

// Scenario: a campaign-aware URL/query-string builder for a commerce share service.
// It composes shareable links, round-trips them through URLSearchParams, audits the
// resulting query string, and normalises/de-duplicates parameters before emitting a
// final link. All URLSearchParams usage is the deprecated (since 9) surface; the
// module is intentionally written against that surface end-to-end.

interface CampaignLink {
  productUrl: url.URL;
  serializedQuery: string;
  paramCount: number;
}

interface AuditEntry {
  name: string;
  firstValue: string | null;
  allValues: string[];
}

const DEFAULT_BASE: string = 'https://shop.example.com/product';

// Build a shareable product link, layering in identity, campaign and locale params.
async function buildCampaignLink(base: string, sku: string, locale: string): Promise<CampaignLink> {
  const productUrl: url.URL = new url.URL(`${base}/${sku}`);
  // URL.searchParams (deprecated since 9) — grab the live query params accessor.
  const params: url.URLSearchParams = productUrl.searchParams;

  // URLSearchParams.set (deprecated) — identity / canonical params, single-valued.
  params.set('id', sku);
  params.set('locale', locale);
  params.set('currency', locale === 'en-US' ? 'USD' : 'EUR');
  params.set('version', '2026.08');

  // URLSearchParams.append (deprecated) — multi-valued campaign attribution.
  params.append('ref', 'newsletter');
  params.append('ref', 'summer-sale');
  params.append('utm_source', 'email');
  params.append('utm_source', 'push');

  // URLSearchParams.sort (deprecated) — stable ordering for cache keys.
  params.sort();

  // URLSearchParams.toString (deprecated) — snapshot the serialized query.
  const serializedQuery: string = params.toString();
  console.info('campaign query string:', serializedQuery);

  // Count keys via the iterator surface so we can sanity-check the caller.
  let paramCount: number = 0;
  for (const _ of params.keys()) {
    paramCount += 1;
  }

  return { productUrl, serializedQuery, paramCount };
}

// Read back a link: audit every parameter, return a structured audit list.
async function auditLink(link: url.URL): Promise<AuditEntry[]> {
  const params: url.URLSearchParams = link.searchParams;
  const audit: AuditEntry[] = [];

  // URLSearchParams.has / get / getAll (deprecated) — read multi-valued params.
  const names: string[] = [];
  // URLSearchParams.keys (deprecated) — collect distinct names.
  for (const k of params.keys()) {
    if (names.indexOf(k) === -1) {
      names.push(k);
    }
  }

  // URLSearchParams.values (deprecated) — materialise all values for size logging.
  let valueTotal: number = 0;
  for (const v of params.values()) {
    valueTotal += v.length;
  }
  console.info('total value chars:', valueTotal);

  // URLSearchParams.entries (deprecated) — iterate ordered [name, value] pairs.
  const entries = params.entries();
  for (const entry of entries) {
    const name: string = entry[0];
    const value: string = entry[1];
    console.info('entry:', name, '=', value);
  }

  for (const name of names) {
    // URLSearchParams.has (deprecated) — guard reads.
    if (!params.has(name)) {
      continue;
    }
    const first: string | null = params.get(name);
    const all: string[] = params.getAll(name);
    audit.push({ name, firstValue: first, allValues: all });
  }

  // URLSearchParams.forEach (deprecated) — callback-style traversal with thisArg.
  const collected: string[] = [];
  params.forEach((value: string, key: string): void => {
    collected.push(`${key}=${value}`);
  });
  console.info('forEach collected:', collected.length, 'pairs');

  return audit;
}

// Normalise a link: drop noisy params and re-sort so the output is stable & cacheable.
async function normaliseLink(link: url.URL, dropPrefix: string): Promise<url.URL> {
  const params: url.URLSearchParams = link.searchParams;

  // URLSearchParams.delete (deprecated) — prune any name starting with dropPrefix.
  const toDelete: string[] = [];
  for (const k of params.keys()) {
    if (k.indexOf(dropPrefix) === 0) {
      toDelete.push(k);
    }
  }
  for (const k of toDelete) {
    params.delete(k);
  }

  // URLSearchParams.has (deprecated) — verify the pruning landed.
  console.info('after normalise, has ref:', params.has('ref'));

  // URLSearchParams.sort (deprecated) — re-stabilise after mutation.
  params.sort();

  return link;
}

// Round-trip: rebuild a link from a serialized query and confirm equality of values.
async function roundTripQuery(serialized: string, sku: string, base: string): Promise<boolean> {
  // URLSearchParams constructor (deprecated) — parse from a query string.
  const parsed: url.URLSearchParams = new url.URLSearchParams(serialized);

  // Re-attach to a fresh URL via URL.searchParams (deprecated).
  const rebuilt: url.URL = new url.URL(`${base}/${sku}`);
  // URLSearchParams.forEach (deprecated) — copy every pair across.
  parsed.forEach((value: string, key: string): void => {
    rebuilt.searchParams.append(key, value);
  });

  // URLSearchParams.toString (deprecated) — compare canonical forms.
  const rebuiltQuery: string = rebuilt.searchParams.toString();
  console.info('round-trip query:', rebuiltQuery);
  return rebuiltQuery === serialized;
}

async function run(): Promise<void> {
  try {
    const built: CampaignLink = await buildCampaignLink(DEFAULT_BASE, 'sku-1280', 'en-US');
    console.info('built param count:', built.paramCount);

    const audit: AuditEntry[] = await auditLink(built.productUrl);
    console.info('audit entries:', audit.length);

    const normalised: url.URL = await normaliseLink(built.productUrl, 'ref');
    console.info('normalised href:', normalised.toString());

    const ok: boolean = await roundTripQuery(built.serializedQuery, 'sku-1280', DEFAULT_BASE);
    if (!ok) {
      console.warn('round-trip mismatch detected');
    }
  } catch (e) {
    console.error('url scenario failed', e);
  }
}

run();
