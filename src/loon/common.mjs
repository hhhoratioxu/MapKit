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
	let pos = 0,
		fields = 0;
	const varint = () => {
		let value = 0;
		for (let i = 0; i < 5 && pos < data.length; i++) {
			const byte = data[pos++];
			value += (byte & 127) * 2 ** (7 * i);
			if (!(byte & 128)) return value <= 0xffffffff ? value : -1;
		}
		return -1;
	};
	while (pos < data.length && fields++ < 100000) {
		const tag = varint();
		if (tag < 8) return false;
		switch (tag % 8) {
			case 0: {
				let complete = false;
				for (let i = 0; i < 10 && pos < data.length; i++) {
					const byte = data[pos++];
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
		if (pos > data.length) return false;
	}
	return pos === data.length && fields <= 100000;
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function encodeBase64(data) {
	const chunks = [];
	let chunk = "";
	for (let i = 0; i < data.length; i += 3) {
		const a = data[i],
			b = data[i + 1],
			c = data[i + 2];
		chunk += alphabet[a >> 2] + alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)] + (i + 1 < data.length ? alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)] : "=") + (i + 2 < data.length ? alphabet[c & 63] : "=");
		if (chunk.length >= 8192) {
			chunks.push(chunk);
			chunk = "";
		}
	}
	if (chunk) chunks.push(chunk);
	return chunks.join("");
}

export function decodeBase64(value) {
	if (typeof value !== "string" || !value.length || value.length > Math.ceil(MAX_CACHE_BYTES / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
	const length = (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
	if (length > MAX_CACHE_BYTES) return null;
	const data = new Uint8Array(length);
	let offset = 0;
	for (let i = 0; i < value.length; i += 4) {
		const a = alphabet.indexOf(value[i]),
			b = alphabet.indexOf(value[i + 1]),
			c = alphabet.indexOf(value[i + 2]),
			d = alphabet.indexOf(value[i + 3]);
		if (a < 0 || b < 0 || (c < 0 && value[i + 2] !== "=") || (d < 0 && value[i + 3] !== "=")) return null;
		data[offset++] = (a << 2) | (b >> 4);
		if (offset < length) data[offset++] = ((b & 15) << 4) | (c >> 2);
		if (offset < length) data[offset++] = ((c & 3) << 6) | d;
	}
	return data;
}
