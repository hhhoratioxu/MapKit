# Mac Loon / Apple Maps validation — 2026-11-14

## Tested version and scope

- MapKit `4.6.1-stability.1`, script tag `stability-v1`, source commit `4865a9369159fbcfd4afee00918fd997c70908e2`.
- Native Mac Loon UI reported `v0.5.0 (1011)`.
- This report records observed UI outcomes, not packet-level proof of script invocation.

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

## Limits / not claimed

- No per-request script execution trace, fresh manifest-capture proof or patched-branch counters were captured during the Maps interaction. MapKit may reuse a previously cached manifest. Therefore the smoke test does **not** prove those particular search/route requests invoked the patched manifest code or exercised either bug condition.
- The displayed script URLs and enabled state prove plugin configuration, not execution of every script.
- No iPhone test, memory/battery benchmark, prolonged VPN-stability test, or satellite/Look Around coverage test was performed.
- Current outcome: updated plugin enabled; search and route UI smoke checks passed. Full manifest execution tracing remains unverified.

## Follow-up attempt: execution tracing and overseas 3D

A later verification pass was authorized to check fresh manifest/script execution, actual source endpoints, and overseas satellite 3D/Look Around without changing the existing region/provider selections.

- Opening the Loon UI through the connected computer-control tool timed out after approximately 34 seconds and reset its session.
- A single retry targeting Apple Maps also timed out at 60 seconds.
- No UI interaction was performed in this follow-up attempt. No Maps restart, plugin change, VPN change, extra permission, or network configuration change was made.
- A separate read-only system query still reported Loon VPN **Connected**.

Therefore this pass could not verify fresh manifest execution, actual tile/service endpoints, overseas 3D rendering, or Look Around. This is a **computer-control access limitation**, not evidence that MapKit, Loon, or Apple Maps failed. The earlier successful search/routing smoke-test observations remain as recorded, with their original limits. No further code changes were justified by these timeouts.

Project-purpose reference: https://iringo.nanocat.cloud/guide/GeoServices/map-kit
The project's purpose is to combine mainland mapping services with international features. Branding disappearing is not proof of the selected data source. Ordinary building 3D, satellite 3D, Flyover and Look Around are distinct; a missing Flyover button with a mainland dispatcher is not on its own proof of a defect. Future verification must use observable script/request and manifest evidence, not just map appearance.
