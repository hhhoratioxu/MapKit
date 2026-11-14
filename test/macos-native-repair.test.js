import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BinaryWriter, WireType } from "@protobuf-ts/runtime";
import { Resources, TileSetStyle } from "@nsringo/mapkit";
import { atomicReplace, compose, readEnvelope, replacePayload, resolveArguments, restoreCacheFiles, validateResources } from "../scripts/macos-native-repair.mjs";

const argumentsObject = {
	CountryCode: "US", Environment: "AUTO", Dispatcher: "AutoNavi", Directions: "AutoNavi", RAP: "Apple", LocationShift: "AUTO",
	Map: "CN", Satellite2D: "CN", Satellite3D: "XX", Traffic: "CN", POI: "CN", Flyover: "XX", Munin: "XX", Road: "CN", Earth: "CN", Transit: "CN",
};

test("native preparation preserves every explicit existing argument and rejects silent fallback", () => {
	assert.deepEqual(resolveArguments(argumentsObject), argumentsObject);
	assert.deepEqual(resolveArguments({ arguments: argumentsObject }), argumentsObject);
	assert.throws(() => resolveArguments({ ...argumentsObject, Satellite2D: "unsupported" }), /Satellite2D/);
	const incomplete = { ...argumentsObject };
	delete incomplete.Dispatcher;
	assert.throws(() => resolveArguments(incomplete), /Dispatcher/);
});

test("native composition retains the selected CN satellite source across different query orders", async () => {
	const targetURL = new URL("https://gspe35-ssl.ls.apple.com/geo_manifest/dynamic/config?application=geod&country_code=US&os=osx");
	const sourceURL = new URL("https://gspe35-ssl.ls.apple.com/geo_manifest/dynamic/config?os=osx&country_code=CN&application=geod");
	const target = Resources.toBinary(Resources.create({
		tileSet: [
			{ style: TileSetStyle.RASTER_SATELLITE, validVersion: [{ identifier: 777 }] },
			{ style: TileSetStyle.SPUTNIK_C3M, validVersion: [{ identifier: 1 }] },
		],
		tileGroup: [{ identifier: 1, tileSet: [{ tileSetIndex: 0, identifier: 777 }, { tileSetIndex: 1, identifier: 1 }] }],
	}));
	const source = Resources.toBinary(Resources.create({
		tileSet: [{ style: TileSetStyle.RASTER_SATELLITE, validVersion: [{ identifier: 68 }] }],
		tileGroup: [{ identifier: 1, tileSet: [{ tileSetIndex: 0, identifier: 68 }] }],
	}));
	const body = await compose(targetURL, target, sourceURL, source, argumentsObject);
	const result = validateResources(body);
	assert.equal(result.tileSet.find(tile => tile.style === TileSetStyle.RASTER_SATELLITE).validVersion[0].identifier, 68);
	assert.ok(result.tileSet.some(tile => tile.style === TileSetStyle.SPUTNIK_C3M));
});

test("native payload replacement preserves origin, regional metadata and unknown envelope fields", () => {
	const original = new BinaryWriter()
		.tag(1, WireType.LengthDelimited).bytes(Uint8Array.of(8, 1))
		.tag(3, WireType.LengthDelimited).bytes(Uint8Array.of(12, 34, 56))
		.tag(2, WireType.LengthDelimited).string('"https://gspe35-ssl.ls.apple.com/geo_manifest/dynamic/config?country_code=CN"')
		.tag(90, WireType.Varint).uint32(400)
		.finish();
	const replacement = Uint8Array.of(8, 2, 16, 0);
	const result = readEnvelope(replacePayload(original, replacement));
	const before = readEnvelope(original);
	assert.deepEqual(Buffer.from(result[0].value), Buffer.from(replacement));
	assert.deepEqual(result.slice(1).map(field => Buffer.from(field.wireBytes)), before.slice(1).map(field => Buffer.from(field.wireBytes)));
});

test("ambiguous or wrongly encoded native resource envelopes are rejected", () => {
	assert.throws(() => readEnvelope(new Uint8Array()), /Ambiguous/);
	const duplicate = new BinaryWriter().tag(1, 2).bytes(Uint8Array.of(8, 1)).tag(1, 2).bytes(Uint8Array.of(8, 2)).finish();
	assert.throws(() => readEnvelope(duplicate), /Ambiguous/);
	const wrongWire = new BinaryWriter().tag(1, 0).uint32(1).finish();
	assert.throws(() => readEnvelope(wrongWire), /Unsupported/);
});

