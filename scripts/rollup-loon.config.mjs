// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import path from "node:path";
import alias from "@rollup/plugin-alias";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import pkg from "../package.json" with { type: "json" };

export default ["request", "response", "defaults"].map(name => ({
	input: `src/loon/${name}.js`,
	output: { file: `dist/${name}.bundle.js`, format: "es", banner: `/* MapKit ${pkg.version}; derived from NSRingo/MapKit, Apache-2.0; modifications hhhoratioxu. See LICENSE and NOTICE. */` },
	plugins: [alias({ entries: [{ find: "@nsringo/mapkit", replacement: path.resolve(import.meta.dirname, "../node_modules/@nsringo/mapkit/dist/index.js") }] }), nodeResolve(), terser()],
}));
