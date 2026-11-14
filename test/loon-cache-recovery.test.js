// Offline-only tests: the actual Loon bundles run in an isolated VM with in-memory I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { Resources, TileSetStyle } from '@nsringo/mapkit';

const bundleDir = process.env.MAPKIT_TEST_BUNDLE_DIR || 'Loon/script';
const manifestURL = 'https://gspe35-ssl.ls.apple.com/geo_manifest/dynamic/config?country_code=CN&os=osx';
const cacheKey = '?country_code=US&os=osx';
const bytes = Resources.toBinary(Resources.create({ releaseInfo: 'offline-valid-manifest' }));
const base64 = Buffer.from(bytes).toString('base64');
const quiet = Object.fromEntries(['log', 'info', 'warn', 'debug', 'error'].map(key => [key, () => {}]));
const makeStore = entry => entry === undefined ? {} : { iRingo: JSON.stringify({ MapKit: { Caches: { [cacheKey]: entry } } }) };
function readEntry(store) {
 const entry = JSON.parse(store.iRingo || '{}').MapKit?.Caches?.[cacheKey];
 return typeof entry === 'string' ? JSON.parse(entry) : entry;
}
function header(headers, name) {
 return Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}
async function run(name, { store = {}, reply, response, url = manifestURL, countryCode = 'CN', headers = {} } = {}) {
 let doneCount = 0, result;
 const requests = [];
 const context = {
  URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, btoa, atob,
  console: quiet,
  $loon: 'Mac offline-test', $script: { startTime: Date.now() },
  $request: { url, method: 'GET', headers },
  $response: response, $argument: { CountryCode: countryCode },
  $persistentStore: { read: key => store[key] ?? null, write: (value, key) => (store[key] = value, true) },
  $httpClient: { get: (request, callback) => {
   requests.push({ ...request, headers: { ...request.headers } });
   if (!reply) throw new Error('Unexpected supplemental request');
   reply(request, callback);
  } },
  $done: value => { doneCount++; result = value; },
 };
 // No fetch, Node globals, real filesystem, real storage, or real network client is exposed.
 vm.runInNewContext(fs.readFileSync(path.join(bundleDir, `${name}.bundle.js`), 'utf8'), context, { timeout: 2000 });
 for (let i = 0; i < 50 && !doneCount; i++) await new Promise(resolve => setTimeout(resolve, 2));
 await new Promise(resolve => setTimeout(resolve, 5));
 assert.equal(doneCount, 1, 'exactly one $done');
 for (const request of requests) {
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('os'), 'osx');
  assert.equal(url.searchParams.get('country_code'), countryCode === 'CN' ? 'US' : 'CN');
 }
 if (result.url) {
  assert.equal(new URL(result.url).searchParams.get('os'), 'osx');
  assert.equal(new URL(result.url).searchParams.get('country_code'), countryCode);
 }
 return { result, requests, store };
}

for (const spelling of ['Etag', 'etag', 'ETag', 'eTaG']) {
 test(`supplemental HTTP 200 accepts ${spelling} header case`, async () => {
  const { requests, store } = await run('request', { reply: (_, cb) => cb(null, { status: 200, headers: { [spelling]: 'fresh-tag' } }, bytes) });
  assert.equal(requests.length, 1);
  assert.equal(header(requests[0].headers, 'If-None-Match'), undefined);
  assert.equal(readEntry(store)?.eTag, 'fresh-tag');
  assert.equal(readEntry(store)?.base64, base64);
 });
}

test('valid supplemental cache sends validator and retains exact store on HTTP 304', async () => {
 const store = makeStore({ eTag: 'valid-tag', base64 });
 const before = JSON.stringify(store);
 const { requests } = await run('request', { store, reply: (_, cb) => cb(null, { status: 304, headers: {} }, new Uint8Array()) });
 assert.equal(requests.length, 1);
 assert.equal(header(requests[0].headers, 'If-None-Match'), 'valid-tag');
 assert.equal(JSON.stringify(store), before);
});

for (const [label, invalidBase64] of [['empty', ''], ['invalid protobuf', '/w==']]) {
 test(`${label} cache is recovered by one unconditional existing supplemental request`, async () => {
  const store = makeStore({ eTag: 'stale-tag', base64: invalidBase64 });
  const { requests } = await run('request', { store, reply: (request, cb) => {
   // A conditional request gets 304, exactly exposing the old non-recovery behavior.
   if (header(request.headers, 'If-None-Match')) cb(null, { status: 304, headers: {} }, new Uint8Array());
   else cb(null, { status: 200, headers: { etag: 'repaired-tag' } }, bytes);
  } });
  assert.equal(requests.length, 1, 'reuse the original fetch, do not add a retry');
  assert.equal(header(requests[0].headers, 'If-None-Match'), undefined);
  assert.equal(readEntry(store)?.eTag, 'repaired-tag');
  assert.equal(readEntry(store)?.base64, base64);
 });
}

for (const failure of ['HTTP 503', 'transport error']) {
 test(`${failure} supplemental fetch remains fail-open without retry or storage write`, async () => {
  const store = {};
  const { result, requests } = await run('request', { store, reply: (_, cb) => failure === 'HTTP 503'
   ? cb(null, { status: 503, headers: {} }, new Uint8Array())
   : cb('offline mock failure', null, null) });
  assert.equal(requests.length, 1);
  assert.deepEqual(store, {});
  assert.equal(result.url, manifestURL);
  const { result: unmodified, requests: responseRequests } = await run('response', { store,
   response: { status: 200, headers: { 'Content-Type': 'application/octet-stream' }, body: bytes } });
  assert.equal(responseRequests.length, 0);
  assert.deepEqual(Buffer.from(unmodified.body), Buffer.from(bytes));
 });
}

test('a supplemental transport error preserves the selected international manifest and its 3D layer', async () => {
 const originalHeaders = { 'If-None-Match': 'cn-entity', Accept: 'application/octet-stream' };
 const { result: main, requests, store } = await run('request', {
  countryCode: 'US',
  headers: { ...originalHeaders },
  reply: (_, cb) => cb('offline transport error', null, null),
 });
 assert.equal(requests.length, 1);
 assert.equal(header(requests[0].headers, 'If-None-Match'), undefined);
 const expected = new URL(manifestURL);
 expected.searchParams.set('country_code', 'US');
 assert.equal(main.url, expected.toString());
 assert.deepEqual({ ...main.headers }, { Accept: originalHeaders.Accept });
 assert.deepEqual(store, {});

 const international = Resources.toBinary(Resources.create({
  tileSet: [{ style: TileSetStyle.SPUTNIK_C3M, validVersion: [{ identifier: 41 }] }],
  tileGroup: [{ identifier: 1, tileSet: [{ tileSetIndex: 0, identifier: 41 }] }],
 }));
 const { result: response, requests: responseRequests } = await run('response', {
  countryCode: 'US', url: main.url, store,
  response: { status: 200, headers: { 'Content-Type': 'application/octet-stream' }, body: international },
 });
 assert.equal(responseRequests.length, 0);
 assert.deepEqual(Buffer.from(response.body), Buffer.from(international));
});