test("native layer validation checks selected versions including zero and rejects broken references", () => {
	const manifest = Resources.create({
		tileSet: [{ style: TileSetStyle.SPUTNIK_DSM_GLOBAL, validVersion: [{ identifier: 0 }] }],
		tileGroup: [{ identifier: 1, tileSet: [{ tileSetIndex: 0, identifier: 0 }] }],
	});
	assert.equal(validateResources(Resources.toBinary(manifest)).tileSet.length, 1);
	manifest.tileGroup[0].tileSet[0].identifier = 1;
	assert.throws(() => validateResources(Resources.toBinary(manifest)), /Invalid tile group reference/);
	manifest.tileGroup[0].tileSet[0].identifier = 0;
	manifest.tileGroup[0].resourceIndex = [12];
	assert.throws(() => validateResources(Resources.toBinary(manifest)), /Invalid resource reference/);
});

test("native cache writes keep file permissions and refuse a changed source", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapkit-native-atomic-"));
	try {
		const file = path.join(directory, "cache");
		fs.writeFileSync(file, "original", { mode: 0o640 });
		assert.throws(() => atomicReplace(file, Buffer.from("stale"), Buffer.from("candidate")), /changed before/);
		assert.equal(fs.readFileSync(file, "utf8"), "original");
		atomicReplace(file, Buffer.from("original"), Buffer.from("candidate"));
		assert.equal(fs.readFileSync(file, "utf8"), "candidate");
		assert.equal(fs.statSync(file).mode & 0o777, 0o640);
		assert.deepEqual(fs.readdirSync(directory), ["cache"]);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("native rollback restores the pair and preserves independently updated manifest metadata", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapkit-native-restore-"));
	try {
		const original = Buffer.from(new BinaryWriter().tag(1, 2).bytes(Uint8Array.of(8, 1)).tag(2, 2).string("original metadata").finish());
		const candidate = replacePayload(original, Uint8Array.of(8, 2));
		const independentMetadata = Buffer.from(new BinaryWriter().tag(99, WireType.Varint).uint32(7).finish());
		const files = ["manifest", "defaults"].map(name => ({ name, file: path.join(directory, `${name}.live`) }));
		fs.writeFileSync(path.join(directory, "manifest.original"), original);
		fs.writeFileSync(path.join(directory, "manifest.candidate"), candidate);
		fs.writeFileSync(files[0].file, Buffer.concat([candidate, independentMetadata]));
		fs.writeFileSync(path.join(directory, "defaults.original"), "old defaults");
		fs.writeFileSync(path.join(directory, "defaults.candidate"), "new defaults");
		fs.writeFileSync(files[1].file, "new defaults");
		restoreCacheFiles(directory, { files });
		assert.deepEqual(fs.readFileSync(files[0].file), Buffer.concat([original, independentMetadata]));
		assert.equal(fs.readFileSync(files[1].file, "utf8"), "old defaults");
		const newerNative = replacePayload(original, Uint8Array.of(8, 3));
		fs.writeFileSync(files[0].file, newerNative);
		restoreCacheFiles(directory, { files });
		assert.deepEqual(fs.readFileSync(files[0].file), newerNative);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("native flag rollback preserves the original plist value type and independent changes", { skip: process.platform !== "darwin" }, () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapkit-native-plist-"));
	try {
		const key = "com\\.apple\\.GEO.CountryProviders.CN.ShouldEnableLagunaBeach";
		const plist = (args, input) => execFileSync("/usr/bin/plutil", [...args, "-o", "-", "-"], { input, stdio: ["pipe", "pipe", "pipe"] });
		const xml = '<plist version="1.0"><dict><key>com.apple.GEO</key><dict><key>CountryProviders</key><dict><key>CN</key><dict><key>ShouldEnableLagunaBeach</key><integer>1</integer></dict></dict></dict></dict></plist>';
		const original = plist(["-convert", "binary1"], xml);
		const originalFlag = plist(["-extract", key, "xml1"], original).toString();
		const candidate = plist(["-replace", key, "-bool", "YES"], original);
		const external = plist(["-insert", "IndependentUpdate", "-integer", "42"], candidate);
		const file = path.join(directory, "defaults.live");
		fs.writeFileSync(path.join(directory, "defaults.original"), original);
		fs.writeFileSync(path.join(directory, "defaults.candidate"), candidate);
		fs.writeFileSync(file, external);
		restoreCacheFiles(directory, { files: [{ name: "defaults", file }], originalFlag });
		const restored = fs.readFileSync(file);
		assert.equal(plist(["-extract", key, "raw"], restored).toString().trim(), "1");
		assert.equal(plist(["-extract", "IndependentUpdate", "raw"], restored).toString().trim(), "42");
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
