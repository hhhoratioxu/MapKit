// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Resources } from "@nsringo/mapkit";
import { manifestURL } from "../test/helpers.mjs";

const baselineCommit = "a0451d9cfc7e289d7040e6076239b9b6c5ba74bd";
const now = 1793462400000;
const directory = path.resolve(".cache/memory-measurement");
await mkdir(directory, { recursive: true });
const digest = value => createHash("sha256").update(value).digest("hex");
const baselines = {};
const optimized = {};
for (const name of ["request", "response"]) {
	const bytes = execFileSync("git", ["show", `${baselineCommit}:Loon/script/${name}.bundle.js`]);
	const file = path.join(directory, `baseline-${name}.js`);
	await writeFile(file, bytes);
	baselines[name] = { path: file, sha256: digest(bytes), bytes: bytes.length };
	const current = await readFile(`Loon/script/${name}.bundle.js`);
	optimized[name] = { path: path.resolve(`Loon/script/${name}.bundle.js`), sha256: digest(current), bytes: current.length };
}

function manifest(label, tiles, groups) {
	return Resources.toBinary(
		Resources.create({
			tileSet: Array.from({ length: tiles }, (_, i) => ({ style: [1, 7, 14, 20, 13, 2][i % 6], validVersion: [{ identifier: i + 1 }], baseURL: `https://${label}.example/tiles/${i}/` })),
			tileGroup: Array.from({ length: groups }, (_, identifier) => ({ identifier })),
			urlInfoSet: [{ dispatcherURL: { url: `https://${label}.example/dispatcher` }, directionsURL: { url: `https://${label}.example/directions` } }],
			attribution: [{ name: "Synthetic fixture", resource: [] }],
		}),
	);
}
const sourceURL = new URL(manifestURL.replace("US", "CN"));
sourceURL.searchParams.sort();
const key = sourceURL.href;
function stored(body, age = 0) {
	const generation = "fixed-generation";
	return [
		["Horatio.MapKit.v1.index", JSON.stringify([{ slot: 0, key, generation, etag: '"fixture"', checkedAt: now - age, bodyAt: now - age, retryAt: 0 }])],
		["Horatio.MapKit.v1.slot0", JSON.stringify({ key, generation, base64: Buffer.from(body).toString("base64") })],
	];
}
const headers = { "Content-Type": "application/x-protobuf" };
const encodedResponse = bytes => ({ status: 200, headers, bodyBase64: Buffer.from(bytes).toString("base64") });
// Valid top-level length-delimited wire data at the existing 1 MiB cache limit.
// Only Request consumes this synthetic field; it is not a real Apple manifest.
const large = new Uint8Array(1024 * 1024);
large.set([0x0a, 0xfc, 0xff, 0x3f]); // payload length 1,048,572
const smallSource = manifest("cn", 80, 3),
	denseSource = manifest("cn", 2000, 60);
const fixtures = [
	{ name: "fresh-cache-1MiB", kind: "request", store: stored(large) },
	{ name: "fresh-cache-2000-tiles", kind: "request", store: stored(denseSource) },
	{ name: "revalidate-304-1MiB", kind: "request", store: stored(large, 3600001), http: { response: { status: 304 } }, httpCalls: 1 },
	{ name: "cache-write-1MiB", kind: "request", store: [], http: { response: { status: 200, headers }, bodyBase64: Buffer.from(large).toString("base64") }, httpCalls: 1 },
	{ name: "cache-write-80-tiles", kind: "request", store: [], http: { response: { status: 200, headers }, bodyBase64: Buffer.from(smallSource).toString("base64") }, httpCalls: 1 },
	{ name: "merge-80-tiles-3-groups", kind: "response", store: stored(smallSource), response: encodedResponse(manifest("us", 80, 3)) },
	{ name: "merge-2000-tiles-60-groups", kind: "response", store: stored(denseSource), response: encodedResponse(manifest("us", 2000, 60)) },
	{ name: "missing-source", kind: "response", store: [], response: encodedResponse(manifest("us", 2000, 60)) },
	{ name: "oversized-passthrough", kind: "response", store: [], response: encodedResponse(new Uint8Array(2 * 1024 * 1024 + 1)) },
].map(fixture => ({ ...fixture, now, request: { url: manifestURL, method: "GET", headers: {} } }));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
for (const fixture of fixtures) {
	const content = JSON.stringify(fixture);
	const file = path.join(directory, `${fixture.name}.json`);
	await writeFile(file, content);
	const samples = { baseline: [], optimized: [] };
	for (let trial = 0; trial < 5; trial++) {
		// Alternate order to reduce systematic drift from system load.
		for (const variant of trial % 2 ? ["optimized", "baseline"] : ["baseline", "optimized"]) {
			const bundle = (variant === "baseline" ? baselines : optimized)[fixture.kind];
			const output = execFileSync(process.execPath, ["--expose-gc", "scripts/memory-worker.mjs", bundle.path, file], { encoding: "utf8", timeout: 20000 });
			samples[variant].push(JSON.parse(output));
		}
	}
	const hashes = new Set([...samples.baseline, ...samples.optimized].map(sample => sample.outputAndStoreSHA256));
	assert.equal(hashes.size, 1, `Output/store changed for ${fixture.name}`);
	const summary = {};
	for (const metric of ["peakRSSKiB", "sampledHeapGrowthBytes", "elapsedMs", "explicitArrayBytes"]) summary[metric] = Object.fromEntries(Object.entries(samples).map(([variant, values]) => [variant, median(values.map(value => value[metric]))]));
	results.push({ name: fixture.name, fixtureSHA256: digest(content), identicalOutputAndStore: true, summary, samples });
	console.log(JSON.stringify({ name: fixture.name, ...summary }));
}
const report = {
	date: "2026-11-01",
	baselineCommit,
	version: JSON.parse(await readFile("package.json", "utf8")).version,
	scope: `Synthetic fixtures, actual compiled bundles, ${fixtures.length * 10} independent desktop Node/V8 processes. Not Loon/iPhone or VPN memory acceptance.`,
	method:
		"Five fresh processes per version/case; alternated order; fixed clock/random; one invocation per process; GC before measurement. peakRSSKiB is whole-process lifetime high-water RSS, including Node/fixture setup. Heap/ArrayBuffer growth is sampled at store writes and completion, not a continuous peak. Explicit array allocation counts exclude native encoders, internal views and host buffers. All outputs and persisted records are byte-compared by SHA-256.",
	environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), cpu: os.cpus()[0]?.model },
	bundles: Object.fromEntries(
		[
			["baseline", baselines],
			["optimized", optimized],
		].map(([variant, bundles]) => [variant, Object.fromEntries(Object.entries(bundles).map(([name, { sha256, bytes }]) => [name, { sha256, bytes }]))]),
	),
	results,
};
await writeFile("docs/memory-measurements.json", `${JSON.stringify(report, null, 2)}\n`);
