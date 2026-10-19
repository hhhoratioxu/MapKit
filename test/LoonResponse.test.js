// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { Storage } from "@nsnanocat/util";
import { Resources } from "@nsringo/mapkit";
import GEOResourceManifest from "../src/class/GEOResourceManifest.mjs";
import Codec from "../src/class/GEOResourceManifestDownload.mjs";
import { processDefaults } from "../src/loon/Defaults.mjs";
import ManifestCache from "../src/loon/ManifestCache.mjs";
import { processResponse } from "../src/loon/Response.mjs";
import { manifest, manifestURL, memoryStore } from "./helpers.mjs";

const response = body => ({ status: 200, headers: { "Content-Type": "application/x-protobuf", "Content-Length": "old", "Content-Encoding": "gzip", ETag: "apple-original", "X-Keep": "same" }, body });
test("manifest response applies source settings and repairs only changed-body headers", async () => {
	const store = memoryStore();
	new ManifestCache(store).put(manifestURL.replace("US", "CN"), manifest("cn"));
	const original = manifest("us"),
		originalCopy = original.slice(),
		headers = response(original).headers;
	const result = await processResponse({ url: manifestURL }, { ...response(original), headers }, {}, store);
	assert.ok(result.body instanceof Uint8Array);
	const decoded = Resources.fromBinary(result.body);
	assert.ok(decoded.tileSet.find(tile => tile.style === 1).baseURL.includes("cn.example"));
	assert.ok(decoded.tileSet.find(tile => tile.style === 14).baseURL.includes("us.example"));
	assert.ok(decoded.urlInfoSet[0].dispatcherURL.url.includes("cn.example"));
	assert.equal(result.headers.ETag, undefined);
	assert.equal(result.headers["Content-Length"], undefined);
	assert.equal(result.headers["Content-Encoding"], undefined);
	assert.equal(result.headers["X-Keep"], "same");
	assert.equal(headers.ETag, "apple-original");
	assert.deepEqual(original, originalCopy);
});
test("missing, stale and invalid source never rewrite primary response bytes", async () => {
	const store = memoryStore(),
		original = manifest();
	assert.deepEqual(await processResponse({ url: manifestURL }, response(original), {}, store), {});
	new ManifestCache(store, () => 1000).put(manifestURL.replace("US", "CN"), manifest());
	assert.deepEqual(await processResponse({ url: manifestURL }, response(original), {}, store, () => 90000000), {});
	new ManifestCache(store).put(manifestURL.replace("US", "CN"), new Uint8Array([8, 1]));
	assert.deepEqual(await processResponse({ url: manifestURL }, response(original), {}, store), {});
	assert.deepEqual(original, manifest());
});
for (const change of ["status", "mime", "malformed", "oversized", "host", "path", "post", "missing-country"])
	test(`response guard preserves ${change}`, async () => {
		const request = { url: manifestURL },
			input = response(manifest());
		if (change === "status") input.status = 503;
		if (change === "mime") input.headers["Content-Type"] = "application/json";
		if (change === "malformed") input.body = new Uint8Array([0]);
		if (change === "oversized") input.body = new Uint8Array(2 * 1024 * 1024 + 1);
		if (change === "host") request.url = request.url.replace("apple.com", "apple.com.evil.example");
		if (change === "path") request.url = request.url.replace("/config?", "/configuration?");
		if (change === "post") request.method = "POST";
		if (change === "missing-country") request.url = request.url.replace("&country_code=US", "");
		assert.deepEqual(await processResponse(request, input, {}, memoryStore()), {});
	});
