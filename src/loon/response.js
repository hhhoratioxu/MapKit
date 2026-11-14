// Thin Loon adapter: keep upstream processing and fail open on unexpected input.
import { Response } from "../process/Response.mjs";
import settings from "./settings.mjs";
globalThis.$argument = settings(globalThis.$argument);
Response($request, $response).then(response => $done({ body: response.body, headers: response.headers }), () => $done({}));
