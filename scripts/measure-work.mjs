// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Console, Storage } from "@nsnanocat/util";
import * as schema from "@nsringo/mapkit";
import GEOResourceManifest from "../src/class/GEOResourceManifest.mjs";
import Codec from "../src/class/GEOResourceManifestDownload.mjs";
import { processRequest } from "../src/loon/Request.mjs";
import { Request as UpstreamRequest } from "../src/process/Request.mjs";
import { manifest, manifestURL, memoryStore } from "../test/helpers.mjs";

const upstream = "c9af737d97c0b3e26bc2f1083e36564da1b05ba4";
const source = file => execFileSync("git", ["show", `${upstream}:${file}`], { encoding: "utf8" });
const sourceClass = source("src/class/GEOResourceManifest.mjs");
const start = sourceClass.indexOf("static tileSets("),
	end = sourceClass.indexOf("\n\t/**", start);
const BaselineTiles = new Function("Console", `return class { ${sourceClass.slice(start, end)} }`)({ info() {} });
const codecText = source("src/class/GEOResourceManifestDownload.mjs")
	.split("\n")
	.filter(line => !line.startsWith("import ") && !line.startsWith("//import "))
	.join("\n")
	.replace("export default class", "class");
const BaselineCodec = new Function(...Object.keys(schema), "Console", `${codecText}; return GEOResourceManifestDownload;`)(...Object.values(schema), { log() {} });

Console.logLevel = "OFF";
const oldMethods = Object.fromEntries(["log", "info", "debug", "warn", "error"].map(key => [key, Console[key]]));
for (const key of Object.keys(oldMethods)) Console[key] = () => {};
const oldDownload = GEOResourceManifest.download,
	oldGetCache = GEOResourceManifest.getCache,
	oldStorageGet = Storage.getItem;
globalThis.$argument = { Storage: "database" };
let upstreamRequests = 0;
GEOResourceManifest.download = async () => {
	upstreamRequests++;
	return { status: 304 };
};
GEOResourceManifest.getCache = async () => ({ eTag: "cached" });
Storage.getItem = () => ({});
for (let i = 0; i < 100; i++) await UpstreamRequest({ url: manifestURL, method: "GET", headers: {} });
GEOResourceManifest.download = oldDownload;
GEOResourceManifest.getCache = oldGetCache;
Storage.getItem = oldStorageGet;
let optimizedRequests = 0;
const store = memoryStore(),
	body = manifest();
for (let i = 0; i < 100; i++)
	await processRequest(
		{ url: manifestURL },
		{},
		store,
		(options, callback) => {
			optimizedRequests++;
			callback(null, { status: 200, headers: { "Content-Type": "application/x-protobuf", ETag: "cached" } }, body);
		},
		() => 100000,
	);
assert.equal(upstreamRequests, 100);
assert.equal(optimizedRequests, 1);

const tiles = label => Array.from({ length: 5000 }, (_, index) => ({ style: `S${index % 50}`, id: `${label}${index}` }));
const sourceTiles = tiles("source"),
	targetTiles = tiles("target"),
	styles = Array.from({ length: 25 }, (_, index) => `S${index}`);
assert.deepEqual(GEOResourceManifest.tileSets(sourceTiles, [...targetTiles], [...styles]), BaselineTiles.tileSets(sourceTiles, [...targetTiles], [...styles]));
const binary = manifest(
	"codec",
	Array.from({ length: 3000 }, (_, index) => [1, 7, 14, 20, 13, 2][index % 6]),
);
assert.deepEqual(Codec.encode(Codec.decode(binary)), BaselineCodec.encode(BaselineCodec.decode(binary)));
const sample = operation => {
	const result = [];
	for (let trial = 0; trial < 9; trial++) {
		const started = performance.now();
		for (let i = 0; i < 20; i++) operation();
		result.push(performance.now() - started);
	}
	return { medianMs: [...result].sort((a, b) => a - b)[4], samplesMs: result, iterationsPerTrial: 20 };
};
const measurements = {
	scope: "Node/V8 synthetic work measurements; no live Apple request, native Loon, iPhone power or VPN stability measurement",
	upstreamCommit: upstream,
	node: process.version,
	repeatedManifestRequests: { executions: 100, withinTTL: true, upstreamHTTPCalls: upstreamRequests, optimizedHTTPCalls: optimizedRequests },
	tileMerge: { sourceTiles: 5000, targetTiles: 5000, selectedStyles: 25, identicalResult: true, upstream: sample(() => BaselineTiles.tileSets(sourceTiles, [...targetTiles], [...styles])), optimized: sample(() => GEOResourceManifest.tileSets(sourceTiles, [...targetTiles], styles)) },
	codecRoundtrip: { tiles: 3000, identicalKnownFieldBytes: true, upstream: sample(() => BaselineCodec.encode(BaselineCodec.decode(binary))), optimized: sample(() => Codec.encode(Codec.decode(binary))) },
	optimizedBundleBytes: Object.fromEntries(await Promise.all(["request", "response", "defaults"].map(async name => [name, (await stat(`Loon/script/${name}.bundle.js`)).size]))),
};
for (const key of Object.keys(oldMethods)) Console[key] = oldMethods[key];
await mkdir("docs", { recursive: true });
await writeFile("docs/work-measurements.json", `${JSON.stringify(measurements, null, 2)}\n`);
console.log(JSON.stringify(measurements, null, 2));
