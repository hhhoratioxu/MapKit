// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import ManifestCache from "../src/loon/ManifestCache.mjs";
import { processRequest } from "../src/loon/Request.mjs";
import { manifest, manifestURL, memoryStore } from "./helpers.mjs";

const response = { status: 200, headers: { "CONTENT-TYPE": "application/x-protobuf", ETag: '"cn"' } };
test("request downloads only the needed source and uses documented Loon HTTP fields", async () => {
	const store = memoryStore(),
		seen = [];
	const request = { url: manifestURL, method: "GET", headers: { Cookie: "private", Authorization: "private", "User-Agent": "test" } };
	const original = JSON.stringify(request);
	const result = await processRequest(request, {}, store, (options, cb) => {
		seen.push(options);
		cb(null, response, manifest("cn"));
	});
	assert.equal(seen.length, 1);
	assert.equal(new URL(seen[0].url).searchParams.get("country_code"), "CN");
	assert.equal(seen[0].timeout, 3500);
	assert.equal(seen[0]["binary-mode"], true);
	assert.equal(seen[0]["auto-cookie"], false);
	assert.equal(seen[0]["auto-redirect"], false);
	assert.equal(seen[0].insecure, false);
	assert.deepEqual(seen[0].headers, { "Accept-Encoding": "identity", "User-Agent": "test" });
	assert.equal(new URL(result.url).searchParams.get("country_code"), "US");
	assert.equal(JSON.stringify(request), original);
});
test("fresh auxiliary data avoids any network call", async () => {
	const store = memoryStore();
	let calls = 0;
	const get = (options, cb) => {
		calls++;
		cb(null, response, manifest());
	};
	await processRequest({ url: manifestURL }, {}, store, get);
	await processRequest({ url: manifestURL }, {}, store, get);
	assert.equal(calls, 1);
});
test("TTL zero always revalidates but retains transport to the response stage", async () => {
	const store = memoryStore();
	let calls = 0;
	const get = (options, cb) => {
		calls++;
		cb(null, response, manifest());
	};
	for (let i = 0; i < 3; i++) await processRequest({ url: manifestURL }, { CacheTTL: 0 }, store, get);
	assert.equal(calls, 3);
	assert.ok(new ManifestCache(store).get(manifestURL.replace("US", "CN")).body);
});
test("expired cached bodies use their ETag and 304 refreshes freshness", async () => {
	const store = memoryStore();
	let now = 100000,
		calls = 0;
	new ManifestCache(store, () => now).put(manifestURL.replace("US", "CN"), manifest(), '"etag"');
	now += 3600001;
	await processRequest(
		{ url: manifestURL },
		{},
		store,
		(options, cb) => {
			calls++;
			assert.equal(options.headers["If-None-Match"], '"etag"');
			cb(null, { status: 304 }, null);
		},
		() => now,
	);
	await processRequest(
		{ url: manifestURL },
		{},
		store,
		() => {
			calls++;
		},
		() => now + 1,
	);
	assert.equal(calls, 1);
});
for (const scenario of ["error", "timeout", "html", "malformed", "redirect", "rate-limit", "empty", "throw"])
	test(`auxiliary ${scenario} preserves request and enters bounded cooldown`, async () => {
		const store = memoryStore();
		let calls = 0;
		const get = (options, cb) => {
			calls++;
			if (scenario === "throw") throw new Error("transport");
			if (["error", "timeout"].includes(scenario)) cb(scenario, null, null);
			else if (scenario === "redirect") cb(null, { status: 302 }, null);
			else if (scenario === "rate-limit") cb(null, { status: 429, headers: { "Retry-After": "99999" } }, null);
			else if (scenario === "html") cb(null, { status: 200, headers: { "Content-Type": "text/html" } }, "<html/>");
			else cb(null, response, scenario === "empty" ? new Uint8Array() : new Uint8Array([10, 255]));
		};
		const first = await processRequest({ url: manifestURL }, {}, store, get);
		await processRequest({ url: manifestURL }, {}, store, get);
		assert.equal(calls, 1);
		assert.ok(first.url);
		assert.equal(new ManifestCache(store).get(manifestURL.replace("US", "CN")).body, null);
	});
test("duplicate callback cannot replace the first response or write after completion", async () => {
	const store = memoryStore();
	await processRequest({ url: manifestURL }, {}, store, (options, cb) => {
		cb(null, response, manifest("first"));
		cb(null, response, manifest("second"));
	});
	assert.deepEqual(new ManifestCache(store).get(manifestURL.replace("US", "CN")).body, manifest("first"));
});
test("late HTTP callback cannot refresh cache", async () => {
	const store = memoryStore();
	let now = 100000;
	await processRequest(
		{ url: manifestURL },
		{},
		store,
		(options, cb) => {
			now += 4000;
			cb(null, response, manifest());
		},
		() => now,
	);
	assert.equal(store.data.size, 0);
});
test("AUTO retains query country and .cn endpoint supports the same safe flow", async () => {
	let seen;
	const input = manifestURL.replace("apple.com", "apple.cn").replace("US", "CN");
	const result = await processRequest({ url: input }, { CountryCode: "AUTO" }, memoryStore(), (options, cb) => {
		seen = options;
		cb("offline");
	});
	assert.equal(result.url, input);
	assert.equal(new URL(seen.url).searchParams.get("country_code"), "US");
});
test("announcements only edit the selected environment and never call HTTP", async () => {
	const url = "https://gspe35-ssl.ls.apple.com/config/announcements?os=ios";
	assert.deepEqual(await processRequest({ url }, {}, memoryStore(), () => assert.fail()), {});
	const result = await processRequest({ url }, { Environment: "CN" }, memoryStore(), () => assert.fail());
	assert.equal(new URL(result.url).searchParams.get("environment"), "prod-cn");
});
for (const request of [{ url: manifestURL, method: "POST" }, { url: manifestURL.replace("apple.com", "evil.example") }, { url: manifestURL + "&os=watchos" }, { url: "invalid" }])
	test(`out-of-scope request passes through ${request.method ?? request.url.slice(0, 45)}`, async () => assert.deepEqual(await processRequest(request, {}, memoryStore(), () => assert.fail()), {}));
