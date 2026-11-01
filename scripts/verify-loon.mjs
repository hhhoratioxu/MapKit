// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { Resources } from "@nsringo/mapkit";
import ManifestCache from "../src/loon/ManifestCache.mjs";
import { manifest, manifestURL, memoryStore } from "../test/helpers.mjs";

export async function runBundle(name, { request = { url: manifestURL, method: "GET", headers: {} }, response, store = memoryStore(), argument = {}, get, synchronous = false, inspect } = {}) {
	const code = await readFile(`Loon/script/${name}.bundle.js`, "utf8");
	let count = 0,
		result,
		resolve;
	const finished = new Promise(done => {
		resolve = done;
	});
	const context = vm.createContext({
		URL,
		URLSearchParams,
		Uint8Array,
		ArrayBuffer,
		DataView,
		TextEncoder,
		TextDecoder,
		console: { log() {}, warn() {}, error() {} },
		$loon: {},
		$script: { type: name === "request" ? "http-request" : "http-response" },
		$request: request,
		$response: response,
		$argument: argument,
		$persistentStore: store,
		$httpClient: { get: get ?? ((options, callback) => callback("offline")) },
		$done(value) {
			count++;
			result = value;
			resolve();
		},
	});
	new vm.Script(code).runInContext(context, { timeout: 1500 });
	if (synchronous) assert.equal(count, 1, "Purely local work must complete synchronously");
	inspect?.({ count });
	let timer;
	try {
		await Promise.race([
			finished,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error("Bundle did not finish")), 1500);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
	await new Promise(done => setImmediate(done));
	assert.equal(count, 1, "Loon $done must occur exactly once");
	return result;
}

export default async function verifyLoon() {
	const plugin = await readFile("Loon/script/MapKit.lpx", "utf8");
	assert.match(plugin, /#!loon_version = 3\.5\.1\(983\)/);
	assert.doesNotMatch(plugin, /GeoServices\/releases|mapkit\.pages\.dev|mapkit\.nanocat\.cloud|engine=|max_size=/);
	const declared = new Set([...plugin.matchAll(/^(\w+) = (?:select|input|switch),/gm)].map(match => match[1]));
	for (const match of plugin.matchAll(/\$\{(\w+)\}/g)) assert.ok(declared.has(match[1]) || match[1] === "url", `Undefined argument ${match[1]}`);
	const scripts = plugin.split("\n").filter(line => /^(request|response) if .* then script\(/.test(line));
	assert.equal(scripts.length, 4);
	for (const line of scripts) {
		assert.match(line, /\$\{url\} ~= /);
		assert.doesNotMatch(line, /\|\|/);
		const ref = process.env.MAPKIT_RESOURCE_REF || "optimized-v2";
		assert.ok(line.includes(`https://raw.githubusercontent.com/hhhoratioxu/MapKit/${ref}/Loon/script/`));
	}
	const patterns = [...plugin.matchAll(/\$\{url\} ~= (\/.*?\/) then|\$\{url\} ~= (\/.*?\/) &&/g)].map(match => new Function(`return ${match[1] ?? match[2]}`)());
	for (const pattern of patterns) {
		assert.equal(pattern.test("https://evil.example/config/defaults"), false);
		assert.equal(pattern.test(manifestURL.replace("apple.com", "apple.com.evil.example")), false);
	}
	let scenarios = 0;
	const store = memoryStore();
	let calls = 0;
	const get = (options, callback) => {
		calls++;
		callback(null, { status: 200, headers: { "Content-Type": "application/x-protobuf", ETag: "cn" } }, manifest("cn"));
		callback("duplicate");
	};
	await runBundle("request", { store, get });
	scenarios++;
	await runBundle("request", { store, get, synchronous: true });
	scenarios++;
	assert.equal(calls, 1);
	const merged = await runBundle("response", { store, synchronous: true, response: { status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: manifest("us") } });
	scenarios++;
	let callback;
	const pending = runBundle("request", {
		get: (_, cb) => {
			callback = cb;
		},
		inspect: ({ count }) => {
			assert.equal(count, 0, "HTTP path must await its callback");
			callback("offline");
			callback("duplicate");
		},
	});
	await pending;
	scenarios++;
	await runBundle("request", { request: { url: "invalid" }, synchronous: true });
	scenarios++;
	assert.ok(
		Resources.fromBinary(merged.body)
			.tileSet.find(tile => tile.style === 1)
			.baseURL.includes("cn.example"),
	);
	for (const status of [304, 429, 500]) {
		const result = await runBundle("response", { store, response: { status, headers: {}, body: manifest() } });
		assert.equal(Object.keys(result).length, 0);
		scenarios++;
	}
	for (const body of [new Uint8Array([0]), new Uint8Array(2 * 1024 * 1024 + 1)]) {
		const result = await runBundle("response", { store, response: { status: 200, headers: { "Content-Type": "application/x-protobuf" }, body } });
		assert.equal(Object.keys(result).length, 0);
		scenarios++;
	}
	const noSource = await runBundle("response", { response: { status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: manifest() } });
	assert.equal(Object.keys(noSource).length, 0);
	scenarios++;
	await runBundle("request", { store: memoryStore(), get: (options, callback) => callback("timeout") });
	scenarios++;
	const announced = await runBundle("request", { request: { url: "https://gspe35-ssl.ls.apple.cn/config/announcements?os=ios", method: "GET" }, argument: { Environment: "CN" } });
	assert.ok(announced.url.includes("environment=prod-cn"));
	scenarios++;
	const unchanged = await runBundle("defaults", { request: { url: "https://configuration.ls.apple.com/config/defaults" }, response: { status: 200, headers: { "Content-Type": "application/xml" }, body: "not a plist" } });
	assert.equal(Object.keys(unchanged).length, 0);
	scenarios++;
	const sizes = Object.fromEntries(await Promise.all(["request", "response", "defaults"].map(async name => [name, (await stat(`Loon/script/${name}.bundle.js`)).size])));
	assert.ok(sizes.request < 20000, "Request must not load the protobuf schema");
	assert.ok(sizes.defaults < 50000, "Defaults must not load the protobuf schema");
	return { compiledBundleScenarios: scenarios, configurationChecks: "native expressions, URL guards, typed parameters, pinned imports; real Loon parser unavailable", sizes, nativeDeviceAcceptance: "not performed" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await verifyLoon(), null, 2));
