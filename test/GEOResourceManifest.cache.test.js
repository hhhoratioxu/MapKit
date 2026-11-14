import test from "node:test";
import assert from "node:assert/strict";
import { Resources } from "@nsringo/mapkit";
import GEOResourceManifest from "../src/class/GEOResourceManifest.mjs";
import GEOResourceManifestDownload from "../src/class/GEOResourceManifestDownload.mjs";

const query = "?country_code=US&os=osx";
const key = `@iRingo.MapKit.Caches.${query}`;
const validEntry = {
	eTag: "offline-tag",
	base64: Buffer.from(Resources.toBinary(Resources.create({ releaseInfo: "offline-cache" }))).toString("base64"),
};
function memoryKV(entry) {
	let reads = 0;
	return {
		get reads() { return reads; },
		async getItem(actualKey) { assert.equal(actualKey, key); reads++; return entry; },
		async setItem() { throw new Error("Cache validation must not write storage"); },
	};
}

test("conditional cache validation accepts valid KV entries without storage writes", async () => {
	const KV = memoryKV(validEntry);
	assert.equal(await GEOResourceManifest.getCache({}, query, KV, true), validEntry);
	assert.equal(KV.reads, 1);
});

test("conditional cache validation rejects empty, malformed base64 and malformed protobuf", async () => {
	for (const base64 of ["", "!invalid!", "/w==", "CgU="]) {
		const entry = { eTag: "invalid-tag", base64 };
		const before = structuredClone(entry);
		const KV = memoryKV(entry);
		assert.equal(await GEOResourceManifest.getCache({}, query, KV, true), undefined);
		assert.deepEqual(entry, before);
		assert.equal(KV.reads, 1);
	}
});

test("normal response cache decoding reads and decodes exactly once", async () => {
	const KV = memoryKV(validEntry);
	const originalDecode = GEOResourceManifestDownload.decode;
	let decodes = 0;
	GEOResourceManifestDownload.decode = function (bytes) { decodes++; return originalDecode.call(this, bytes); };
	try {
		const result = await GEOResourceManifest.decodeCache({}, query, KV);
		assert.equal(result.releaseInfo, "offline-cache");
		assert.equal(decodes, 1);
		assert.equal(KV.reads, 1);
	} finally {
		GEOResourceManifestDownload.decode = originalDecode;
	}
});

test("conditional preflight never constructs the full response message", async () => {
	const originalDecode = GEOResourceManifestDownload.decode;
	GEOResourceManifestDownload.decode = () => { throw new Error("Full message decoding must not run during preflight"); };
	try {
		const KV = memoryKV(validEntry);
		assert.equal(await GEOResourceManifest.getCache({}, query, KV, true), validEntry);
		assert.equal(KV.reads, 1);
	} finally {
		GEOResourceManifestDownload.decode = originalDecode;
	}
});
