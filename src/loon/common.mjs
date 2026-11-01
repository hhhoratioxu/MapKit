// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
export const MAX_CACHE_BYTES = 1024 * 1024;
export const MAX_MANIFEST_BYTES = 2 * MAX_CACHE_BYTES;
export const MAX_OUTPUT_BYTES = 4 * MAX_CACHE_BYTES;
export const MAX_DEFAULTS_BYTES = 256 * 1024;
export const MANIFEST_PATH = "/geo_manifest/dynamic/config";
export const MANIFEST_HOSTS = new Set(["gspe35-ssl.ls.apple.com", "gspe35-ssl.ls.apple.cn"]);

export function header(headers, name) {
	const key = Object.keys(headers ?? {}).find(key => key.toLowerCase() === name.toLowerCase());
	return key && typeof headers[key] === "string" ? headers[key] : "";
}

export function bytes(value) {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	return null;
}

export function manifestURL(value) {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || !MANIFEST_HOSTS.has(url.hostname) || url.pathname !== MANIFEST_PATH || url.port || url.username || url.password || url.href.length > 4096) return null;
		return url;
	} catch {
		return null;
	}
}

export function cacheKey(value) {
	const url = manifestURL(value);
	if (!url || url.search.length > 2048) return null;
	const keys = new Set();
	for (const [key] of url.searchParams) {
		if (keys.has(key) || keys.size >= 32) return null;
		keys.add(key);
	}
	url.hash = "";
	url.searchParams.sort();
	return url.toString();
}

export function replaceHeaders(headers) {
	const result = { ...headers };
	for (const key of Object.keys(result)) if (["content-length", "content-encoding", "transfer-encoding", "etag", "last-modified", "content-md5", "digest"].includes(key.toLowerCase())) delete result[key];
	result["Cache-Control"] = "no-store";
	return result;
}

export function requestHeaders(headers, etag) {
	const result = { "Accept-Encoding": "identity" };
	for (const key of Object.keys(headers ?? {})) if (["accept", "accept-language", "user-agent"].includes(key.toLowerCase()) && typeof headers[key] === "string") result[key] = headers[key];
	if (etag) result["If-None-Match"] = etag;
	return result;
}

// Validate protobuf wire framing without loading the generated schema in Request.
// Semantic validation occurs with the original codec before any response is edited.
export function validWire(input) {
	const data = bytes(input);
	if (!data?.length || data.length > MAX_MANIFEST_BYTES) return false;
	return validFraming(data.length, pos => data[pos]);
}

// The same framing checks also run directly over cached Base64. Request needs
// proof that a body exists, not an allocated copy of that body.
function validFraming(length, byteAt) {
	let pos = 0,
		fields = 0;
	const varint = () => {
		let value = 0;
		for (let i = 0; i < 5 && pos < length; i++) {
			const byte = byteAt(pos++);
			value += (byte & 127) * 2 ** (7 * i);
			if (!(byte & 128)) return value <= 0xffffffff ? value : -1;
		}
		return -1;
	};
	while (pos < length && fields++ < 100000) {
		const tag = varint();
		if (tag < 8) return false;
		switch (tag % 8) {
			case 0: {
				let complete = false;
				for (let i = 0; i < 10 && pos < length; i++) {
					const byte = byteAt(pos++);
					if (i === 9 && byte > 1) return false;
					if (!(byte & 128)) {
						complete = true;
						break;
					}
				}
				if (!complete) return false;
				break;
			}
			case 1:
				pos += 8;
				break;
			case 2: {
				const length = varint();
				if (length < 0) return false;
				pos += length;
				break;
			}
			case 5:
				pos += 4;
				break;
			default:
				return false;
		}
		if (pos > length) return false;
	}
	return pos === length && fields <= 100000;
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function encodeBase64(data) {
	const chunks = [];
	const chunk = new Uint8Array(Math.min(8192, Math.ceil(data.length / 3) * 4));
	let used = 0;
	for (let i = 0; i < data.length; i += 3) {
		const a = data[i],
			b = data[i + 1],
			c = data[i + 2];
		chunk[used++] = alphabet.charCodeAt(a >> 2);
		chunk[used++] = alphabet.charCodeAt(((a & 3) << 4) | ((b ?? 0) >> 4));
		chunk[used++] = i + 1 < data.length ? alphabet.charCodeAt(((b & 15) << 2) | ((c ?? 0) >> 6)) : 61;
		chunk[used++] = i + 2 < data.length ? alphabet.charCodeAt(c & 63) : 61;
		if (used === chunk.length) {
			chunks.push(String.fromCharCode.apply(null, chunk));
			used = 0;
		}
	}
	if (used) chunks.push(String.fromCharCode.apply(null, chunk.subarray(0, used)));
	return chunks.join("");
}

const base64Digit = code => {
	if (code >= 65 && code <= 90) return code - 65;
	if (code >= 97 && code <= 122) return code - 71;
	if (code >= 48 && code <= 57) return code + 4;
	return code === 43 ? 62 : code === 47 ? 63 : -1;
};

function base64Length(value, start, end) {
	const encoded = end - start;
	if (typeof value !== "string" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > value.length || encoded <= 0 || encoded % 4 || encoded > Math.ceil(MAX_CACHE_BYTES / 3) * 4) return 0;
	const padding = value.charCodeAt(end - 1) === 61 ? (value.charCodeAt(end - 2) === 61 ? 2 : 1) : 0;
	const length = (encoded / 4) * 3 - padding;
	if (length > MAX_CACHE_BYTES) return 0;
	// Sticky test scans the original string range without creating a large
	// substring or a match array. Check the exact end, including JSON suffixes.
	const valid = /[A-Za-z0-9+/]+={0,2}/y;
	valid.lastIndex = start;
	if (!valid.test(value) || valid.lastIndex !== end) return 0;
	return length;
}

export function validBase64Wire(value, start = 0, end = value?.length) {
	const length = base64Length(value, start, end);
	if (!length) return false;
	return validFraming(length, pos => {
		const offset = start + ((pos / 3) | 0) * 4;
		const index = pos % 3;
		const a = base64Digit(value.charCodeAt(offset + index));
		const b = base64Digit(value.charCodeAt(offset + index + 1));
		return index === 0 ? (a << 2) | (b >> 4) : index === 1 ? ((a & 15) << 4) | (b >> 2) : ((a & 3) << 6) | b;
	});
}

export function decodeBase64(value, start = 0, end = value?.length) {
	const length = base64Length(value, start, end);
	if (!length) return null;
	const data = new Uint8Array(length);
	let offset = 0;
	for (let i = start; i < end; i += 4) {
		const a = base64Digit(value.charCodeAt(i)),
			b = base64Digit(value.charCodeAt(i + 1)),
			c = base64Digit(value.charCodeAt(i + 2)),
			d = base64Digit(value.charCodeAt(i + 3));
		data[offset++] = (a << 2) | (b >> 4);
		if (offset < length) data[offset++] = ((b & 15) << 4) | (c >> 2);
		if (offset < length) data[offset++] = ((c & 3) << 6) | d;
	}
	return data;
}
