// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tileDefaults } from "../src/loon/settings.mjs";


const pkg = JSON.parse(await readFile("package.json", "utf8"));
const schema = JSON.parse(await readFile("node_modules/@nsringo/mapkit/package.json", "utf8"));
if (schema.version !== "1.1.3") throw new Error("Expected the original locked MapKit 1.1.3 schema");
const ref = process.env.MAPKIT_RESOURCE_REF || pkg.resourceRef || "stability-v1";
if (!/^[A-Za-z0-9._-]+$/.test(ref)) throw new Error("Invalid resource ref");
const base = `https://raw.githubusercontent.com/hhhoratioxu/MapKit/${ref}/Loon/script`;
const parameters = [
	["CountryCode", 'select,"US","AUTO","CN","HK","TW","SG","JP","AU","GB","KR","CA","IE",type=string,tag=清单地区,desc=AUTO 保留 Apple 请求地区；KR 不包含独立韩国瓦片合成'],
	["Environment", 'select,"AUTO","CN","XX",type=string,tag=公告环境'],
	["Dispatcher", 'select,"AutoNavi","Apple","AUTO",type=string,tag=地点服务'],
	["Directions", 'select,"AutoNavi","Apple","AUTO",type=string,tag=导航与 ETA'],
	["RAP", 'select,"Apple","AutoNavi","AUTO",type=string,tag=评分和照片'],
	["LocationShift", 'select,"AUTO","AutoNavi","Apple",type=string,tag=定位服务,desc=AUTO 沿用上游规则：watchOS 采用 Apple；其他系统采用高德'],
	...Object.entries(tileDefaults).map(([key, value]) => [
		key,
		`select,"${value}","${value === "CN" ? "XX" : "CN"}",type=string,tag=${{ Map: "地图", Satellite2D: "2D 卫星", Satellite3D: "3D 卫星", Traffic: "交通", POI: "兴趣点", Flyover: "俯瞰", Munin: "四处看看", Road: "道路", Earth: "地球", Transit: "公共交通" }[key]},desc=CN 中国版；XX 国际版`,
	]),
];
const arg = `{${parameters.map(([key]) => `\u0024{${key}}`).join(", ")}}`;
const manifestPattern = String.raw`/^https:\/\/gspe35-ssl\.ls\.apple\.(?:com|cn)\/geo_manifest\/dynamic\/config(?:\?|$)/`;
const announcementPattern = String.raw`/^https:\/\/gspe35-ssl\.ls\.apple\.(?:com|cn)\/config\/announcements(?:\?|$)/`;
const defaultsPattern = String.raw`/^https:\/\/configuration\.ls\.apple\.com\/config\/defaults(?:\?|$)/`;
const plugin = `#!name = ${pkg.displayName}
#!desc = ${pkg.system.join(" & ")}\\n${pkg.description.replace(/\r?\n/g, "\\n")}
#!author = VirgilClyne[https://github.com/VirgilClyne],hhhoratioxu[https://github.com/hhhoratioxu]
#!homepage = https://github.com/hhhoratioxu/MapKit
#!icon = https://developer.apple.com/assets/elements/icons/maps/maps-128x128.png
#!tag = ${pkg.organizationName}
#!system = ${pkg.system.join(",")}
#!date = ${pkg.buildDate}
#!version = ${pkg.version}
#!system_version = ${pkg.systemVersion}
#!loon_version = 3.5.1(983)

[Argument]
${parameters.map(([key, value]) => `${key} = ${value}`).join("\n")}

[Rewrite]
request if \u0024{url} ~= ${defaultsPattern} then request.header.del(["If-None-Match", "If-Modified-Since"])
request if \u0024{url} ~= ${manifestPattern} then request.header.del(["If-None-Match", "If-Modified-Since"])

[Script]
request if \u0024{url} ~= ${manifestPattern} && \u0024{request.method} == "GET" then script("${base}/request.bundle.js", ${arg}) with timeout=8, tag="MapKit manifest request"
request if \u0024{url} ~= ${announcementPattern} && \u0024{request.method} == "GET" then script("${base}/request.bundle.js", ${arg}) with timeout=8, tag="MapKit announcements"
response if \u0024{url} ~= ${manifestPattern} && \u0024{request.method} == "GET" && \u0024{response.status} == 200 then script("${base}/response.bundle.js", ${arg}) with requires_body=true, binary_body_mode=true, timeout=8, tag="MapKit manifest response"
response if \u0024{url} ~= ${defaultsPattern} && \u0024{request.method} == "GET" && \u0024{response.status} == 200 then script("${base}/defaults.bundle.js") with requires_body=true, timeout=5, tag="MapKit defaults"

[MITM]
hostname = configuration.ls.apple.com, gspe35-ssl.ls.apple.com, gspe35-ssl.ls.apple.cn
`;
const output = "Loon/script";
await mkdir(output, { recursive: true });
await writeFile(`${output}/MapKit.lpx`, plugin);
for (const name of ["request", "response", "defaults"]) {
	const content = await readFile(`dist/${name}.bundle.js`);
	if (content.includes(Buffer.from("node:"))) throw new Error("Node code in native bundle");
	await writeFile(`${output}/${name}.bundle.js`, content);
}
await writeFile(`${output}/LICENSE.txt`, `${await readFile("NOTICE", "utf8")}\n\n${await readFile("LICENSE", "utf8")}`);
const checks = { scope: "See test/loon-bundle.test.js; automated, not installed-device acceptance" };
const digest = value => createHash("sha256").update(value).digest("hex");
const provenance = {
	version: pkg.version,
	resourceRef: ref,
	baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	upstreamCommit: "c9af737d97c0b3e26bc2f1083e36564da1b05ba4",
	node: process.version,
	schemaPackage: schema.version,
	lockfileSHA256: digest(await readFile("package-lock.json")),
	checks,
};
await mkdir("docs", { recursive: true });
await writeFile("docs/build-validation.json", `${JSON.stringify(provenance, null, 2)}\n`);
const files = ["MapKit.lpx", "request.bundle.js", "response.bundle.js", "defaults.bundle.js", "LICENSE.txt"];
const hashes = await Promise.all(files.map(async name => `${digest(await readFile(`${output}/${name}`))}  ${name}`));
await writeFile(`${output}/SHA256SUMS.txt`, `${hashes.join("\n")}\n`);
console.log(JSON.stringify(provenance));
