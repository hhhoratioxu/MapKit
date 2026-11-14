// Thin Loon adapter: original upstream processing, no fork cache/encoder optimizations.
import { Request } from "../process/Request.mjs";
import settings from "./settings.mjs";
globalThis.$argument = settings(globalThis.$argument);
Request($request).then(({ $request: request }) => $done(request), () => $done({}));
