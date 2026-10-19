// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import XML from "@nsnanocat/xml";
import { header, MAX_DEFAULTS_BYTES, replaceHeaders } from "./common.mjs";

export function processDefaults(request, response) {
	let url;
	try {
		url = new URL(request.url);
	} catch {
		return {};
	}
	const type = header(response.headers, "content-type").split(";")[0].trim().toLowerCase();
	if (
		url.protocol !== "https:" ||
		url.hostname !== "configuration.ls.apple.com" ||
		url.pathname !== "/config/defaults" ||
		url.username ||
		url.password ||
		url.port ||
		(request.method && request.method !== "GET") ||
		Number(response.status ?? response.statusCode) !== 200 ||
		!["text/xml", "text/plist", "application/xml", "application/plist", "application/x-plist"].includes(type) ||
		typeof response.body !== "string" ||
		response.body.length > MAX_DEFAULTS_BYTES / 3
	)
		return {};
	try {
		const parsed = XML.parse(response.body);
		const geo = parsed?.plist?.["com.apple.GEO"],
			cn = geo?.CountryProviders?.CN;
		if (!cn || typeof cn !== "object" || Array.isArray(cn)) return {};
		cn.ShouldEnableLagunaBeach = true;
		cn.SupportsCarIntegration = true;
		for (const key of ["DrivingMultiWaypointRoutesEnabled", "LocalitiesAndLandmarksSupported", "NavigationShowHeadingKey", "POIBusynessRealTime", "PedestrianAREnabled"]) delete cn[key];
		for (const key of ["DrivingMultiWaypointRoutesEnabled", "LocalitiesAndLandmarksSupported", "NavigationShowHeadingKey", "6694982d2b14e95815e44e970235e230", "OpticalHeadingEnabled", "PedestrianAREnabled", "TransitPayEnabled", "UseCLPedestrianMapMatchedLocations"]) geo[key] = true;
		const body = XML.stringify(parsed);
		if (body.length > MAX_DEFAULTS_BYTES / 3) return {};
		return { body, headers: replaceHeaders(response.headers) };
	} catch {
		return {};
	}
}
