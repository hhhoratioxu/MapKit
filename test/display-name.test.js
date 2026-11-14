import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = file => readFileSync(path.join(root, file), "utf8");
const pkg = JSON.parse(read("package.json"));
const plugin = read("Loon/script/MapKit.lpx");

function displayName(content) {
	const firstLine = content.split(/\r?\n/, 1)[0];
	const match = firstLine.match(/^(?:#!name\s*=|name:)\s*(.*?)\s*$/);
	assert.ok(match, `Missing display-name metadata: ${firstLine}`);
	return match[1].replace(/^(["'])(.*)\1$/, "$2");
}

test("project and import artifacts display MapKit without a prefix or suffix", () => {
	assert.equal(pkg.displayName, "MapKit");
	assert.equal(read("README.md").split(/\r?\n/, 1)[0], "# MapKit");
	assert.equal(displayName(plugin), "MapKit");
	assert.ok(plugin.split(/\r?\n/).includes(`#!version = ${pkg.version}`));
	for (const file of readdirSync(path.join(root, "modules"))) {
		if (/\.(?:lpx|sgmodule|srmodule|stoverride|yaml)$/.test(file)) {
			assert.equal(displayName(read(`modules/${file}`)), "MapKit", file);
		}
	}
});

test("release, rewrite and development templates share the exact package display name", () => {
	for (const file of readdirSync(path.join(root, "template"))) {
		if (!file.endsWith(".handlebars")) continue;
		const header = read(`template/${file}`).split(/\r?\n/, 1)[0];
		const expected = file.startsWith("stash.")
			? `name: "{{@package 'displayName'}}"`
			: `#!name = {{@package 'displayName'}}`;
		assert.equal(header, expected, file);
	}
});

test("real Loon generator reproduces the named artifact and its checksums", () => {
	mkdirSync(path.join(root, ".cache"), { recursive: true });
	const sandbox = mkdtempSync(path.join(root, ".cache/display-name-test-"));
	try {
		const inputs = ["package.json", "package-lock.json", "LICENSE", "NOTICE", "node_modules/@nsringo/mapkit/package.json"];
		for (const file of inputs) {
			mkdirSync(path.dirname(path.join(sandbox, file)), { recursive: true });
			copyFileSync(path.join(root, file), path.join(sandbox, file));
		}
		mkdirSync(path.join(sandbox, "dist"));
		for (const name of ["request", "response", "defaults"]) {
			copyFileSync(path.join(root, `Loon/script/${name}.bundle.js`), path.join(sandbox, `dist/${name}.bundle.js`));
		}
		const ref = plugin.match(/https:\/\/raw\.githubusercontent\.com\/hhhoratioxu\/MapKit\/([^/]+)\/Loon\/script\//)?.[1];
		assert.ok(ref, "Keep the existing versioned resource URL");
		execFileSync(process.execPath, [path.join(root, "scripts/build-loon.mjs")], {
			cwd: sandbox,
			env: { ...process.env, MAPKIT_RESOURCE_REF: ref },
			stdio: "pipe",
		});
		const generated = readFileSync(path.join(sandbox, "Loon/script/MapKit.lpx"), "utf8");
		assert.equal(displayName(generated), "MapKit");
		assert.equal(generated, plugin, "Build must retain the complete version, authors, links, arguments and rules");
		const sums = readFileSync(path.join(sandbox, "Loon/script/SHA256SUMS.txt"), "utf8");
		assert.equal(sums, read("Loon/script/SHA256SUMS.txt"));
		const digest = createHash("sha256").update(generated).digest("hex");
		assert.ok(sums.includes(`${digest}  MapKit.lpx\n`));
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});
