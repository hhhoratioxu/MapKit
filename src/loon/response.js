// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import { processResponse } from "./Response.mjs";

let result = {};
try {
	result = processResponse($request, $response, typeof $argument === "object" ? $argument : {}, $persistentStore);
} catch {}
$done(result);
