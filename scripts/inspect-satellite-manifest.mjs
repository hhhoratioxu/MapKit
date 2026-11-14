import { readFileSync } from "node:fs";
import { Resources, TileSetStyle } from "@nsringo/mapkit";
import { BinaryReader, WireType } from "@protobuf-ts/runtime";
import database from "../src/function/database.mjs";

function readMacManifest(path) {
	const reader = new BinaryReader(readFileSync(path));
	let payload;
	while (reader.pos < reader.len) {
		const [field, wire] = reader.tag();
		if (field === 1 && wire === WireType.LengthDelimited) {
			if (payload !== undefined) throw new Error("Ambiguous Resources payload");
			payload = reader.bytes();
		} else {
			reader.skip(wire);
		}
	}
	if (!payload?.length) throw new Error("Missing Resources payload");
	const manifest = Resources.fromBinary(payload);
	if (!manifest.tileGroup.length || !manifest.tileSet.length) throw new Error("Missing tile groups or tile sets");
	return manifest;
}

// Only a range declared at one zoom has unambiguous X/Y bounds at that zoom.
function coverage(regions, latitude, longitude, zoom) {
	const width = 2 ** zoom;
	const x = Math.floor((width * (longitude + 180)) / 360);
	const y = Math.floor((width * (1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI)) / 2);
	let uncertain = regions.length === 0;
	for (const r of regions) {
		if (r.minZ > r.maxZ) {
			uncertain = true;
			continue;
		}
		if (zoom < r.minZ || zoom > r.maxZ) continue;
		if (r.minZ !== r.maxZ || r.minX > r.maxX || r.minY > r.maxY) uncertain = true;
		else if (r.minX <= x && x <= r.maxX && r.minY <= y && y <= r.maxY) return "inside";
	}
	return uncertain ? "undetermined" : "outside";
}

const landmarks = [
	["Eiffel Tower", 48.8584, 2.2945],
	["Shanghai Bund", 31.24, 121.49],
];

function summarizeCoverage(regions) {
	return Object.fromEntries(landmarks.map(([name, latitude, longitude]) => {
		const levels = { inside: [], outside: [], undetermined: [] };
		for (let zoom = 8; zoom <= 18; zoom++) {
			levels[coverage(regions, latitude, longitude, zoom)].push(zoom);
		}
		return [name, levels];
	}));
}

function summarize(manifest) {
	const styles = new Set();
	const daytimeLayers = [];
	let unresolvedReferences = 0;
	for (const [group, tileGroup] of manifest.tileGroup.entries()) {
		for (const ref of tileGroup.tileSet) {
			const tile = manifest.tileSet[ref.tileSetIndex];
			const version = tile?.validVersion.find(v => v.identifier === ref.identifier);
			if (!version) {
				unresolvedReferences++;
				continue;
			}
			const style = TileSetStyle[tile.style];
			styles.add(style);
			if (style === "RASTER_SATELLITE") {
				daytimeLayers.push({
					group,
					index: ref.tileSetIndex,
					scale: tile.scale,
					version: version.identifier,
					coverage: summarizeCoverage(version.availableTiles),
				});
			}
		}
	}
	const groups = database.MapKit.Configs.TileStyles;
	return {
		tileGroups: manifest.tileGroup.length,
		tileSets: manifest.tileSet.length,
		unresolvedReferences,
		daytimeLayers,
		satellite3DStyles: groups.Satellite3D.filter(style => styles.has(style)),
		flyoverStyles: groups.Flyover.filter(style => styles.has(style)),
		listsFlyoverMetadata: manifest.resource.some(r => r.filename?.split("/").pop()?.toLowerCase() === "flyover-meta.json"),
	};
}

if (process.argv.length !== 3) {
	console.error("Usage: node scripts/inspect-satellite-manifest.mjs <ResourceManifest.pbd>");
	process.exitCode = 2;
} else {
	try {
		console.log(JSON.stringify(summarize(readMacManifest(process.argv[2])), null, 2));
	} catch {
		console.error("Could not read a Mac GeoServices manifest containing tile groups and tile sets.");
		process.exitCode = 1;
	}
}
