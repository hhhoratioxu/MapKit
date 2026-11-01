// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { Console } from "@nsnanocat/util";
import { Resources } from "@nsringo/mapkit";
import GEOResourceManifest from "../src/class/GEOResourceManifest.mjs";
import { decodeBase64, encodeBase64, validBase64Wire, validWire } from "../src/loon/common.mjs";
import ManifestCache, { CACHE_PREFIX } from "../src/loon/ManifestCache.mjs";
import { processRequest } from "../src/loon/Request.mjs";
import { processResponse } from "../src/loon/Response.mjs";
import { manifest, manifestURL, memoryStore } from "./helpers.mjs";

Console.logLevel = "OFF";

test("Base64 cache probing preserves every framing decision without decoding a body", () => {
	let seed = 20261101;
	for (let trial = 0; trial < 2000; trial++) {
		const bytes =
			trial === 0
				? manifest()
				: Uint8Array.from({ length: (trial % 300) + 1 }, () => {
						seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
						return seed >>> 24;
					});
		const text = Buffer.from(bytes).toString("base64");
		assert.equal(validBase64Wire(text), validWire(bytes), `trial ${trial}`);
		const wrapped = `header:${text}:footer`;
		assert.equal(validBase64Wire(wrapped, 7, 7 + text.length), validWire(bytes));
		assert.deepEqual(decodeBase64(wrapped, 7, 7 + text.length), bytes);
	}
});

for (const text of ["", "A", "AAAA=", "AA=A", "====", "AA==\n", "!AAA", "AA!A", "AAA!", "A==="])
	test(`Base64 probe rejects malformed encoding ${JSON.stringify(text)}`, () => {
		assert.equal(validBase64Wire(text), false);
		assert.equal(decodeBase64(text), null);
	});

test("Base64 probe validates skipped payload characters as well as field headers", () => {
	const encoded = encodeBase64(new Uint8Array([10, 9, ...Array(9).fill(0)]));
	assert.equal(validBase64Wire(encoded), true);
	assert.equal(validBase64Wire(`${encoded.slice(0, 8)}!${encoded.slice(9)}`), false);
});

test("Base64 probe covers valid field types, long varints and the wire field limit", () => {
	const cases = [
		new Uint8Array([8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1]),
		new Uint8Array([9, 0, 0, 0, 0, 0, 0, 0, 0, 21, 0, 0, 0, 0, 26, 0]),
		new Uint8Array([8, ...Array(10).fill(255)]),
		Uint8Array.from({ length: 200000 }, (_, i) => (i % 2 ? 1 : 8)),
		Uint8Array.from({ length: 200002 }, (_, i) => (i % 2 ? 1 : 8)),
	];
	for (const bytes of cases) assert.equal(validBase64Wire(encodeBase64(bytes)), validWire(bytes));
	for (let tiles = 1; tiles < 100; tiles += 9) {
		const bytes = manifest(
			"probe",
			Array.from({ length: tiles }, (_, i) => i + 1),
		);
		assert.equal(validBase64Wire(encodeBase64(bytes)), true);
	}
});

for (const layout of ["canonical", "reordered", "whitespace", "escaped"])
	test(`cache probe and response decoder accept the existing ${layout} JSON format`, () => {
		const store = memoryStore();
		new ManifestCache(store, () => 1000).put(manifestURL, manifest());
		const key = `${CACHE_PREFIX}slot0`;
		const old = JSON.parse(store.read(key));
		if (layout === "reordered") store.write(JSON.stringify({ base64: old.base64, generation: old.generation, key: old.key }), key);
		if (layout === "whitespace") store.write(JSON.stringify(old, null, 2), key);
		if (layout === "escaped") store.write(JSON.stringify(old).replace(old.base64, `\\u${old.base64.charCodeAt(0).toString(16).padStart(4, "0")}${old.base64.slice(1)}`), key);
		const cache = new ManifestCache(store, () => 1001);
		const probe = cache.get(manifestURL, 3600, false);
		assert.equal(probe.body, null);
		assert.equal(probe.hasBody, true);
		assert.deepEqual(cache.get(manifestURL).body, manifest());
		assert.equal(store.data.size, 2);
	});

