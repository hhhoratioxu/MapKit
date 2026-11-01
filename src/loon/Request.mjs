// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0

import { bytes, cacheKey, header, MANIFEST_HOSTS, MAX_CACHE_BYTES, manifestURL, requestHeaders, validWire } from "./common.mjs";
import ManifestCache from "./ManifestCache.mjs";
import settings from "./settings.mjs";

export function processRequest(request, argument, store, get, now = () => Date.now()) {
	let url;
	try {
		url = new URL(request.url);
	} catch {
		return {};
	}
	if (url.protocol !== "https:" || !MANIFEST_HOSTS.has(url.hostname) || (request.method && request.method !== "GET") || url.username || url.password || url.port) return {};
	const config = settings(argument);
	if (url.pathname === "/config/announcements") {
		if (config.Config.Announcements.Environment === "AUTO") return {};
		url.searchParams.set("environment", config.Config.Announcements.Environment === "CN" ? "prod-cn" : "prod");
		return { url: url.toString() };
	}
	if (!manifestURL(url.href) || !cacheKey(url.href)) return {};
	const country = config.GeoManifest.Dynamic.Config.CountryCode;
	if (country !== "AUTO") url.searchParams.set("country_code", country);
	const targetCountry = url.searchParams.get("country_code");
	if (!/^[A-Z]{2}$/.test(targetCountry ?? "")) return {};
	const source = new URL(url.href);
	source.searchParams.set("country_code", targetCountry === "CN" ? "US" : "CN");
	const cache = new ManifestCache(store, now);
	const cached = cache.get(source.href, Math.max(config.StaleHours * 3600, config.CacheTTL), false);
	const currentTime = now();
	const fresh = cached?.hasBody && currentTime >= cached.checkedAt && currentTime - cached.checkedAt < config.CacheTTL * 1000;
	const finish = result => {
		if (config.Diagnostics) console.log(`MapKit request: ${result}`);
		return { url: url.toString() };
	};
	if (fresh || (cached?.retryAt > currentTime && cached.retryAt <= currentTime + 300000)) return finish(fresh ? "fresh" : "cooldown");
	// Only the network path needs a Promise. Fresh-cache and ignored requests
	// can finish in the current call and release their script context promptly.
	return (async () => {
		const deadline = currentTime + config.TimeoutMs + 100;
		let fetched;
		try {
			fetched = await new Promise(resolve => {
				let settled = false;
				get({ url: source.href, headers: requestHeaders(request.headers, cached?.hasBody ? cached.etag : ""), timeout: config.TimeoutMs, "binary-mode": true, "auto-cookie": false, "auto-redirect": false, insecure: false }, (error, response, body) => {
					if (settled) return;
					settled = true;
					resolve({ error, response, body });
				});
			});
		} catch {
			fetched = { error: true };
		}
		let result;
		if (now() > deadline) result = "late";
		else {
			const status = Number(fetched.response?.status ?? fetched.response?.statusCode);
			const body = bytes(fetched.body);
			const type = header(fetched.response?.headers, "content-type").split(";")[0].trim().toLowerCase();
			if (!fetched.error && status === 304 && cached?.hasBody && cached.etag) {
				cache.touch(source.href, cached.generation);
				result = "revalidated";
			} else if (!fetched.error && status === 200 && ["application/x-protobuf", "application/protobuf", "application/vnd.google.protobuf", "application/octet-stream"].includes(type) && body?.length <= MAX_CACHE_BYTES && validWire(body)) {
				result = cache.put(source.href, body, header(fetched.response?.headers, "etag")) ? "downloaded" : "storage-failed";
			} else {
				const retry = header(fetched.response?.headers, "retry-after");
				cache.fail(source.href, /^\d+$/.test(retry) ? Number(retry) : 30);
				result = "failed";
			}
		}
		return finish(result);
	})();
}
