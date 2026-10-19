// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import { Console } from "@nsnanocat/util";
import GEOResourceManifest from "../class/GEOResourceManifest.mjs";
import GEOResourceManifestDownload from "../class/GEOResourceManifestDownload.mjs";
import database from "../function/database.mjs";
import { bytes, header, MAX_MANIFEST_BYTES, MAX_OUTPUT_BYTES, manifestURL, replaceHeaders, validWire } from "./common.mjs";
import ManifestCache from "./ManifestCache.mjs";
import settings from "./settings.mjs";

export function validManifest(body) {
	return (
		Array.isArray(body?.tileSet) &&
		body.tileSet.length > 0 &&
		body.tileSet.length <= 30000 &&
		Array.isArray(body.urlInfoSet) &&
		body.urlInfoSet.length > 0 &&
		body.urlInfoSet.length <= 500 &&
		Array.isArray(body.tileGroup) &&
		body.tileGroup.length <= 5000 &&
		(body.resource?.length ?? 0) <= 30000 &&
		(body.attribution?.length ?? 0) <= 20000
	);
}

export async function processResponse(request, response, argument, store, now) {
	const url = manifestURL(request.url);
	const type = header(response.headers, "content-type").split(";")[0].trim().toLowerCase();
	const input = bytes(response.body ?? response.bodyBytes);
	if (
		!url ||
		(request.method && request.method !== "GET") ||
		Number(response.status ?? response.statusCode) !== 200 ||
		!["application/x-protobuf", "application/protobuf", "application/vnd.google.protobuf", "application/octet-stream"].includes(type) ||
		!input?.length ||
		input.length > MAX_MANIFEST_BYTES ||
		!validWire(input)
	)
		return {};
	const country = url.searchParams.get("country_code");
	if (!/^[A-Z]{2}$/.test(country ?? "")) return {};
	const config = settings(argument);
	Console.logLevel = "OFF";
	const sourceURL = new URL(url.href);
	sourceURL.searchParams.set("country_code", country === "CN" ? "US" : "CN");
	const cache = new ManifestCache(store, now);
	const cached = cache.get(sourceURL.href, Math.max(config.StaleHours * 3600, config.CacheTTL));
	if (!cached?.body) {
		if (config.Diagnostics) console.log("MapKit response: no-source");
		return {};
	}
	let source;
	try {
		source = GEOResourceManifestDownload.decode(cached.body);
		if (!validManifest(source)) throw new Error("Unsupported source");
	} catch {
		cache.invalidate(sourceURL.href);
		cache.fail(sourceURL.href);
		if (config.Diagnostics) console.log("MapKit response: invalid-source");
		return {};
	}
	try {
		const target = GEOResourceManifestDownload.decode(input);
		if (!validManifest(target)) return {};
		const sourceCountry = country === "CN" ? "XX" : "CN";
		const styles = GEOResourceManifest.tileStyles(database.MapKit.Configs, config, sourceCountry);
		target.tileSet = GEOResourceManifest.tileSets(source.tileSet, target.tileSet, styles);
		target.attribution = GEOResourceManifest.attributions(source.attribution, target.attribution, country);
		target.resource = GEOResourceManifest.resources(source.resource, target.resource, country);
		target.dataSet = GEOResourceManifest.dataSets(source.dataSet, target.dataSet, country);
		target.urlInfoSet = GEOResourceManifest.urlInfoSets(source.urlInfoSet, target.urlInfoSet, config, country, url.searchParams.get("os"));
		target.muninBucket = GEOResourceManifest.muninBuckets(source.muninBucket, target.muninBucket, config, country);
		target.displayString = GEOResourceManifest.displayStrings(source.displayString, target.displayString, country);
		// Each group repeats references to these collections; bound expansion before allocation.
		if (target.tileGroup.length * (target.tileSet.length + target.attribution.length + target.resource.length) > 200000) return {};
		target.tileGroup = GEOResourceManifest.tileGroups(target.tileGroup, target.tileSet, target.attribution, target.resource);
		const body = GEOResourceManifestDownload.encode(target);
		if (body.length > MAX_OUTPUT_BYTES) return {};
		if (config.Diagnostics) console.log("MapKit response: merged");
		return { body, headers: replaceHeaders(response.headers) };
	} catch {
		if (config.Diagnostics) console.log("MapKit response: unchanged");
		return {};
	}
}
