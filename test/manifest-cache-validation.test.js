import assert from "node:assert/strict";
import test from "node:test";
import { BinaryWriter, ScalarType, WireType } from "@protobuf-ts/runtime";
import { Resources } from "@nsringo/mapkit";
import validate from "../src/class/validateManifestCache.mjs";

const concat = (...parts) => Buffer.concat(parts.map(part => Buffer.from(part)));
const field = (no, wire, value) => {
	const writer = new BinaryWriter().tag(no, wire);
	if (wire === WireType.LengthDelimited) writer.bytes(Uint8Array.from(value));
	else writer.raw(Uint8Array.from(value));
	return writer.finish();
};
function pathTo(predicate, type = Resources, path = []) {
	for (const item of type.fields) {
		if (predicate(item)) return [...path, item];
		if (item.kind === "message") {
			const found = pathTo(predicate, item.T(), [...path, item]);
			if (found) return found;
		}
	}
}
function wrapPath(path, bytes) {
	for (let index = path.length - 2; index >= 0; index--) bytes = field(path[index].no, WireType.LengthDelimited, bytes);
	return bytes;
}
function schemaMessage(type = Resources) {
	const result = type.create();
	for (const item of type.fields) {
		let value;
		if (item.kind === "message") value = schemaMessage(item.T());
		else if (item.kind === "enum") value = -1;
		else switch (item.T) {
			case ScalarType.UINT32: value = 0xffffffff; break;
			case ScalarType.UINT64: value = Number.MAX_SAFE_INTEGER; break;
			case ScalarType.BOOL: value = true; break;
			case ScalarType.STRING: value = "offline 地圖 🌍\u0000"; break;
			case ScalarType.BYTES: value = Uint8Array.of(0, 0xff, 0x80); break;
			default: throw new Error("Update the compatibility corpus for the changed locked schema");
		}
		result[item.localName] = item.repeat ? [value, value] : value;
	}
	return result;
}
const allFields = Resources.toBinary(schemaMessage());
const stringPath = [Resources.fields.find(item => item.kind === "scalar" && item.T === ScalarType.STRING)];
const nestedStringPath = pathTo(item => item.kind === "message" && item.T().fields.some(child => child.kind === "scalar" && child.T === ScalarType.STRING));
const nestedString = nestedStringPath.at(-1).T().fields.find(item => item.kind === "scalar" && item.T === ScalarType.STRING);
const packedPath = pathTo(item => item.repeat && item.kind === "enum");
const uint64Path = pathTo(item => item.kind === "scalar" && item.T === ScalarType.UINT64);

test("cache preflight accepts the locked schema's fields and legal duplicate messages", () => {
	for (const bytes of [allFields, concat(allFields, allFields), Resources.toBinary(Resources.create({ releaseInfo: "offline" }))]) {
		assert.doesNotThrow(() => Resources.fromBinary(bytes));
		assert.equal(validate(bytes), true);
	}
});

test("cache preflight accepts both packed and unpacked repeated enums, including split packs", () => {
	const no = packedPath.at(-1).no;
	const values = new BinaryWriter().int32(0).int32(1).int32(-1).finish();
	const unpacked = new BinaryWriter().tag(no, WireType.Varint).int32(0).tag(no, WireType.Varint).int32(1).tag(no, WireType.Varint).int32(-1).finish();
	for (const payload of [field(no, WireType.LengthDelimited, values), unpacked, concat(field(no, WireType.LengthDelimited, new Uint8Array()), unpacked, field(no, WireType.LengthDelimited, values))]) {
		const bytes = wrapPath(packedPath, payload);
		assert.doesNotThrow(() => Resources.fromBinary(bytes));
		assert.equal(validate(bytes), true);
	}
});

