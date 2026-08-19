import util from '@ohos.util';

// Scenario 1: Base64 codec reference (class itself is deprecated; methods were not in coverage).
// Instantiating exercises the deprecated class constructor without treating the class as an object.
function encodeWithDeprecatedBase64(raw: string): Uint8Array {
  const helper = new util.Base64();
  const bytes: Uint8Array = helper.encodeSync(new util.TextEncoder().encode(raw));
  console.log('base64 encoded', bytes.length, 'bytes via deprecated Base64');
  return bytes;
}

// Scenario 2: Encode text and inspect an error string.
async function encodeTextAndExplainError(raw: string, errno: number): Promise<void> {
  try {
    const encoder = new util.TextEncoder();
    const bytes: Uint8Array = encoder.encode(raw);
    const errText: string = util.getErrorString(errno);
    const formatted: string = util.printf('encoded %d bytes; errno=%s: %s', bytes.length, errno, errText);
    console.log(formatted);
  } catch (e) {
    console.error('encodeTextAndExplainError failed', e);
  }
}

// Scenario 3: Wrap a node-style callback into a promise-returning function.
async function promisifyCallback(): Promise<void> {
  try {
    const legacyCallback = (err: Object, value: Object): void => {
      console.log('legacy callback', err, value);
    };
    const promised = util.promiseWrapper(legacyCallback);
    console.log('promiseWrapper produced a wrapped function', promised);
  } catch (e) {
    console.error('promisifyCallback failed', e);
  }
}

// Scenario 4: Inspect boxed-primitive object types for runtime introspection.
function inspectBoxedPrimitives(): void {
  try {
    const t = new util.types();
    const boxed: Object = new Boolean(true);
    console.log('isBooleanObject', t.isBooleanObject(boxed));
    console.log('isBoxedPrimitive', t.isBoxedPrimitive(boxed));
    console.log('isNumberObject', t.isNumberObject(new Number(7)));
    console.log('isStringObject', t.isStringObject(new String('hi')));
    console.log('isSymbolObject', t.isSymbolObject(new Object()));
  } catch (e) {
    console.error('inspectBoxedPrimitives failed', e);
  }
}

// Scenario 5: LRU cache lifecycle for a small key-value store.
function exerciseLruCache(): void {
  try {
    const cache = new util.LruBuffer<string, string>(8);
    cache.put('user:1', 'Alice');
    cache.put('user:2', 'Bob');
    cache.put('user:3', 'Carol');
    console.log('length', cache.length);
    console.log('contains user:2', cache.contains('user:2'));
    console.log('get user:1', cache.get('user:1'));
    console.log('capacity', cache.getCapacity());
    console.log('putCount', cache.getPutCount());
    console.log('matchCount', cache.getMatchCount());
    console.log('missCount', cache.getMissCount());
    console.log('createCount', cache.getCreateCount());
    console.log('removalCount', cache.getRemovalCount());
    console.log('isEmpty', cache.isEmpty());
    const allKeys: string[] = cache.keys();
    const allValues: string[] = cache.values();
    const entries = cache.entries();
    console.log('keys', allKeys.length, 'values', allValues.length, 'entries length', Array.from(entries).length);
    const defaulted = cache.createDefault('user:4');
    console.log('createDefault', defaulted);
    cache.afterRemoval(false, 'user:2', 'Bob', 'Bobby');
    console.log('toString', cache.toString());
    cache.updateCapacity(16);
    cache.remove('user:3');
    cache.clear();
  } catch (e) {
    console.error('exerciseLruCache failed', e);
  }
}

// Scenario 6: Rational number comparison and common divisor.
function compareRationals(): void {
  try {
    const a = util.RationalNumber.parseRationalNumber(3, 4);
    const b = util.RationalNumber.parseRationalNumber(2, 3);
    console.log('compareTo', a.compareTo(b));
    console.log('commonDivisor', util.RationalNumber.getCommonDivisor(12, 18));
  } catch (e) {
    console.error('compareRationals failed', e);
  }
}

// Scenario 7: Numeric range operations for input validation bounds.
function exerciseScope(): void {
  try {
    const range = new util.Scope(1, 100);
    console.log('lower', range.getLower());
    console.log('upper', range.getUpper());
    console.log('contains 50', range.contains(50));
    console.log('clamp 150', range.clamp(150));
    const bigger = range.expand(0, 200);
    console.log('expanded', bigger.toString());
    const other = new util.Scope(50, 150);
    const inter = range.intersect(other);
    console.log('intersect', inter.toString());
    console.log('toString', range.toString());
  } catch (e) {
    console.error('exerciseScope failed', e);
  }
}

async function run(): Promise<void> {
  encodeWithDeprecatedBase64('hello world');
  await encodeTextAndExplainError('hello world', 22);
  await promisifyCallback();
  inspectBoxedPrimitives();
  exerciseLruCache();
  compareRationals();
  exerciseScope();
}

run();
