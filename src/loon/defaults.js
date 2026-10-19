// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import { processDefaults } from "./Defaults.mjs";

let result = {};
try {
	result = processDefaults($request, $response);
} catch {}
$done(result);
