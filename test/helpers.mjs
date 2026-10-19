// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import { Resources } from "@nsringo/mapkit";
export const manifestURL = "https://gspe35-ssl.ls.apple.com/geo_manifest/dynamic/config?os=ios&os_version=26&country_code=US";
export function memoryStore() {
	const data = new Map();
	return {
		data,
		read: key => data.get(key),
		write(value, key) {
			if (value === undefined || value === null) data.delete(key);
			else data.set(key, value);
			return true;
		},
	};
}
export function manifest(label = "target", styles = [1, 7, 14]) {
	return Resources.toBinary(
		Resources.create({
			tileSet: styles.map((style, index) => ({ style, validVersion: [{ identifier: index + 1 }], baseURL: `https://${label}.example/${style}/` })),
			tileGroup: [{ identifier: 1 }],
			urlInfoSet: [{ dispatcherURL: { url: `https://${label}.example/dispatcher` }, directionsURL: { url: `https://${label}.example/directions` }, polyLocationShiftURL: { url: `https://${label}.example/shift` } }],
		}),
	);
}
