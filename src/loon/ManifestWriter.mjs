// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import { BinaryWriter } from "@protobuf-ts/runtime";
import { MAX_OUTPUT_BYTES } from "./common.mjs";

// Use the locked protobuf runtime's scalar conversions and the original schema,
// but write into one growing buffer instead of retaining a chunk per field.
export default class ManifestWriter extends BinaryWriter {
	constructor(limit = MAX_OUTPUT_BYTES) {
		super();
		if (!Number.isInteger(limit) || limit < 0 || limit > MAX_OUTPUT_BYTES) throw new RangeError("Invalid manifest output limit");
		this.limit = limit;
		this.output = new Uint8Array(Math.min(1024, limit));
		this.position = 0;
		// The inherited bool/int32/int64 implementations only need push(byte).
		// Keep their tested signed/64-bit conversion without a growing JS array.
		this.buf = {
			push: value => {
				this.reserve(1);
				this.output[this.position++] = value;
			},
		};
	}
	reserve(count) {
		const required = this.position + count;
		if (!Number.isInteger(count) || count < 0 || required > this.limit) throw new RangeError("Manifest output exceeds limit");
		if (required <= this.output.length) return;
		const capacity = Math.max(required, Math.min(this.limit, Math.max(1024, this.output.length * 2)));
		const next = new Uint8Array(capacity);
		next.set(this.output.subarray(0, this.position));
		this.output = next;
	}
	uint32(value) {
		if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error("invalid uint32");
		const size = value < 128 ? 1 : value < 16384 ? 2 : value < 2097152 ? 3 : value < 268435456 ? 4 : 5;
		this.reserve(size);
		while (value > 127) {
			this.output[this.position++] = (value & 127) | 128;
			value >>>= 7;
		}
		this.output[this.position++] = value;
		return this;
	}
	raw(chunk) {
		this.reserve(chunk.byteLength);
		this.output.set(chunk, this.position);
		this.position += chunk.byteLength;
		return this;
	}
	fork() {
		if (this.stack.length >= 64) throw new RangeError("Manifest nesting exceeds limit");
		this.reserve(1);
		this.stack.push(this.position++);
		return this;
	}
	join() {
		const start = this.stack.pop();
		if (start === undefined) throw new Error("Unmatched manifest join");
		let length = this.position - start - 1;
		const width = length < 128 ? 1 : length < 16384 ? 2 : length < 2097152 ? 3 : 4;
		const extra = width - 1;
		if (extra) {
			this.reserve(extra);
			this.output.copyWithin(start + width, start + 1, this.position);
			this.position += extra;
		}
		let offset = start;
		while (length > 127) {
			this.output[offset++] = (length & 127) | 128;
			length >>>= 7;
		}
		this.output[offset] = length;
		return this;
	}
	finish() {
		if (this.stack.length) throw new Error("Unfinished manifest fork");
		const result = this.output.subarray(0, this.position);
		// The returned view owns the old backing buffer. A later write cannot
		// mutate it; unused capacity is bounded by the same 4 MiB output limit.
		this.output = new Uint8Array(0);
		this.position = 0;
		return result;
	}
}
