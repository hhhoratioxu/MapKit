// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import { processRequest } from "./Request.mjs";

processRequest($request, typeof $argument === "object" ? $argument : {}, $persistentStore, (options, callback) => $httpClient.get(options, callback)).then(
	value => $done(value),
	() => $done({}),
);