test("cache preflight checks UTF-8 at top level and inside nested messages", () => {
	for (const invalid of [[0x80], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf0, 0x9f]]) {
		const top = wrapPath(stringPath, field(stringPath.at(-1).no, WireType.LengthDelimited, invalid));
		const nested = wrapPath([...nestedStringPath, nestedString], field(nestedString.no, WireType.LengthDelimited, invalid));
		for (const bytes of [top, nested]) {
			assert.throws(() => Resources.fromBinary(bytes));
			assert.throws(() => validate(bytes));
		}
	}
});

test("cache preflight matches the locked codec at uint64 NUMBER boundaries", () => {
	const no = uint64Path.at(-1).no;
	const safe = wrapPath(uint64Path, new BinaryWriter().tag(no, WireType.Varint).uint64(Number.MAX_SAFE_INTEGER).finish());
	const maximum = wrapPath(uint64Path, new BinaryWriter().tag(no, WireType.Varint).uint64("18446744073709551615").finish());
	const unsafe = wrapPath(uint64Path, new BinaryWriter().tag(no, WireType.Varint).uint64("9007199254740992").finish());
	assert.doesNotThrow(() => Resources.fromBinary(safe));
	assert.equal(validate(safe), true);
	assert.doesNotThrow(() => Resources.fromBinary(maximum));
	assert.equal(validate(maximum), true);
	assert.throws(() => Resources.fromBinary(unsafe));
	assert.throws(() => validate(unsafe));
});

test("short and long numeric encodings respect both packed and child message boundaries", () => {
	const path = pathTo(item => item.kind === "scalar" && item.T === ScalarType.UINT32 && item.repeat);
	const number = path.at(-1).no;
	const values = [0, 1, 127, 128, 255, 16384, 0xffffffff];
	const packed = new BinaryWriter();
	const plain = new BinaryWriter();
	for (const value of values) {
		packed.uint32(value);
		plain.tag(number, WireType.Varint).uint32(value);
	}
	for (const content of [plain.finish(), field(number, WireType.LengthDelimited, packed.finish())]) {
		const bytes = wrapPath(path, content);
		assert.doesNotThrow(() => Resources.fromBinary(bytes));
		assert.equal(validate(bytes), true);
	}
	const missing = new BinaryWriter().tag(number, WireType.Varint).finish();
	const incompletePack = field(number, WireType.LengthDelimited, [0x7f, 0x80]);
	for (const content of [missing, incompletePack]) assert.throws(() => validate(concat(wrapPath(path, content), allFields)));
});

test("cache preflight handles every unknown wire type without retaining unknown data", () => {
	const no = 50000;
	const unknown = new BinaryWriter().tag(no, WireType.Varint).uint64("18446744073709551615")
		.tag(no + 1, WireType.Bit64).fixed64("18446744073709551615")
		.tag(no + 2, WireType.LengthDelimited).bytes(Uint8Array.of(0xff, 0x80))
		.tag(no + 3, WireType.Bit32).fixed32(0xffffffff)
		.tag(no + 4, WireType.StartGroup).tag(no + 5, WireType.Varint).uint32(1).tag(no + 4, WireType.EndGroup).finish();
	for (const bytes of [unknown, concat(allFields, unknown), field(nestedStringPath[0].no, WireType.LengthDelimited, unknown)]) {
		assert.doesNotThrow(() => Resources.fromBinary(bytes));
		assert.equal(validate(bytes), true);
	}
});

test("cache preflight rejects unterminated, mismatched and excessively nested unknown groups", () => {
	const group = depth => {
		const writer = new BinaryWriter();
		for (let i = 0; i < depth; i++) writer.tag(50000 + i, WireType.StartGroup);
		for (let i = depth - 1; i >= 0; i--) writer.tag(50000 + i, WireType.EndGroup);
		return writer.finish();
	};
	assert.equal(validate(group(8)), true);
	for (const bytes of [group(4096), new BinaryWriter().tag(50000, WireType.StartGroup).finish(), new BinaryWriter().tag(50000, WireType.StartGroup).tag(50001, WireType.EndGroup).finish(), new BinaryWriter().tag(50000, WireType.EndGroup).finish()]) assert.throws(() => validate(bytes));
	// An end-group outside the child message must not close a group inside it.
	assert.throws(() => validate(concat(field(nestedStringPath[0].no, WireType.LengthDelimited, new BinaryWriter().tag(50000, WireType.StartGroup).finish()), new BinaryWriter().tag(50000, WireType.EndGroup).finish())));
});

