//import { MESSAGE_TYPE, reflectionMergePartial, BinaryReader, WireType, UnknownFieldHandler, isJsonObject, typeofJsonValue, jsonWriteOptions, MessageType } from "@protobuf-ts/runtime";
import {
	GenericTileType,
	Resource_UpdateMethod,
	Resource_ValidationMethod,
	ResourceDownloadConnectionType,
	ResourceFilterScale,
	ResourceFilterScenario,
	Resources,
	ResourceType,
	TileScale,
	TileSet_TileRequestStyle,
	TileSet_TileSetChecksumType,
	TileSet_TileSetVersionUpdateBehavior,
	TileSetStyle,
	TileSize,
} from "@nsringo/mapkit";

// Fork optimization: convert enums in place and preserve unknown numeric values.
// Avoid allocating replacement arrays for each nested protobuf collection.
function convertEnums(body) {
	const map = (table, value) => table[value] ?? value;
	const resourceEnums = resource => {
		if (resource.resourceType !== undefined) resource.resourceType = map(ResourceType, resource.resourceType);
		for (const filter of resource.filter ?? []) {
			if (filter.scale) for (let i = 0; i < filter.scale.length; i++) filter.scale[i] = map(ResourceFilterScale, filter.scale[i]);
			if (filter.scenario) for (let i = 0; i < filter.scenario.length; i++) filter.scenario[i] = map(ResourceFilterScenario, filter.scenario[i]);
		}
		if (resource.connectionType !== undefined) resource.connectionType = map(ResourceDownloadConnectionType, resource.connectionType);
		if (resource.validationMethod !== undefined) resource.validationMethod = map(Resource_ValidationMethod, resource.validationMethod);
		if (resource.updateMethod !== undefined) resource.updateMethod = map(Resource_UpdateMethod, resource.updateMethod);
	};
	for (const tile of body.tileSet ?? []) {
		if (tile.style !== undefined) tile.style = map(TileSetStyle, tile.style);
		for (const version of tile.validVersion ?? []) for (const generic of version.genericTile ?? []) if (generic.tileType !== undefined) generic.tileType = map(GenericTileType, generic.tileType);
		if (tile.scale !== undefined) tile.scale = map(TileScale, tile.scale);
		if (tile.size !== undefined) tile.size = map(TileSize, tile.size);
		if (tile.updateBehavior !== undefined) tile.updateBehavior = map(TileSet_TileSetVersionUpdateBehavior, tile.updateBehavior);
		if (tile.checksumType !== undefined) tile.checksumType = map(TileSet_TileSetChecksumType, tile.checksumType);
		if (tile.requestStyle !== undefined) tile.requestStyle = map(TileSet_TileRequestStyle, tile.requestStyle);
	}
	for (const attribution of body.attribution ?? []) for (const resource of attribution.resource ?? []) resourceEnums(resource);
	for (const resource of body.resource ?? []) resourceEnums(resource);
	return body;
}

export default class GEOResourceManifestDownload {
	static decode(rawBody = new Uint8Array()) {
		return convertEnums(Resources.fromBinary(rawBody));
	}
	static encode(body = {}) {
		return Resources.toBinary(convertEnums(body));
	}
}
