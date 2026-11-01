// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import { cacheKey, decodeBase64, encodeBase64, MAX_CACHE_BYTES, validBase64Wire, validWire } from "./common.mjs";
export const CACHE_PREFIX = "Horatio.MapKit.v1.";
export const CACHE_SLOTS = 4;
const maxEncoded = Math.ceil(MAX_CACHE_BYTES / 3) * 4 + 4096;

export default class ManifestCache {
	constructor(store, now = () => Date.now()) {
		this.store = store;
		this.now = now;
		this.index = null;
	}
	read(key, limit) {
		try {
			const text = this.store?.read(key);
			return typeof text === "string" && text.length <= limit ? JSON.parse(text) : null;
		} catch {
			return null;
		}
	}
	write(key, value) {
		try {
			return this.store?.write(JSON.stringify(value), key) === true;
		} catch {
			return false;
		}
	}
	entries() {
		if (this.index) return this.index;
		const index = this.read(`${CACHE_PREFIX}index`, 16384);
		const seen = new Set();
		this.index = (Array.isArray(index) ? index : [])
			.filter(entry => {
				if (
					!entry ||
					!Number.isInteger(entry.slot) ||
					entry.slot < 0 ||
					entry.slot >= CACHE_SLOTS ||
					seen.has(entry.slot) ||
					cacheKey(entry.key) !== entry.key ||
					!Number.isFinite(entry.checkedAt) ||
					!Number.isFinite(entry.bodyAt) ||
					!Number.isFinite(entry.retryAt) ||
					typeof entry.generation !== "string" ||
					entry.generation.length > 64 ||
					typeof entry.etag !== "string" ||
					entry.etag.length > 512
				)
					return false;
				seen.add(entry.slot);
				return true;
			})
			.slice(0, CACHE_SLOTS);
		return this.index;
	}
	// Existing records are JSON with a large, unescaped Base64 value at the end.
	// Parse only their bounded metadata and read the Base64 by offsets. Preserve
	// the old JSON format and accept reordered/escaped legacy records via fallback.
	record(slot) {
		try {
			const text = this.store?.read(`${CACHE_PREFIX}slot${slot}`);
			if (typeof text !== "string" || text.length > maxEncoded) return null;
			const marker = ',"base64":"';
			const offset = text.indexOf(marker);
			if (offset >= 0 && offset <= 4096 && text.endsWith('"}') && text.indexOf("\\", offset + marker.length) < 0 && text.indexOf('"', offset + marker.length) === text.length - 2) {
				const metadata = JSON.parse(`${text.slice(0, offset)}}`);
				if (Object.keys(metadata).length === 2 && typeof metadata.key === "string" && typeof metadata.generation === "string") return { key: metadata.key, generation: metadata.generation, text, start: offset + marker.length, end: text.length - 2 };
			}
			const record = JSON.parse(text);
			return record && { key: record.key, generation: record.generation, text: record.base64, start: 0, end: record.base64?.length };
		} catch {
			return null;
		}
	}
	get(url, maxAgeSeconds = 86400, includeBody = true) {
		const key = cacheKey(url);
		if (!key) return null;
		const entry = this.entries().find(entry => entry.key === key);
		if (!entry) return null;
		const now = this.now();
		const result = { ...entry, body: null, hasBody: false };
		if (now < entry.bodyAt || now - entry.bodyAt > maxAgeSeconds * 1000 || !entry.generation) return result;
		const record = this.record(entry.slot);
		if (record?.key !== key || record?.generation !== entry.generation) return result;
		if (!includeBody) result.hasBody = validBase64Wire(record.text, record.start, record.end);
		else {
			const body = decodeBase64(record.text, record.start, record.end);
			if (body?.length && validWire(body)) {
				result.body = body;
				result.hasBody = true;
			}
		}
		return result;
	}
	put(url, body, etag = "") {
		const key = cacheKey(url);
		if (!key || !body?.length || body.length > MAX_CACHE_BYTES || !validWire(body)) return false;
		const entries = this.entries();
		const old = entries.find(entry => entry.key === key);
		const free = Array.from({ length: CACHE_SLOTS }, (_, slot) => slot).find(slot => !entries.some(entry => entry.slot === slot));
		const slot = old?.slot ?? free ?? entries.reduce((a, b) => (a.checkedAt <= b.checkedAt ? a : b)).slot;
		const now = this.now();
		const generation = `${now.toString(36)}-${Math.random().toString(36).slice(2)}`;
		try {
			const metadata = JSON.stringify({ key, generation });
			const record = `${metadata.slice(0, -1)},"base64":"${encodeBase64(body)}"}`;
			if (this.store?.write(record, `${CACHE_PREFIX}slot${slot}`) !== true) return false;
		} catch {
			return false;
		}
		const entry = { slot, key, generation, etag: typeof etag === "string" && etag.length <= 512 ? etag : "", checkedAt: now, bodyAt: now, retryAt: 0 };
		this.index = [...entries.filter(item => item.slot !== slot && item.key !== key), entry];
		return this.write(`${CACHE_PREFIX}index`, this.index);
	}
	touch(url, generation) {
		const key = cacheKey(url),
			entry = this.entries().find(entry => entry.key === key);
		if (!entry || entry.generation !== generation) return false;
		entry.checkedAt = entry.bodyAt = this.now();
		entry.retryAt = 0;
		return this.write(`${CACHE_PREFIX}index`, this.index);
	}
	fail(url, seconds = 30) {
		const key = cacheKey(url);
		if (!key) return false;
		const entries = this.entries();
		let entry = entries.find(entry => entry.key === key);
		if (!entry) {
			const slot = Array.from({ length: CACHE_SLOTS }, (_, slot) => slot).find(slot => !entries.some(entry => entry.slot === slot)) ?? entries.reduce((a, b) => (a.checkedAt <= b.checkedAt ? a : b)).slot;
			entry = { slot, key, generation: "", etag: "", checkedAt: 0, bodyAt: 0, retryAt: 0 };
			this.index = [...entries.filter(item => item.slot !== slot), entry];
		}
		entry.retryAt = this.now() + Math.min(300, Math.max(30, seconds)) * 1000;
		return this.write(`${CACHE_PREFIX}index`, this.index);
	}
	invalidate(url) {
		const key = cacheKey(url);
		this.index = this.entries().filter(entry => entry.key !== key);
		return this.write(`${CACHE_PREFIX}index`, this.index);
	}
}
