// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
export const tileDefaults = { Map: "CN", Satellite2D: "CN", Satellite3D: "XX", Traffic: "CN", POI: "CN", Flyover: "XX", Munin: "XX", Road: "CN", Earth: "CN", Transit: "CN" };
const choice = (value, choices, fallback) => (choices.includes(value) ? value : fallback);

export default function settings(argument = {}) {
	const a = argument && typeof argument === "object" && !Array.isArray(argument) ? argument : {};
	return {
		Storage: "Argument",
		GeoManifest: { Dynamic: { Config: { CountryCode: choice(a.CountryCode, ["AUTO", "CN", "HK", "TW", "SG", "US", "JP", "AU", "GB", "KR", "CA", "IE"], "US") } } },
		Config: { Announcements: { Environment: choice(a.Environment, ["AUTO", "CN", "XX"], "AUTO") } },
		UrlInfoSet: {
			Dispatcher: choice(a.Dispatcher, ["AUTO", "AutoNavi", "Apple"], "AutoNavi"),
			Directions: choice(a.Directions, ["AUTO", "AutoNavi", "Apple"], "AutoNavi"),
			RAP: choice(a.RAP, ["AUTO", "AutoNavi", "Apple"], "Apple"),
			LocationShift: choice(a.LocationShift, ["AUTO", "AutoNavi", "Apple"], "AUTO"),
		},
		TileSet: Object.fromEntries(Object.entries(tileDefaults).map(([key, fallback]) => [key, choice(a[key], ["CN", "XX"], fallback)])),
	};
}
