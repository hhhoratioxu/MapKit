# Mac Loon / Apple Maps validation — 2026-11-14

## Tested version and scope

- MapKit `4.6.1-stability.1`, script tag `stability-v1`, source commit `4865a9369159fbcfd4afee00918fd997c70908e2`.
- Native Mac Loon UI reported `v0.5.0 (1011)`.
- The initial sections record UI outcomes. The later continuation below adds a real Loon request-script record from an explicitly labelled curl control; it does not establish successful manifest-response rewriting in Maps.

## Actual installation operation

1. The existing MapKit subscription already used this fork's `main/Loon/script/MapKit.lpx`, but its cached plugin was the old optimized-v3 version and the plugin was disabled.
2. Updated **only that plugin** using its Update Plugin button. Did not use Update All.
3. Verified the name changed to `服务地址修复`, date to `2026-11-14`, and all four script entries referenced `stability-v1`.
4. Compared the 16 existing country/provider/tile selections before and after: all were retained. The four withdrawn optimization controls disappeared as designed.
5. Enabled this MapKit plugin with the owner's explicit approval. The UI confirmed Enabled Plugin Details and its switch on.

No other plugin settings, VPN switch, nodes, policies, rules, system proxy, or network settings were changed. No VPN disconnect/restart was requested. Loon remained Connected in before/after observations; these observations are not continuous connection telemetry.

## Real Apple Maps smoke test

After the new plugin was enabled:

- A fresh search for a public railway station returned its place details.
- Set another public railway station as the start of a driving route, rather than using a private home/work address or live location.
- Apple Maps returned three alternatives with estimated durations of 44, 47, and 45 minutes. The fastest alternative displayed approximately 13 miles.
- Did not start navigation, share the route, change saved places, or make calls.

Private addresses, location history, account details, IP addresses, node names and credentials are intentionally omitted.

## Automated validation (separate evidence)

14 regression tests passed locally and in GitHub Actions, including compiled Loon object-argument handling, binary manifest handling, the distinct URLInfoSet and missing-endpoint fixes, and error passthrough. Build and Draft workflow succeeded:

https://github.com/hhhoratioxu/MapKit/actions/runs/43537396062

## Initial smoke-test limits / not claimed

- No per-request script execution trace, fresh manifest-capture proof or patched-branch counters were captured during the Maps interaction. MapKit may reuse a previously cached manifest. Therefore the smoke test does **not** prove those particular search/route requests invoked the patched manifest code or exercised either bug condition.
- The displayed script URLs and enabled state prove plugin configuration, not execution of every script.
- No iPhone test, memory/battery benchmark, prolonged VPN-stability test, or satellite/Look Around coverage test was performed.
- Initial outcome: updated plugin enabled; search and route UI smoke checks passed. Full manifest execution tracing remained unverified at this stage.

## Follow-up attempt: execution tracing and overseas 3D

A later verification pass was authorized to check fresh manifest/script execution, actual source endpoints, and overseas satellite 3D/Look Around without changing the existing region/provider selections.

- Opening the Loon UI through the connected computer-control tool timed out after approximately 34 seconds and reset its session.
- A single retry targeting Apple Maps also timed out at 60 seconds.
- No UI interaction was performed in this follow-up attempt. No Maps restart, plugin change, VPN change, extra permission, or network configuration change was made.
- A separate read-only system query still reported Loon VPN **Connected**.

Therefore this pass could not verify fresh manifest execution, actual tile/service endpoints, overseas 3D rendering, or Look Around. This is a **computer-control access limitation**, not evidence that MapKit, Loon, or Apple Maps failed. The earlier successful search/routing smoke-test observations remain as recorded, with their original limits. No further code changes were justified by these timeouts.

Project-purpose reference: https://iringo.nanocat.cloud/guide/GeoServices/map-kit
The project's purpose is to combine mainland mapping services with international features. Branding disappearing is not proof of the selected data source. Ordinary building 3D, satellite 3D, Flyover and Look Around are distinct; a missing Flyover button with a mainland dispatcher is not on its own proof of a defect. Future verification must use observable script/request and manifest evidence, not just map appearance.

