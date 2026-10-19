// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { bytes, cacheKey, decodeBase64, encodeBase64, MAX_CACHE_BYTES, validWire } from "../src/loon/common.mjs";
import ManifestCache, { CACHE_PREFIX } from "../src/loon/ManifestCache.mjs";
import settings from "../src/loon/settings.mjs";
import { manifest, manifestURL, memoryStore } from "./helpers.mjs";

test("cache uses the full canonical query and separates host, OS and country", () => {
	assert.equal(cacheKey(manifestURL), cacheKey(manifestURL.replace("os=ios&os_version=26&country_code=US", "country_code=US&os_version=26&os=ios")));
	for (const changed of [manifestURL.replace("US", "CN"), manifestURL.replace("ios", "watchos"), manifestURL.replace("=26", "=27"), manifestURL.replace("apple.com", "apple.cn")]) assert.notEqual(cacheKey(manifestURL), cacheKey(changed));
	assert.equal(cacheKey(`${manifestURL}&os=watchos`), null);
});
for (const url of [
	"https://evil.example/geo_manifest/dynamic/config",
	manifestURL.replace("https:", "http:"),
	manifestURL.replace("apple.com", "apple.com.evil.example"),
	manifestURL.replace("/config?", "/configuration?"),
	manifestURL.replace("https://", "https://user:password@"),
	`${manifestURL}&x=${"x".repeat(2049)}`,
])
	test(`cache rejects out-of-scope input ${url.slice(0, 85)}`, () => assert.equal(cacheKey(url), null));

for (const length of [1, 2, 3, 4, 8191, 8192, 8193, 65537, MAX_CACHE_BYTES])
	test(`bounded base64 roundtrip ${length}`, () => {
		const input = Uint8Array.from({ length }, (_, index) => index % 256);
		const encoded = encodeBase64(input);
		assert.equal(encoded, Buffer.from(input).toString("base64"));
		assert.deepEqual(decodeBase64(encoded), input);
	});
for (const value of ["A", "AAAA=", "!!==", "AA=A", "====", "A".repeat(Math.ceil(MAX_CACHE_BYTES / 3) * 4 + 4)]) test(`base64 rejects malformed or oversized data ${value.length}`, () => assert.equal(decodeBase64(value), null));

test("bytes retain typed-array views without a copy", () => {
	const value = new Uint8Array(20),
		view = value.subarray(3, 9);
	assert.equal(bytes(view), view);
	assert.equal(bytes(new DataView(value.buffer, 3, 6)).buffer, value.buffer);
	assert.equal(bytes("binary text"), null);
});
test("protobuf wire validation accepts actual generated manifests", () => assert.equal(validWire(manifest()), true));
for (const input of [[], [0], [255], [10, 255], [10, 9, 1], [8, 128], [8, ...Array(10).fill(255)], [11], [13, 1]]) test(`wire rejects malformed fields ${input.join(",")}`, () => assert.equal(validWire(new Uint8Array(input)), false));

test("native cache preserves unrelated data and is bounded to four slots", () => {
	const store = memoryStore();
	store.write("unchanged", "iRingo");
	const cache = new ManifestCache(store, () => 100000);
	for (let i = 0; i < 12; i++) assert.equal(cache.put(`${manifestURL}&hardware=test${i}`, manifest(), "etag"), true);
	assert.equal(store.read("iRingo"), "unchanged");
	assert.equal(store.data.size, 6);
	assert.equal(JSON.parse(store.read(`${CACHE_PREFIX}index`)).length, 4);
});
test("cache isolates country entries and does not evict the other country on update", () => {
	const store = memoryStore(),
		cache = new ManifestCache(store, () => 100000);
	cache.put(manifestURL, manifest("us"), "us");
	cache.put(manifestURL.replace("US", "CN"), manifest("cn"), "cn");
	cache.put(manifestURL, manifest("updated"), "updated");
	assert.equal(new ManifestCache(store, () => 100001).get(manifestURL.replace("US", "CN")).etag, "cn");
});
test("ETag revalidation refreshes age and expired source bodies are excluded", () => {
	let now = 100000;
	const cache = new ManifestCache(memoryStore(), () => now);
	cache.put(manifestURL, manifest(), '"etag"');
	now += 3600001;
	assert.equal(cache.get(manifestURL, 3600).body, null);
	const entry = cache.get(manifestURL);
	assert.equal(cache.touch(manifestURL, "other-writer"), false);
	assert.equal(cache.touch(manifestURL, entry.generation), true);
	assert.ok(cache.get(manifestURL, 3600).body);
});
test("concurrent slot replacement is treated as a miss", () => {
	const store = memoryStore(),
		cache = new ManifestCache(store, () => 100000);
	cache.put(manifestURL, manifest());
	const entry = cache.get(manifestURL);
	store.write(JSON.stringify({ key: "other-country", generation: entry.generation, base64: encodeBase64(manifest()) }), `${CACHE_PREFIX}slot${entry.slot}`);
	assert.equal(new ManifestCache(store, () => 100001).get(manifestURL).body, null);
});
test("store read/write failures do not throw or delete other plugin data", () => {
	const cache = new ManifestCache({
		read() {
			throw new Error("disk");
		},
		write() {
			throw new Error("disk");
		},
	});
	assert.equal(cache.get(manifestURL), null);
	assert.equal(cache.put(manifestURL, manifest()), false);
	assert.equal(cache.fail(manifestURL), false);
});
test("invalid cache index cannot select arbitrary storage keys", () => {
	const store = memoryStore();
	store.write(JSON.stringify([{ slot: "iRingo", key: manifestURL }]), `${CACHE_PREFIX}index`);
	assert.equal(new ManifestCache(store).get(manifestURL), null);
});
test("settings validate native parameter types and clamp work budgets", () => {
	const a = settings({ CountryCode: "EVIL", CacheTTL: "Infinity", TimeoutMs: 999999, StaleHours: -1, Diagnostics: "true", Map: "KR" });
	assert.equal(a.GeoManifest.Dynamic.Config.CountryCode, "US");
	assert.equal(a.CacheTTL, 3600);
	assert.equal(a.TimeoutMs, 6000);
	assert.equal(a.StaleHours, 0);
	assert.equal(a.Diagnostics, false);
	assert.equal(a.TileSet.Map, "CN");
	assert.equal(settings({ CacheTTL: 0 }).CacheTTL, 0);
	assert.equal(settings().Config.Announcements.Environment, "AUTO");
});
