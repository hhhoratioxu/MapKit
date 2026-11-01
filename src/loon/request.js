// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import { processRequest } from "./Request.mjs";

let result = {};
try {
	result = processRequest($request, typeof $argument === "object" ? $argument : {}, $persistentStore, (options, callback) => $httpClient.get(options, callback));
} catch {}
if (result instanceof Promise)
	result.then(
		value => $done(value),
		() => $done({}),
	);
else $done(result);
