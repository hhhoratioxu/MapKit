// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
// One fresh Node process per sample. Runs the actual shipped bundle in a VM.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const [bundlePath, fixturePath] = process.argv.slice(2);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const code = readFileSync(bundlePath, "utf8");
const store = new Map(fixture.store);
if (fixture.response?.bodyBase64) {
	fixture.response.body = new Uint8Array(Buffer.from(fixture.response.bodyBase64, "base64"));
	delete fixture.response.bodyBase64;
}
let httpBody;
if (fixture.http?.bodyBase64) {
	httpBody = new Uint8Array(Buffer.from(fixture.http.bodyBase64, "base64"));
	delete fixture.http.bodyBase64;
}
class FixedDate extends Date {
	constructor(...args) {
		if (args.length) super(...args);
		else super(fixture.now);
	}
	static now() {
		return fixture.now;
	}
}
const math = Object.create(Math);
math.random = () => 0.5;
let explicitArrayBytes = 0,
	explicitArrayAllocations = 0,
	calls = 0,
	httpCalls = 0,
	result,
	resolve;
const finished = new Promise(done => {
	resolve = done;
});
const TrackedBytes = new Proxy(Uint8Array, {
	construct(target, args) {
		const value = Reflect.construct(target, args);
		// Views over existing ArrayBuffers do not allocate backing storage.
		if (!(args[0] instanceof ArrayBuffer)) {
			explicitArrayBytes += value.byteLength;
			explicitArrayAllocations++;
		}
		return value;
	},
});
global.gc?.();
const before = process.memoryUsage();
let sampledHeapUsed = before.heapUsed,
	sampledArrayBuffers = before.arrayBuffers;
const sample = () => {
	const m = process.memoryUsage();
	sampledHeapUsed = Math.max(sampledHeapUsed, m.heapUsed);
	sampledArrayBuffers = Math.max(sampledArrayBuffers, m.arrayBuffers);
};
const started = performance.now();
const context = vm.createContext({
	URL,
	URLSearchParams,
	Uint8Array: TrackedBytes,
	ArrayBuffer,
	DataView,
	TextEncoder,
	TextDecoder,
	Date: FixedDate,
	Math: math,
	console: { log() {}, warn() {}, error() {} },
	$loon: "fixture",
	$script: { type: fixture.kind === "request" ? "http-request" : "http-response" },
	$request: fixture.request,
	$response: fixture.response,
	$argument: fixture.argument ?? {},
	$persistentStore: {
		read: key => store.get(key),
		write(value, key) {
			store.set(key, value);
			sample();
			return true;
		},
	},
	$httpClient: {
		get(_, callback) {
			httpCalls++;
			assert.ok(fixture.http, "Unexpected HTTP request");
			callback(fixture.http.error ?? null, fixture.http.response, httpBody);
		},
	},
	$done(value) {
		calls++;
		result = value;
		sample();
		resolve();
	},
});
new vm.Script(code).runInContext(context, { timeout: 5000 });
const completedSynchronously = calls === 1;
await finished;
const elapsedMs = performance.now() - started;
sample();
assert.equal(calls, 1);
assert.equal(httpCalls, fixture.httpCalls ?? 0);
const peakRSSKiB = process.resourceUsage().maxRSS;
// Measure before hashing/output inspection so verification does not affect RSS.
const hash = createHash("sha256");
hash.update(JSON.stringify({ ...result, body: result.body ? undefined : result.body }));
if (result.body) hash.update(result.body);
for (const [key, value] of [...store].sort(([a], [b]) => a.localeCompare(b))) hash.update(key).update(value);
console.log(
	JSON.stringify({
		elapsedMs,
		peakRSSKiB,
		beforeRSSBytes: before.rss,
		sampledHeapGrowthBytes: sampledHeapUsed - before.heapUsed,
		sampledArrayBufferGrowthBytes: sampledArrayBuffers - before.arrayBuffers,
		explicitArrayBytes,
		explicitArrayAllocations,
		completedSynchronously,
		httpCalls,
		outputBytes: result.body?.byteLength ?? 0,
		outputAndStoreSHA256: hash.digest("hex"),
	}),
);
