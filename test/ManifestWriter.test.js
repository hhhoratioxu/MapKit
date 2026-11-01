// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { BinaryWriter, UnknownFieldHandler } from "@protobuf-ts/runtime";
import { Resources } from "@nsringo/mapkit";
import ManifestWriter from "../src/loon/ManifestWriter.mjs";
import { MAX_OUTPUT_BYTES } from "../src/loon/common.mjs";
import ManifestCache from "../src/loon/ManifestCache.mjs";
import { processResponse } from "../src/loon/Response.mjs";
import { manifest, manifestURL, memoryStore } from "./helpers.mjs";

const compare = write => {
	const old = new BinaryWriter(),
		current = new ManifestWriter();
	write(old);
	write(current);
	assert.deepEqual(current.finish(), old.finish());
};
const scalarCases = {
	uint32: [0, 1, 127, 128, 16383, 16384, 2097151, 2097152, 268435455, 268435456, 4294967295],
	int32: [-2147483648, -128, -1, 0, 1, 127, 128, 2147483647],
	sint32: [-2147483648, -1000, -1, 0, 1, 1000, 2147483647],
	bool: [true, false],
	fixed32: [0, 4294967295],
	sfixed32: [-2147483648, 0, 2147483647],
	uint64: ["0", "127", "128", "4294967296", "9007199254740991", "18446744073709551615"],
	int64: ["-9223372036854775808", "-1", "0", "1", "9223372036854775807"],
	sint64: ["-9223372036854775808", "-128", "0", "128", "9223372036854775807"],
	fixed64: ["0", "9007199254740991", "18446744073709551615"],
	sfixed64: ["-9223372036854775808", "0", "9223372036854775807"],
	float: [Number.NEGATIVE_INFINITY, -3.4028234663852886e38, -0, 0, 0.125, 1.234, Number.POSITIVE_INFINITY, Number.NaN],
	double: [Number.NEGATIVE_INFINITY, -Number.MAX_VALUE, -0, 0, Number.MIN_VALUE, Math.PI, Number.POSITIVE_INFINITY, Number.NaN],
	string: ["", "ASCII", "高德地图 🗺️", "\ud800", "\udc00", "x\ud800y", "a".repeat(16384)],
	bytes: [new Uint8Array(), new Uint8Array([0, 255, 128, 1]), new Uint8Array(65537)],
};
for (const [method, values] of Object.entries(scalarCases))
	test(`direct manifest writer matches original ${method}`, () =>
		compare(writer => {
			for (const value of values) writer[method](value);
		}));

for (const size of [0, 1, 126, 127, 128, 129, 1024, 16383, 16384, 2097151, 2097152])
	test(`nested length prefix matches at payload size ${size}`, () =>
		compare(writer => {
			writer.tag(1, 2).fork().tag(2, 2).fork().raw(new Uint8Array(size)).join().uint32(27).join().tag(4, 0).uint32(42);
		}));

test("finished output is an exact-length view, remains stable on reuse and never exceeds its backing limit", () => {
	const writer = new ManifestWriter(20);
	writer.uint32(10).uint32(20);
	const first = writer.finish();
	assert.deepEqual(first, new Uint8Array([10, 20]));
	assert.ok(first.buffer.byteLength <= 20);
	writer.uint32(99);
	assert.deepEqual(writer.finish(), new Uint8Array([99]));
	assert.deepEqual(first, new Uint8Array([10, 20]));
});

test("output limit is checked before buffer growth including length-prefix insertion", () => {
	const writer = new ManifestWriter(130);
	writer.fork().raw(new Uint8Array(129));
	assert.throws(() => writer.join(), /exceeds limit/);
	assert.ok(writer.output.byteLength <= 130);
	const full = new ManifestWriter();
	full.raw(new Uint8Array(MAX_OUTPUT_BYTES));
	assert.throws(() => full.bool(true), /exceeds limit/);
	assert.equal(full.output.byteLength, MAX_OUTPUT_BYTES);
	assert.equal(full.finish().byteLength, MAX_OUTPUT_BYTES);
	assert.equal(new ManifestWriter(0).finish().byteLength, 0);
});

test("invalid scalar inputs retain original rejection behavior", () => {
	for (const [method, values] of Object.entries({ uint32: [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 4294967296, "1"], int32: [-2147483649, 2147483648, 1.5], float: [Number.MAX_VALUE] }))
		for (const value of values) {
			assert.throws(() => new BinaryWriter()[method](value));
			assert.throws(() => new ManifestWriter()[method](value));
		}
	for (const limit of [-1, Number.NaN, Number.POSITIVE_INFINITY, MAX_OUTPUT_BYTES + 1]) assert.throws(() => new ManifestWriter(limit));
});

test("unmatched forks, joins and excessive nesting are rejected", () => {
	assert.throws(() => new ManifestWriter().join());
	assert.throws(() => new ManifestWriter().fork().finish());
	const writer = new ManifestWriter();
	for (let i = 0; i < 64; i++) writer.fork();
	assert.throws(() => writer.fork(), /nesting/);
	for (let i = 0; i < 64; i++) writer.join();
	assert.ok(writer.finish().length);
});

test("original generated schema and unknown fields produce identical bytes over 300 layouts", () => {
	let state = 20261101;
	const random = n => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state % n;
	};
	for (let trial = 0; trial < 300; trial++) {
		const body = Resources.fromBinary(
			manifest(
				"codec",
				Array.from({ length: random(150) + 1 }, () => random(10000)),
			),
		);
		body.tileGroup = Resources.create({ tileGroup: Array.from({ length: random(15) }, (_, i) => ({ identifier: i, attributionIndex: [0, 127, 128, 10000], tileSet: [{ tileSetIndex: i, identifier: 4294967295 }] })) }).tileGroup;
		UnknownFieldHandler.onRead("Resources", body, 500, 2, new Uint8Array([3, 0, 127, 255]));
		UnknownFieldHandler.onRead("TileSet", body.tileSet[0], 501, 0, new Uint8Array([255, 1]));
		assert.deepEqual(Resources.toBinary(body, { writerFactory: () => new ManifestWriter() }), Resources.toBinary(body));
	}
});

test("output expansion exceeding 4 MiB keeps the original response and cached source", () => {
	const store = memoryStore(),
		source = Resources.fromBinary(manifest("cn")),
		target = Resources.fromBinary(manifest("us"));
	source.urlInfoSet[0].dispatcherURL.url = "https://cn.example/" + "x".repeat(100000);
	target.urlInfoSet = Array.from({ length: 60 }, () => target.urlInfoSet[0]);
	new ManifestCache(store).put(manifestURL.replace("US", "CN"), Resources.toBinary(source));
	const input = Resources.toBinary(target),
		original = input.slice(),
		saved = [...store.data];
	assert.deepEqual(processResponse({ url: manifestURL }, { status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: input }, {}, store), {});
	assert.deepEqual(input, original);
	assert.deepEqual([...store.data], saved);
});