test("cache preflight rejects bad known wire types and scalar/packed reads crossing child boundaries", () => {
	const child = concat(new BinaryWriter().tag(nestedString.no, WireType.LengthDelimited).uint32(5).finish(), [0x61]);
	const truncatedNested = concat(wrapPath(nestedStringPath, field(nestedStringPath.at(-1).no, WireType.LengthDelimited, child)), allFields);
	const packed = wrapPath(packedPath, field(packedPath.at(-1).no, WireType.LengthDelimited, [0x80]));
	const badWire = new BinaryWriter().tag(stringPath.at(-1).no, WireType.Varint).uint32(0).finish();
	const badMessage = new BinaryWriter().tag(nestedStringPath[0].no, WireType.Varint).uint32(0).finish();
	for (const bytes of [truncatedNested, packed, wrapPath(stringPath, badWire), badMessage, Uint8Array.of(0), Uint8Array.of(0xff), new Uint8Array()]) assert.throws(() => validate(bytes));
});

test("cache preflight bounds unknown fields to the current nested message", () => {
	for (const body of [new BinaryWriter().tag(50000, WireType.LengthDelimited).uint32(10).raw(Uint8Array.of(1)).finish(), new BinaryWriter().tag(50000, WireType.Bit64).raw(Uint8Array.of(1)).finish(), new BinaryWriter().tag(50000, WireType.Varint).raw(Uint8Array.of(0x80)).finish()]) {
		const bytes = concat(field(nestedStringPath[0].no, WireType.LengthDelimited, body), allFields);
		assert.throws(() => validate(bytes));
	}
	assert.throws(() => validate(new BinaryWriter().tag(50000, WireType.Varint).raw(new Uint8Array(11).fill(0x80)).raw(Uint8Array.of(0)).finish()));
});

test("unsupported schema fields reject both conditional caches in one request", async () => {
	for (const extra of [{ no: 500, kind: "map" }, { no: 501, kind: "scalar", T: ScalarType.UINT32, oneof: "future" }]) {
		// An isolated module has an empty descriptor cache. Restore the locked
		// schema immediately after each synchronous pair of test calls.
		const { default: freshValidate } = await import(`../src/class/validateManifestCache.mjs?unsupported=${extra.no}`);
		Resources.fields.push(extra);
		try {
			assert.throws(() => freshValidate(allFields), /Unsupported manifest cache/);
			assert.throws(() => freshValidate(allFields), /Unsupported manifest cache/);
		} finally { Resources.fields.pop(); }
	}
});

test("fixed-seed cache corruption corpus never accepts a payload rejected by the full codec", context => {
	let seed = 0x6d61706b;
	const random = limit => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % limit; };
	let rejected = 0, conservative = 0;
	for (let index = 0; index < 3000; index++) {
		let bytes = Buffer.from(allFields);
		if (index % 3 === 0) bytes = bytes.subarray(0, random(bytes.length));
		else for (let flip = 0; flip <= index % 5; flip++) bytes[random(bytes.length)] ^= 1 << random(8);
		let codecOK = true, preflightOK = true;
		try { Resources.fromBinary(bytes); } catch { codecOK = false; }
		try { validate(bytes); } catch { preflightOK = false; }
		assert.ok(!preflightOK || codecOK, `false acceptance at mutation ${index}`);
		if (!codecOK) rejected++;
		else if (!preflightOK) conservative++;
	}
	assert.ok(rejected > 500, "corpus must contain actual decoding failures");
	// Stricter rejection is allowed only for conditional-cache reuse; no payload is rewritten.
	context.diagnostic(`3000 mutations: ${rejected} rejected by both, ${conservative} conservative rejections, 0 false acceptances`);
});
