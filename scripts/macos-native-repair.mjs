import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { BinaryReader, BinaryWriter, WireType } from "@protobuf-ts/runtime";
import { Resources, TileSetStyle } from "@nsringo/mapkit";
import settings from "../src/loon/settings.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const flagPath = "com\\.apple\\.GEO.CountryProviders.CN.ShouldEnableLagunaBeach";
const geodProgram = "/System/Library/PrivateFrameworks/GeoServices.framework/Versions/A/XPCServices/com.apple.geod.xpc/Contents/MacOS/com.apple.geod";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function run(program, args, input) {
	try {
		return execFileSync(program, args, { input, stdio: ["pipe", "pipe", "pipe"], timeout: 35000, maxBuffer: 10 * 1024 * 1024 });
	} catch (error) {
		throw new Error(`${path.basename(program)} failed with exit ${error.status ?? error.code}`);
	}
}

export function readEnvelope(bytes) {
	const reader = new BinaryReader(bytes);
	const fields = [];
	while (reader.pos < reader.len) {
		const start = reader.pos;
		const [number, wire] = reader.tag();
		if ((number === 1 || number === 2) && wire !== WireType.LengthDelimited) throw new Error("Unsupported native manifest envelope");
		const value = wire === WireType.LengthDelimited ? reader.bytes() : reader.skip(wire);
		fields.push({ number, value, wireBytes: bytes.subarray(start, reader.pos) });
	}
	if (fields.filter(field => field.number === 1).length !== 1) throw new Error("Ambiguous Resources payload");
	return fields;
}

export function replacePayload(envelope, payload) {
	return Buffer.concat(readEnvelope(envelope).map(field => field.number === 1
		? new BinaryWriter().tag(1, WireType.LengthDelimited).bytes(payload).finish()
		: field.wireBytes));
}

export function validateResources(bytes) {
	const manifest = Resources.fromBinary(bytes);
	if (!manifest.tileGroup.length || !manifest.tileSet.length) throw new Error("Missing native map layers");
	for (const group of manifest.tileGroup) {
		for (const ref of group.tileSet) {
			const tile = manifest.tileSet[ref.tileSetIndex];
			if (!tile?.validVersion.some(version => version.identifier === ref.identifier)) throw new Error("Invalid tile group reference");
		}
		for (const index of group.resourceIndex) {
			if (!manifest.resource[index]) throw new Error("Invalid resource reference");
		}
	}
	return manifest;
}

export function resolveArguments(input) {
	const args = input.arguments ?? input;
	const resolved = settings(args);
	const flat = {
		CountryCode: resolved.GeoManifest.Dynamic.Config.CountryCode,
		Environment: resolved.Config.Announcements.Environment,
		...resolved.UrlInfoSet,
		...resolved.TileSet,
	};
	for (const [key, value] of Object.entries(flat)) {
		if (args[key] !== value) throw new Error(`Supply the existing Loon value for ${key}`);
	}
	return flat;
}

