// Build the actual shared entry points. All VM I/O is in memory; no native app or endpoint is used.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { rollup } from "rollup";
import { BinaryWriter, ScalarType, WireType } from "@protobuf-ts/runtime";
import { Resources } from "@nsringo/mapkit";
import releaseConfigs from "../rollup.config.mjs";
import devConfigs from "../rollup.dev.config.mjs";

const shared = {};
for (const [name, config] of [["release", releaseConfigs[0]], ["dev", devConfigs[0]]]) {
	const { output, ...input } = config;
	const bundle = await rollup(input);
	try {
		const result = await bundle.generate(output);
		shared[name] = result.output.find(item => item.type === "chunk").code;
	} finally { await bundle.close(); }
}

const valid = Resources.toBinary(Resources.create({ releaseInfo: "offline-compat" }));
const unknown = new BinaryWriter().tag(50000, WireType.StartGroup).tag(50001, WireType.LengthDelimited).bytes(Uint8Array.of(0xff)).tag(50000, WireType.EndGroup).finish();
const tile = Resources.fields.find(item => item.kind === "message" && item.T().fields.some(child => child.kind === "scalar" && child.T === ScalarType.STRING));
const text = tile.T().fields.find(item => item.kind === "scalar" && item.T === ScalarType.STRING);
const badNested = new BinaryWriter().tag(tile.no, WireType.LengthDelimited).bytes(new BinaryWriter().tag(text.no, WireType.LengthDelimited).bytes(Uint8Array.of(0xff)).finish()).finish();
const badGroup = new BinaryWriter().tag(50000, WireType.StartGroup).tag(50001, WireType.EndGroup).finish();
const metadata = Resources.fields.find(item => item.kind === "message" && item.T().typeName === "geo.OfflineMetadata");
const unsafeLong = new BinaryWriter().tag(metadata.no, WireType.LengthDelimited).bytes(new BinaryWriter().tag(1, WireType.Varint).uint64("9007199254740992").finish()).finish();
const samples = [["valid", valid, true], ["unknown group", Buffer.concat([valid, unknown]), true], ["nested UTF-8", badNested, false], ["unmatched group", badGroup, false], ["unsafe uint64", unsafeLong, false]];
const key = "?country_code=US&os=osx";
const url = "https://gspe35-ssl.ls.apple.com/geo_manifest/dynamic/config?country_code=CN&os=osx";
const quiet = Object.fromEntries(["log", "debug", "warn", "error", "info"].map(key => [key, () => {}]));

async function run(code, client, bytes, conditional) {
	const requests = [], store = { iRingo: JSON.stringify({ MapKit: { Caches: { [key]: { eTag: "offline-tag", base64: Buffer.from(bytes).toString("base64") } } } }) };
	const before = JSON.stringify(store);
	let doneCount = 0, result;
	const context = {
		URL, Uint8Array, ArrayBuffer, TextDecoder, TextEncoder, atob, btoa, console: quiet,
		$script: { startTime: Date.now() }, $request: { url, method: "GET", headers: {} },
		$argument: client === "native Loon" ? { CountryCode: "CN" } : "GeoManifest.Dynamic.Config.CountryCode=CN",
		$persistentStore: { read: key => store[key] ?? null, write: () => { throw new Error("Unexpected storage write"); } },
		$prefs: { valueForKey: key => store[key] ?? null, setValueForKey: () => { throw new Error("Unexpected storage write"); } },
		$httpClient: { get: (request, callback) => { requests.push(request); callback(null, { status: conditional ? 304 : 503, headers: {} }, new Uint8Array()); } },
		$done: value => { doneCount++; result = value; },
	};
	if (client === "Quantumult X") {
		context.$task = { fetch: async request => { requests.push(request); return { statusCode: conditional ? 304 : 503, headers: {}, body: "" }; } };
		// Suppress only the unused timeout side of the already-resolved mock race.
		context.setTimeout = () => 0;
	} else if (client === "native Loon" || client === "Loon") context.$loon = "Mac offline-compat";
	else if (client === "Shadowrocket") context.$rocket = {};
	else if (client === "Egern") context.Egern = {};
	else context.$environment = { [client === "Surge" ? "surge-version" : "stash-version"]: "offline-compat" };
	vm.runInNewContext(code, context, { timeout: 2000 });
	for (let index = 0; index < 50 && !doneCount; index++) await new Promise(resolve => setTimeout(resolve, 2));
	assert.equal(doneCount, 1, "one completion");
	assert.equal(requests.length, 1, "one existing supplemental request and no retry");
	const etag = Object.entries(requests[0].headers || {}).find(([name]) => name.toLowerCase() === "if-none-match")?.[1];
	assert.equal(etag, conditional ? "offline-tag" : undefined);
	assert.equal(JSON.stringify(store), before, "no storage mutation");
	assert.equal(new URL(requests[0].url).searchParams.get("os"), "osx");
	assert.equal(result.url, url, "target request survives failure or revalidation");
}

const native = fs.readFileSync("Loon/script/request.bundle.js", "utf8");
test("native Loon cache validation uses the real compiled bundle", async () => {
	for (const [, bytes, conditional] of samples) await run(native, "native Loon", bytes, conditional);
});
for (const [variant, code] of Object.entries(shared)) {
	for (const client of ["Loon", "Surge", "Shadowrocket", "Stash", "Egern", "Quantumult X"]) {
		test(`${variant} compiled cache validation preserves ${client} I/O`, async () => {
			for (const [, bytes, conditional] of samples) await run(code, client, bytes, conditional);
		});
	}
}
