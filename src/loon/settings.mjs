// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
export const tileDefaults = { Map: "CN", Satellite2D: "CN", Satellite3D: "XX", Traffic: "CN", POI: "CN", Flyover: "XX", Munin: "XX", Road: "CN", Earth: "CN", Transit: "CN" };
const choice = (value, choices, fallback) => (choices.includes(value) ? value : fallback);
const number = (value, fallback, min, max) => (value !== null && value !== "" && Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.floor(Number(value)))) : fallback);

export default function settings(argument = {}) {
	const a = argument && typeof argument === "object" && !Array.isArray(argument) ? argument : {};
	return {
		GeoManifest: { Dynamic: { Config: { CountryCode: choice(a.CountryCode, ["AUTO", "CN", "HK", "TW", "SG", "US", "JP", "AU", "GB", "KR", "CA", "IE"], "US") } } },
		Config: { Announcements: { Environment: choice(a.Environment, ["AUTO", "CN", "XX"], "AUTO") } },
		UrlInfoSet: {
			Dispatcher: choice(a.Dispatcher, ["AUTO", "AutoNavi", "Apple"], "AutoNavi"),
			Directions: choice(a.Directions, ["AUTO", "AutoNavi", "Apple"], "AutoNavi"),
			RAP: choice(a.RAP, ["AUTO", "AutoNavi", "Apple"], "Apple"),
			LocationShift: choice(a.LocationShift, ["AUTO", "AutoNavi", "Apple"], "AUTO"),
		},
		TileSet: Object.fromEntries(Object.entries(tileDefaults).map(([key, fallback]) => [key, choice(a[key], ["CN", "XX"], fallback)])),
		CacheTTL: number(a.CacheTTL, 3600, 0, 86400),
		StaleHours: number(a.StaleHours, 24, 0, 72),
		TimeoutMs: number(a.TimeoutMs, 3500, 500, 6000),
		Diagnostics: a.Diagnostics === true,
	};
}