## Later continuation: UI observations and actual Loon records

This continuation ran after the other project released the Mac UI. All times below are on 2026-11-14 in UTC+08:00. It supersedes the earlier statement that no request-script execution trace had been obtained, but retains the limits on Maps application acceptance.

### Settings retained

The Loon UI was readable at the start of this pass. MapKit was enabled and all four displayed script URLs referenced `stability-v1`. The existing 16 choices were unchanged:

| Setting | Observed choice |
| --- | --- |
| CountryCode | US |
| Environment | AUTO |
| Dispatcher / Directions | AutoNavi / AutoNavi |
| RAP / LocationShift | Apple / AUTO |
| Map / Satellite2D / Satellite3D | CN / CN / XX |
| Traffic / POI | CN / CN |
| Flyover / Munin | XX / XX |
| Road / Earth / Transit | CN / CN / CN |

No plugin update, toggle, argument change, VPN operation, node/rule change, certificate change, permission change, or private configuration edit was performed in this pass. Only public locations were used. Read-only VPN status checks reported Connected; these are point observations, not continuous VPN telemetry.

### Public Paris check

1. Closed the previously displayed railway route/place card. Its 44/47/45-minute alternatives were an earlier result and were not counted as a fresh route calculation in this pass.
2. Searching `Eiffel Tower, Paris` first selected a replica attraction in Shanghai. This was not counted as a Paris result or a proven code defect.
3. Searching `Paris, France` resolved the French capital. Selecting its Eiffel Tower map feature produced the French national-monument card and surrounding Paris landmarks.
4. Selected Satellite and zoomed in. The UI exposed a `2D mode` button and a 60-degree view angle, indicating a tilted view was selected. The actual screenshot showed labels over a plain background, without satellite textures or photogrammetric buildings. **Satellite 3D rendering did not pass this check.** The presence of the mode button alone was not accepted as rendering evidence.
5. The View menu exposed `Show Look Around`. Attempting to invoke it returned an invalid-element automation error. Later Maps observations returned a menu-only accessibility tree and coordinate input reported `noWindowsAvailable`. Keyboard attempts did not establish that Maps had quit or reopened. A cold start was therefore not claimed.