test("codec preserves unknown protobuf fields and unknown numeric enums", () => {
	const initial = manifest("unknown", [9999]);
	// Unknown field 200, wire type 0, value 123.
	const input = new Uint8Array([...initial, 0xc0, 0x0c, 123]);
	const decoded = Codec.decode(input);
	assert.equal(decoded.tileSet[0].style, 9999);
	const output = Codec.encode(decoded);
	assert.equal(Resources.fromBinary(output).tileSet[0].style, 9999);
	assert.deepEqual(output.slice(-3), new Uint8Array([0xc0, 0x0c, 123]));
});
test("tile-group reference expansion is bounded before allocating repeated references", async () => {
	const store = memoryStore();
	new ManifestCache(store).put(manifestURL.replace("US", "CN"), manifest());
	const target = Resources.fromBinary(
		manifest(
			"us",
			Array.from({ length: 1000 }, (_, index) => index + 1),
		),
	);
	target.tileGroup = Array.from({ length: 300 }, (_, index) => Resources.create({ tileGroup: [{ identifier: index + 1 }] }).tileGroup[0]);
	assert.deepEqual(await processResponse({ url: manifestURL }, response(Resources.toBinary(target)), {}, store), {});
});
test("codec enum conversion keeps nested collection identities", () => {
	const decoded = Codec.decode(manifest());
	const tiles = decoded.tileSet,
		versions = tiles[0].validVersion;
	Codec.encode(decoded);
	assert.equal(decoded.tileSet, tiles);
	assert.equal(decoded.tileSet[0].validVersion, versions);
});
test("shared cache update retains other countries and unrelated settings", async () => {
	const originalSet = Storage.setItem,
		originalGet = Storage.getItem;
	const store = new Map([
		["@iRingo.MapKit.Caches.?country_code=US", { eTag: "us", base64: "AAAA" }],
		["settings", "keep"],
	]);
	Storage.getItem = key => store.get(key);
	Storage.setItem = (key, value) => {
		store.set(key, value);
		return true;
	};
	try {
		assert.equal(await GEOResourceManifest.setCache({}, "?country_code=CN", "cn", manifest()), true);
		assert.equal(store.has("@iRingo.MapKit.Caches"), false);
		assert.equal(store.get("@iRingo.MapKit.Caches.?country_code=US").eTag, "us");
		assert.equal(store.get("settings"), "keep");
	} finally {
		Storage.setItem = originalSet;
		Storage.getItem = originalGet;
	}
});
test("grouped tile merging matches the upstream result on 400 generated layouts", () => {
	const text = execFileSync("git", ["show", "c9af737d97c0b3e26bc2f1083e36564da1b05ba4:src/class/GEOResourceManifest.mjs"], { encoding: "utf8" });
	const start = text.indexOf("static tileSets("),
		end = text.indexOf("\n\t/**", start);
	const Baseline = new Function("Console", `return class { ${text.slice(start, end)} }`)({ info() {} });
	let seed = 123456;
	const random = max => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed % max;
	};
	for (let n = 0; n < 400; n++) {
		const source = Array.from({ length: random(40) }, (_, id) => ({ style: `S${random(10)}`, id: `source${id}` }));
		const target = Array.from({ length: random(40) }, (_, id) => ({ style: `S${random(10)}`, id: `target${id}` }));
		const styles = Array.from({ length: random(15) }, () => `S${random(12)}`);
		assert.deepEqual(GEOResourceManifest.tileSets(source, [...target], [...styles]), Baseline.tileSets(source, [...target], [...styles]));
	}
});
const defaultsRequest = { url: "https://configuration.ls.apple.com/config/defaults" };
const xml = '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>com.apple.GEO</key><dict><key>CountryProviders</key><dict><key>CN</key><dict><key>DrivingMultiWaypointRoutesEnabled</key><false/></dict></dict></dict><key>keep</key><string>original</string></dict></plist>';
test("defaults safely enables upstream features while preserving unrelated fields", () => {
	const input = { status: 200, body: xml, headers: { "Content-Type": "application/xml" } };
	const result = processDefaults(defaultsRequest, input);
	assert.match(result.body, /ShouldEnableLagunaBeach/);
	assert.match(result.body, /original/);
	assert.equal(input.body, xml);
});
for (const body of ["<html>bad</html>", "not xml", "", "<plist><dict><key>com.apple.GEO</key><dict/></dict></plist>", "x".repeat(256 * 1024)])
	test(`unknown defaults safely pass through ${body.length}`, () => assert.deepEqual(processDefaults(defaultsRequest, { status: 200, body, headers: { "Content-Type": "application/xml" } }), {}));