for (const damage of ["generation", "key", "missing", "invalid-body", "invalid-json", "oversized"])
	test(`cache probe cannot report a hit after ${damage}`, () => {
		const store = memoryStore();
		new ManifestCache(store, () => 1000).put(manifestURL, manifest());
		const key = `${CACHE_PREFIX}slot0`,
			record = JSON.parse(store.read(key));
		if (damage === "generation") record.generation = "another-writer";
		if (damage === "key") record.key = manifestURL.replace("US", "CN");
		if (damage === "invalid-body") record.base64 = "Cgk=";
		store.write(JSON.stringify(record), key);
		if (damage === "missing") store.data.delete(key);
		if (damage === "invalid-json") store.write("invalid", key);
		if (damage === "oversized") store.write("x".repeat(1500000), key);
		const cache = new ManifestCache(store, () => 1001);
		assert.equal(cache.get(manifestURL, 3600, false).hasBody, false);
		assert.equal(cache.get(manifestURL).body, null);
	});

test("cache probe preserves freshness, expiry and clock rollback boundaries", () => {
	const store = memoryStore();
	new ManifestCache(store, () => 100000).put(manifestURL, manifest());
	for (const [now, hasBody] of [
		[99999, false],
		[100000, true],
		[3700000, true],
		[3700001, false],
	])
		assert.equal(new ManifestCache(store, () => now).get(manifestURL, 3600, false).hasBody, hasBody);
});

test("fresh, cooldown and ignored requests finish synchronously; HTTP still waits", async () => {
	const store = memoryStore();
	new ManifestCache(store).put(manifestURL.replace("US", "CN"), manifest());
	assert.equal(processRequest({ url: manifestURL }, {}, store, () => assert.fail()) instanceof Promise, false);
	assert.equal(processRequest({ url: "invalid" }, {}, store, () => assert.fail()) instanceof Promise, false);
	const failed = memoryStore();
	new ManifestCache(failed).fail(manifestURL.replace("US", "CN"));
	assert.equal(processRequest({ url: manifestURL }, {}, failed, () => assert.fail()) instanceof Promise, false);
	let callback;
	const pending = processRequest({ url: manifestURL }, {}, memoryStore(), (_, cb) => {
		callback = cb;
	});
	assert.ok(pending instanceof Promise);
	callback("offline");
	assert.ok((await pending).url);
});

test("corrupt fresh cache is fetched without an ETag instead of treating metadata as a hit", async () => {
	const store = memoryStore();
	new ManifestCache(store).put(manifestURL.replace("US", "CN"), manifest(), "old");
	store.write("{}", `${CACHE_PREFIX}slot0`);
	let requests = 0;
	await processRequest({ url: manifestURL }, {}, store, (options, cb) => {
		requests++;
		assert.equal(options.headers["If-None-Match"], undefined);
		cb(null, { status: 304 });
	});
	assert.equal(requests, 1);
	assert.equal(new ManifestCache(store).get(manifestURL.replace("US", "CN")).hasBody, false);
});

test("shared tile-group tables preserve protobuf bytes and default callers keep independent tables", () => {
	const random = Math.random;
	Math.random = () => 0.5;
	try {
		for (const groups of [0, 1, 10, 100]) {
			const make = () => Resources.create({ tileGroup: Array.from({ length: groups }, (_, identifier) => ({ identifier })) });
			const independent = make(),
				shared = make();
			const tiles = Resources.fromBinary(manifest()).tileSet;
			independent.tileGroup = GEOResourceManifest.tileGroups(independent.tileGroup, tiles, [{}, {}], [{}, {}, {}]);
			const originalGroups = shared.tileGroup;
			shared.tileGroup = GEOResourceManifest.tileGroups(shared.tileGroup, tiles, [{}, {}], [{}, {}, {}], true);
			assert.equal(shared.tileGroup, originalGroups);
			assert.deepEqual(Resources.toBinary(shared), Resources.toBinary(independent));
			if (groups > 1) {
				for (const key of ["tileSet", "attributionIndex", "resourceIndex"]) {
					assert.equal(shared.tileGroup[0][key], shared.tileGroup[1][key]);
					assert.notEqual(independent.tileGroup[0][key], independent.tileGroup[1][key]);
				}
			}
		}
	} finally {
		Math.random = random;
	}
});

test("manifest response returns final bytes synchronously and never modifies persisted source", () => {
	const store = memoryStore();
	new ManifestCache(store).put(manifestURL.replace("US", "CN"), manifest());
	const before = [...store.data];
	const result = processResponse({ url: manifestURL }, { status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: manifest() }, {}, store);
	assert.equal(result instanceof Promise, false);
	assert.ok(result.body instanceof Uint8Array);
	assert.deepEqual([...store.data], before);
});