Look Around imagery, New York coverage, and a second fresh domestic route were not completed in this continuation. No saved place, live location, sharing, call, ticket purchase, or navigation start was used. Missing Flyover controls with the retained AutoNavi dispatcher were not classified as a defect; the [author's guide](https://iringo.nanocat.cloud/guide/GeoServices/map-kit) describes this distinction.

### Actual records, with their evidence boundaries

The separate **Loon Dashboard** application was found and its request/script views could initially be read. Before the controlled requests below, its script records contained no MapKit entry. Actual `geod` connections included `dispatcher.is.autonavi.com`, `gspe21-ssl.ls.apple.com`, `gspe19-cn-ssl.ls.apple.com`, and `gspe11-2-cn-ssl.ls.apple.com`; Maps also connected to `store.is.autonavi.com`. These observations establish connections to those hosts, not the contents of every request or the provider of every rendered layer.

Opening a request-detail row timed out and reset the computer-control session. An additional attempt to read Dashboard also timed out. Existing native request/script records were then read through a **read-only SQLite connection**. No live database, logging setting, private profile, or cache was modified for inspection. The committed [sanitized evidence](mac-loon-validation-2026-11-14.evidence.json) contains only the selected public endpoints, statuses, times and checks.

| Observation | Result | What it establishes |
| --- | --- | --- |
| Configuration sessions at 09:26:00.870, 09:41:10.043, 09:56:19.894, 09:56:26.639 and 09:56:31.937 | Loon recorded client disconnect before the TLS handshake completed; no HTTP status or script execution | These particular connections ended before HTTP rewriting could run |
| Manifest session at 09:25:54.034 | Same pre-HTTP TLS disconnect, no script execution | A request script cannot repair this recorded handshake failure |
| Maps system-log entries at 09:54:44 and 09:58:39 | Configuration snapshots, including a manifest identifier with `country_code=CN`, `os=osx`, `os_version=27.3:2611122:13:scl=1,2` | Current configuration metadata, **not newly issued HTTP requests** |
| Defaults entry in the Maps configuration snapshot | `source_description = Default [Baked-in]` | Snapshot metadata; not a successfully rewritten defaults response |

An early progress message described the configuration snapshots as new requests. Inspection of the complete surrounding log text corrected that interpretation. They must not be used as fresh-manifest or script-hit evidence.

The TLS records do not identify the reason the client closed. Certificate trust, client policy, cancellation, and other causes were not distinguished. The [Loon MitM guide](https://nsloon.app/docs/MitM/) documents the decryption configuration, but does not establish the cause of these Mac events. No certificate, trust policy, or system setting was changed to try to make the test pass.

### Explicitly labelled HTTP controls

Two distinct public configuration URLs were requested with `/usr/bin/curl`, user agent `MapKit-Validation/1.0`, normal certificate validation, a 10-second connection timeout, a 25-second total timeout and a 16 MiB response limit. The manifest URL used the public parameters observed in the Maps configuration identifier. These were **curl controls, not Maps application requests**.

| Control | Result |
| --- | --- |
| `/config/defaults` at 10:13:06 | HTTP 400, zero-byte body, curl certificate validation succeeded; no response script hit |
| `/geo_manifest/dynamic/config?country_code=CN&os=osx&os_version=27.3:2611122:13:scl=1,2` at 10:13:19 | HTTP 400, zero-byte body, curl certificate validation succeeded; Loon recorded `MapKit manifest request` |

The manifest request-script record started at **10:13:20.030**, completed after **292 ms**, and had `isFinished=1`, `isException=0`. Its script log recorded the CN supplemental-cache lookup, an HTTP 400 supplemental download and normal completion. This is a single network-including observation, not a CPU, memory, battery or performance benchmark. The configured entry referenced `stability-v1`; the transient executed script file was not retained for an independent byte comparison.

The controls prove that Loon matched and completed the manifest **request** entry under the installed configuration. They do not prove a successful configuration fetch, decoded protobuf, defaults/manifest **response** script execution, modified dataset, or Maps acceptance. Because the response entries require HTTP 200, skipping these HTTP 400 responses is expected. The controls did not establish why Apple returned HTTP 400.

### Regression checks and remaining acceptance work

The existing 14 tests were rerun against the unchanged source and compiled Loon files: **14 passed, 0 failed**. The tracked request/response/defaults bundles, plugin, and URLInfoSet implementation still match the immutable `stability-v1` tag. No runtime code or stable tag was changed in this continuation.

No new reproducible source-code defect was established by the HTTP controls, TLS disconnects or automation errors, so no speculative runtime fix was added. The two previously documented URLInfoSet fixes remain covered by the existing tests.

Acceptance remains incomplete: a normal Maps configuration exchange must finish TLS and return HTTP 200; the corresponding defaults/manifest response entry must be observed; then public domestic routing, Paris/New York satellite textures and real 3D buildings, and Look Around imagery must be checked. This needs usable Maps UI access and successful native configuration traffic. Any proposed certificate, system, or other network-setting change remains outside this pass's authorized scope. This report does not certify overseas features, iPhone behavior, or prolonged VPN stability.

The next safe owner-assisted step is to fully quit and reopen **Maps only**, leaving Loon connected and all service selections intact. Search `Paris, France`, select Satellite/3D, and check Dashboard for the actual configuration HTTP statuses and the `MapKit defaults` / `MapKit manifest response` entries. If the client still closes before TLS completes, retain the public host, timestamp and failure category for focused client/trust diagnosis. There is currently insufficient evidence to prescribe a particular certificate or security-setting change; any identified change of that kind requires separate, specific authorization before applying it.
