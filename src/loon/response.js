// Copyright 2026 hhhoratioxu. SPDX-License-Identifier: Apache-2.0
import { processResponse } from "./Response.mjs";

processResponse($request, $response, typeof $argument === "object" ? $argument : {}, $persistentStore).then(
	value => $done(value),
	() => $done({}),
);
