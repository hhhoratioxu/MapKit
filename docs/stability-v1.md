# MapKit 4.6.1-stability.1

This version returns to upstream c9af737 and keeps only two service-address fixes:
- Preserve distinct target URLInfoSet records and prefer matching supplemental dataSet records.
- Do not overwrite existing endpoints with missing or empty supplemental URLs.

Loon/script/MapKit.lpx and all three script filenames remain available. The new plugin pins scripts to the new stability-v1 tag. Existing optimized-v3 tag URLs remain unchanged; installed plugins are not automatically reconfigured by this work.

The native adapters translate the existing country, provider and tile selections into upstream settings. CacheTTL, StaleHours, TimeoutMs and Diagnostics were fork-optimization controls and have been removed; old custom cache/encoder implementations are not restored. Original upstream behavior (including its cache behavior) remains otherwise unchanged.

Build: npm run build:loon
Test: node --test test/*.test.js

Validation: 14 tests pass, including compiled Loon-bundle object arguments, binary manifests, preservation of both distinct URL sets and working endpoints, and failure passthrough. Native Mac Apple Maps successfully searched Shanghai Hongqiao Railway Station under the already-installed configuration. That smoke test does NOT prove the newly built scripts were installed or tested in Loon. Loon VPN/configuration was not changed.

Do not force-update optimized-v3. To opt into the new scripts, update the plugin explicitly after reviewing it. This change does not deploy to the active Mac Loon configuration.

## Later device check

The initial build-only status above was followed by an owner-approved Mac plugin update and enablement. See [the actual Mac Loon / Apple Maps report](mac-loon-validation-2026-11-14.md) for observed search/routing results and the remaining lack of per-request manifest execution proof.