function originURL(envelope) {
	const field = readEnvelope(envelope).find(item => item.number === 2);
	const match = field && new TextDecoder().decode(field.value).match(/https:\/\/[^\s"'<>\x00-\x1f\x7f]+/);
	if (!match) throw new Error("Missing native manifest origin");
	const url = new URL(match[0]);
	if (url.protocol !== "https:" || url.hostname !== "gspe35-ssl.ls.apple.com" || url.pathname !== "/geo_manifest/dynamic/config" || url.username || url.password) throw new Error("Unexpected native manifest origin");
	return url;
}

function fetchManifest(url) {
	const config = [
		`url = "${url.toString()}"`,
		'header = "Accept: application/octet-stream"',
		'header = "Accept-Encoding: identity"',
		"connect-timeout = 8", "max-time = 30", "max-filesize = 8388608", "silent", "show-error",
		'write-out = "\\nMAPKIT_RESULT %{http_code} %{ssl_verify_result}"',
	].join("\n") + "\n";
	const output = run("/usr/bin/curl", ["-q", "--config", "-"], config);
	const marker = Buffer.from("\nMAPKIT_RESULT ");
	const at = output.lastIndexOf(marker);
	if (at < 0 || output.subarray(at + marker.length).toString().trim() !== "200 0") throw new Error("Manifest download requires HTTP 200 and successful system certificate verification");
	const body = output.subarray(0, at);
	validateResources(body);
	return body;
}

export async function compose(url, main, supplementalURL, supplemental, args) {
	const cacheURL = new URL(url);
	cacheURL.searchParams.set("country_code", supplementalURL.searchParams.get("country_code"));
	const store = { iRingo: JSON.stringify({ MapKit: { Caches: {
		[cacheURL.search]: { eTag: "native-preparation", base64: Buffer.from(supplemental).toString("base64") },
	} } }) };
	let result;
	let completions = 0;
	const unexpected = () => { throw new Error("Unexpected I/O during manifest composition"); };
	const quiet = Object.fromEntries(["log", "warn", "debug", "info", "error"].map(key => [key, () => {}]));
	const context = {
		URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, atob, btoa, console: quiet,
		$loon: "Mac native repair", $script: { startTime: Date.now() }, $argument: args,
		$request: { method: "GET", url: url.toString(), headers: {} },
		$response: { status: 200, headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(main) },
		$persistentStore: { read: key => store[key] ?? null, write: unexpected },
		$httpClient: { get: unexpected },
		$done: value => { completions++; result = value; },
	};
	vm.runInNewContext(fs.readFileSync(path.join(root, "Loon/script/response.bundle.js"), "utf8"), context, { timeout: 4000 });
	for (let i = 0; completions === 0 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 2));
	if (completions !== 1 || !result?.body) throw new Error("Manifest composition did not complete once");
	const body = Buffer.from(result.body);
	validateResources(body);
	return body;
}

export function atomicReplace(file, expected, replacement) {
	const stat = fs.lstatSync(file);
	if (!stat.isFile() || !fs.readFileSync(file).equals(expected)) throw new Error("Native cache changed before replacement");
	const temp = path.join(path.dirname(file), `.mapkit-${process.pid}-${Date.now()}.tmp`);
	try {
		const fd = fs.openSync(temp, "wx", stat.mode & 0o777);
		try {
			fs.writeFileSync(fd, replacement);
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		if (!fs.readFileSync(file).equals(expected)) throw new Error("Native cache changed during replacement");
		fs.renameSync(temp, file);
	} finally {
		if (fs.existsSync(temp)) fs.unlinkSync(temp);
	}
}

function savePlan(directory, plan) {
	const temporary = path.join(directory, `.plan-${process.pid}.tmp`);
	try {
		fs.writeFileSync(temporary, JSON.stringify(plan, null, 2) + "\n", { mode: 0o600, flag: "wx" });
		fs.renameSync(temporary, path.join(directory, "plan.json"));
	} finally {
		if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
	}
}

async function prepare(argumentsFile) {
	const args = resolveArguments(JSON.parse(fs.readFileSync(argumentsFile, "utf8")));
	const cache = path.join(os.homedir(), "Library/Caches/GeoServices");
	const manifestFile = path.join(cache, "ResourceManifest.pbd");
	const defaultsFile = path.join(cache, "networkDefaults.plist");
	const originalManifest = fs.readFileSync(manifestFile);
	const originalDefaults = fs.readFileSync(defaultsFile);
	run("/usr/bin/plutil", ["-lint", "-"], originalDefaults);
	const nativeURL = originURL(originalManifest);
	if (nativeURL.searchParams.get("country_code") !== "CN") throw new Error("This preparation uses the existing CN native manifest as its regional source");
	const nativeBody = readEnvelope(originalManifest).find(field => field.number === 1).value;
	validateResources(nativeBody);
	const country = args.CountryCode === "AUTO" ? "CN" : args.CountryCode;
	const remoteURL = new URL("https://gspe35-ssl.ls.apple.com/geo_manifest/dynamic/config");
	const parameters = {
		application: "geod", application_version: nativeURL.searchParams.get("application_version") ?? "1",
		country_code: country === "CN" ? "US" : country,
		hardware: run("/usr/sbin/sysctl", ["-n", "hw.model"]).toString().trim(), os: "osx",
		os_build: run("/usr/bin/sw_vers", ["-buildVersion"]).toString().trim(),
		os_version: run("/usr/bin/sw_vers", ["-productVersion"]).toString().trim(),
	};
	for (const [key, value] of Object.entries(parameters)) remoteURL.searchParams.set(key, value);
	const downloaded = fetchManifest(remoteURL);
	const targetURL = country === "CN" ? nativeURL : remoteURL;
	const supplementalURL = country === "CN" ? remoteURL : nativeURL;
	const payload = await compose(targetURL, country === "CN" ? nativeBody : downloaded, supplementalURL, country === "CN" ? downloaded : nativeBody, args);
	const candidateManifest = replacePayload(originalManifest, payload);
	const existing = spawnSync("/usr/bin/plutil", ["-extract", flagPath, "xml1", "-o", "-", "-"], { input: originalDefaults, encoding: "utf8" });
	const operation = existing.status === 0 ? "-replace" : "-insert";
	const candidateDefaults = run("/usr/bin/plutil", [operation, flagPath, "-bool", "YES", "-o", "-", "-"], originalDefaults);
	const cacheRoot = path.join(root, ".cache");
	fs.mkdirSync(cacheRoot, { recursive: true });
	const directory = fs.mkdtempSync(path.join(cacheRoot, "macos-native-repair-"));
	fs.chmodSync(directory, 0o700);
	const files = [
		{ file: manifestFile, name: "manifest", original: originalManifest, candidate: candidateManifest },
		{ file: defaultsFile, name: "defaults", original: originalDefaults, candidate: candidateDefaults },
	];
	for (const item of files) {
		for (const kind of ["original", "candidate"]) fs.writeFileSync(path.join(directory, `${item.name}.${kind}`), item[kind], { mode: 0o600, flag: "wx" });
	}
	const plan = {
		state: "prepared", args, preparedAt: new Date().toISOString(),
		files: files.map(item => ({ file: item.file, name: item.name, originalSHA256: digest(item.original), candidateSHA256: digest(item.candidate) })),
		originalFlag: existing.status === 0 ? existing.stdout.trim() : null,
	};
	savePlan(directory, plan);
	console.log(`Prepared ${directory}`);
	console.log("Native caches are ready for an explicit apply operation.");
}

function geodPID() {
	const output = run("/bin/launchctl", ["print", `user/${process.getuid()}/com.apple.geod`]).toString();
	if (!output.includes(`program = ${geodProgram}`)) throw new Error("Unexpected current-user GeoServices executable");
	const match = output.match(/^\s*pid = (\d+)$/m);
	return match ? Number(match[1]) : null;
}

async function closeMaps() {
	run("/usr/bin/osascript", ["-l", "JavaScript", "-e", "ObjC.import('AppKit');var a=$.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.apple.Maps');for(var i=0;i<a.count;i++)a.objectAtIndex(i).terminate;"]);
	for (let i = 0; i < 40; i++) {
		if (spawnSync("/usr/bin/pgrep", ["-x", "Maps"]).status !== 0) return;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error("Maps did not close normally");
}

async function reloadGeoServices() {
	const before = geodPID();
	if (before) {
		const owner = run("/bin/ps", ["-p", String(before), "-o", "uid=,comm="]).toString().trim();
		if (!owner.startsWith(String(process.getuid()) + " ") || !owner.endsWith(geodProgram)) throw new Error("GeoServices process owner or executable changed");
		process.kill(before, "SIGTERM");
	}
	run("/usr/bin/open", ["-a", "/System/Applications/Maps.app"]);
	for (let i = 0; i < 80; i++) {
		const after = geodPID();
		if (after && after !== before) return;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error("GeoServices did not relaunch");
}

function loadPlan(directory) {
	const plan = JSON.parse(fs.readFileSync(path.join(directory, "plan.json"), "utf8"));
	const cache = path.join(os.homedir(), "Library/Caches/GeoServices");
	const allowed = { manifest: path.join(cache, "ResourceManifest.pbd"), defaults: path.join(cache, "networkDefaults.plist") };
	if (plan.files.length !== 2 || new Set(plan.files.map(item => item.name)).size !== 2) throw new Error("Invalid native repair plan");
	for (const item of plan.files) {
		if (item.file !== allowed[item.name]) throw new Error("Unexpected native cache path");
		for (const kind of ["original", "candidate"]) {
			if (digest(fs.readFileSync(path.join(directory, `${item.name}.${kind}`))) !== item[`${kind}SHA256`]) throw new Error("Repair backup or candidate changed");
		}
	}
	return plan;
}

export function restoreCacheFiles(directory, plan) {
	for (const item of [...plan.files].reverse()) {
		const original = fs.readFileSync(path.join(directory, `${item.name}.original`));
		const candidate = fs.readFileSync(path.join(directory, `${item.name}.candidate`));
		const current = fs.readFileSync(item.file);
		if (current.equals(original)) continue;
		let replacement;
		if (current.equals(candidate)) replacement = original;
		else if (item.name === "manifest") {
			const currentBody = readEnvelope(current).find(field => field.number === 1).value;
			const ownedBody = readEnvelope(candidate).find(field => field.number === 1).value;
			if (!Buffer.from(currentBody).equals(Buffer.from(ownedBody))) continue;
			replacement = replacePayload(current, readEnvelope(original).find(field => field.number === 1).value);
		} else {
			run("/usr/bin/plutil", ["-lint", "-"], current);
			const flag = spawnSync("/usr/bin/plutil", ["-extract", flagPath, "raw", "-o", "-", "-"], { input: current, encoding: "utf8" });
			if (flag.status !== 0 || flag.stdout.trim() !== "true") continue;
			const args = plan.originalFlag === null ? ["-remove", flagPath] : ["-replace", flagPath, "-xml", plan.originalFlag];
			replacement = run("/usr/bin/plutil", [...args, "-o", "-", "-"], current);
		}
		atomicReplace(item.file, current, replacement);
	}
}

async function restore(directory, plan) {
	await closeMaps();
	restoreCacheFiles(directory, plan);
	plan.state = "restored";
	savePlan(directory, plan);
	await reloadGeoServices();
	console.log("Restored owned cache changes and reloaded current-user GeoServices.");
}

async function apply(directory, plan) {
	if (plan.state !== "prepared") throw new Error("Prepare a fresh plan before applying");
	for (const item of plan.files) {
		if (digest(fs.readFileSync(item.file)) !== item.originalSHA256) throw new Error("Native cache changed since preparation; prepare a fresh plan");
	}
	geodPID();
	await closeMaps();
	try {
		plan.state = "applying";
		savePlan(directory, plan);
		for (const item of plan.files) atomicReplace(item.file, fs.readFileSync(path.join(directory, `${item.name}.original`)), fs.readFileSync(path.join(directory, `${item.name}.candidate`)));
		plan.state = "applied";
		savePlan(directory, plan);
		await reloadGeoServices();
		console.log(`Applied. Restore with node scripts/macos-native-repair.mjs restore ${directory}`);
	} catch (error) {
		await restore(directory, plan);
		throw error;
	}
}

export async function main(argv) {
	if (process.platform !== "darwin" || process.getuid() === 0) throw new Error("Run as the logged-in Mac user");
	const [command, operand] = argv;
	if (!operand || argv.length !== 2) throw new Error("Usage: prepare <arguments.json> | apply <state-directory> | restore <state-directory> | status <state-directory>");
	if (command === "prepare") return prepare(operand);
	const plan = loadPlan(operand);
	if (command === "apply") return apply(operand, plan);
	if (command === "restore") return restore(operand, plan);
	if (command !== "status") throw new Error("Unknown native repair command");
	console.log(JSON.stringify({ state: plan.state, arguments: plan.args, files: plan.files.map(item => ({ name: item.name, currentMatchesCandidate: digest(fs.readFileSync(item.file)) === item.candidateSHA256, currentMatchesOriginal: digest(fs.readFileSync(item.file)) === item.originalSHA256 })) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
