import { BinaryReader, LongType, ScalarType, WireType } from "@protobuf-ts/runtime";
import { Resources } from "@nsringo/mapkit";

// Request-side preflight only. Response decoding still uses the original codec,
// including unknown-field preservation. The locked schema is four levels deep;
// unsupported schema additions or excessive nesting disable conditional reuse.
const maxDepth = 16;
const fieldsByType = new WeakMap();
const scalarReaders = {
	[ScalarType.UINT32]: reader => reader.uint32(),
	[ScalarType.BOOL]: reader => reader.bool(),
	[ScalarType.STRING]: reader => reader.string(), // Runtime's fatal UTF-8 decoder.
	[ScalarType.BYTES]: reader => reader.bytes(),
};
const readEnum = reader => reader.int32();
const readLongNumber = reader => reader.uint64().toNumber();
const readLongString = reader => reader.uint64().toString();

function fieldsFor(type, depth = 0) {
	let fields = fieldsByType.get(type);
	if (fields) return fields;
	if (depth >= maxDepth) throw new Error("Unsupported manifest cache schema nesting");
	fields = [];
	for (const field of type.fields) {
		if (field.oneof) throw new Error("Unsupported manifest cache oneof");
		const tagBase = field.no * 8;
		if (field.kind === "message") {
			fields[tagBase + WireType.LengthDelimited] = { children: fieldsFor(field.T(), depth + 1) };
			continue;
		}
		let read;
		if (field.kind === "enum") read = readEnum;
		else if (field.kind === "scalar") {
			if (field.T === ScalarType.UINT64) {
				if (field.L === LongType.NUMBER) read = readLongNumber;
				else if (field.L === LongType.STRING) read = readLongString;
			} else read = scalarReaders[field.T];
		}
		if (!read) throw new Error("Unsupported manifest cache field");
		const delimited = field.T === ScalarType.STRING || field.T === ScalarType.BYTES;
		fields[tagBase + (delimited ? WireType.LengthDelimited : WireType.Varint)] = { read, varint: !delimited };
		if (field.repeat && !delimited) fields[tagBase + WireType.LengthDelimited] = { read, varint: true, packed: true };
	}
	// Publish only complete plans. A rejected schema must never leave a partial
	// plan that could be reused by a second cache in the same request.
	fieldsByType.set(type, fields);
	return fields;
}

function checkPosition(reader, end) {
	if (reader.pos > end) throw new Error("Manifest cache field exceeds its boundary");
}

function delimitedEnd(reader, end) {
	const length = reader.uint32();
	const childEnd = reader.pos + length;
	if (childEnd > end) throw new Error("Truncated manifest cache field");
	return childEnd;
}

function skipUnknown(reader, fieldNo, wireType, end, depth) {
	if (wireType === WireType.StartGroup) {
		if (depth >= maxDepth) throw new Error("Manifest cache nesting limit");
		while (reader.pos < end) {
			const [childNo, childWire] = reader.tag();
			checkPosition(reader, end);
			if (childWire === WireType.EndGroup) {
				if (childNo !== fieldNo) throw new Error("Mismatched manifest cache group");
				return;
			}
			skipUnknown(reader, childNo, childWire, end, depth + 1);
		}
		throw new Error("Unclosed manifest cache group");
	}
	// Let the locked runtime consume unknown fields without retaining them.
	// Bound groups above instead of delegating unbounded recursive group skipping.
	const data = reader.skip(wireType);
	checkPosition(reader, end);
	if (wireType === WireType.Varint && (data.length > 10 || (data.length === 10 && data[9] > 1))) throw new Error("Invalid manifest cache varint");
}

function message(reader, bytes, fields, end, depth) {
	if (depth >= maxDepth) throw new Error("Manifest cache nesting limit");
	while (reader.pos < end) {
		// A known raw tag names both the field and its permitted wire encoding.
		let tag = bytes[reader.pos];
		if (tag < 0x80) reader.pos++;
		else {
			tag = reader.uint32();
			checkPosition(reader, end);
		}
		const field = fields[tag];
		if (!field) {
			const fieldNo = tag >>> 3;
			const wireType = tag & 7;
			if (!fieldNo || wireType > WireType.Bit32) throw new Error("Illegal manifest cache tag");
			const tagBase = fieldNo * 8;
			if (fields[tagBase + WireType.Varint] || fields[tagBase + WireType.LengthDelimited]) throw new Error("Invalid manifest cache wire type");
			skipUnknown(reader, fieldNo, wireType, end, depth);
		} else if (field.children) {
			message(reader, bytes, field.children, delimitedEnd(reader, end), depth + 1);
		} else {
			const valueEnd = field.packed ? delimitedEnd(reader, end) : end;
			if (field.packed && reader.pos === valueEnd) continue;
			do {
				// A terminating single byte is a complete value in the range 0..127
				// for every numeric type in this schema. The runtime reads every longer value.
				if (field.varint && reader.pos < valueEnd && bytes[reader.pos] < 0x80) reader.pos++;
				else {
					field.read(reader);
					checkPosition(reader, valueEnd);
				}
			} while (field.packed && reader.pos < valueEnd);
		}
	}
}

/** Validate the locked Resources wire format without building a message tree. */
export default function validateManifestCache(bytes) {
	if (!bytes.length) throw new Error("Empty manifest cache");
	const reader = new BinaryReader(bytes);
	message(reader, bytes, fieldsFor(Resources), bytes.length, 0);
	return true;
}
