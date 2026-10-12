# Data-safety source checkpoint — WIP / NOT ACCEPTED

This is a source-preservation checkpoint, not a release, independent acceptance, or WholeMac PASS. Source commit `d572cdfaf0ffb7e2d00a81f78c6f3b2b425f1877` was uploaded and read back from GitHub; all 522 source objects match the manifest. Subsequent documentation-only updates retain this source identity. No product repair, install, package rebuild, full-suite rerun, main merge, PR, tag, Release or workflow change occurred during preparation or upload.

## Identity and scope

- Target branch: `checkpoint/data-safety-wip-20261012`.
- Public parent: `2131f65423c8b67de7ccc0ba45daf5d9e217bf48`; no private dirty HEAD commits imported.
- Complete source identity: **522 files**, [SOURCE-MANIFEST.json](SOURCE-MANIFEST.json), SHA256 `05fda907f9d878a47abb9812a331725e220ee8ee50686eeda857b0998bef3646`.
- Latest 12-path incremental patch SHA256 `032dc631a6defa495f490d01df5e2f73605703efe89b67dc4ad21c342d697650`; cumulative 107-path patch SHA256 `4d5a96bc92e3fb6ec74e327a7d38d515ec3516831f6c95ae957deb0b9ff41380`. These local provenance patches are not required to obtain this branch and are not uploaded as raw evidence.
- Cumulative original baseline predates the public parent and has different old bytes. Strict unique-hunk forward/reverse byte equality and baseline hashes were verified, but that patch was **not** applied to the public parent. Each changed/new source path was explicitly overlaid from the final manifest; all 522 bytes were read back and matched. This includes PNG restoration/custody APIs, permission scripts and the required already-public synthetic `research/save-pending-revision2/history-fixture.ts`, not only the latest seam fix.
- Relative to the public parent: **168 source/test/config paths** changed/added. The prohibited test and 17 inherited private-fixture entries are removed by path metadata, without reading their contents. Their already-public historical objects remain in the parent history; this is not history erasure. No other source path is removed to hide failure.
- Added public material is source/tests/config and this sanitized report/manifest; current README, CHECKPOINT, context-handoff and TODO are updated. Raw GUI traces, private fixtures, raw JSON/logs, nonce values, personal profile paths, caches, build output, vendor downloads and credentials are excluded from new additions.

## Implemented WIP boundaries

Original protected PNG creation/write/deletion now participates in Main-bound version custody and the existing authenticated sealed chain. Latest revisions add a strictly Main-authenticated derived preview reader, lifecycle-bound reciprocal absence, and an operation-local native interpreter session without authorization-result caching. Owner/asset admission, native namespace policy and Close barriers are preserved. Authentication/current-version/provenance and broader producer coverage still require review; implementation is not acceptance.

## Reused final-current Engineer evidence

All results below come from existing local executions bound to the exact 522-source manifest, not a new run of this worktree. Documentation edits are separate from tested source identity. Private raw evidence is retained locally, not offered as a GitHub-downloadable report.

- Full suite: `vitest run --config vitest.full.config.ts --reporter=json`, exit **1**, 752.122s, **264 testResults files / 1963 assertions / 1955 passed / 8 failed / 0 pending**. The original 1959 exact test identities remain, plus four new identities; preservation was rechecked against raw reporters. The complete include/single-worker/exclude config remains byte-exact. This is **not full PASS**.
- Full raw reporter SHA256: `e088ca0406dbc8d78e34c5b4c5ac5d24dceda8878b39345b5e4b21e4f955fe2f` (local provenance only).
- Canonical build including renderer and Electron typechecks, emitted TS preload bundle, and `check:preload`: existing final execution exit0. Node `saveWholeOperationSafety.test.cjs`: **11 pass / 0 fail**, exit0.
- Actual mounted CJS **78.647s**, emitted TS **86.682s**, both exit0: Add→original Undo/delete→Save own ACK→two-capture normal Close; fresh exact undo1/redo1→no-extra-Save Close; next cold actual Redo exact PNG/own nonce ACK under unchanged120s→Save→normal Close; next fresh metadata/paint own ACK→ordinary Close without extra Save. Each preload had four normal Main exits. These are bounded real seams, not a universal lifecycle or adversarial proof.
- Transparent native profiling: 38,738 requests/29 interpreters; cold Redo 4,679 requests/3 interpreters and 8,173ms summed interpreter intervals. These are Python/native call counters, not kernel syscall tracing. Complete namespace inspection remains repeated; no policy/result cache or readback omission was introduced.
- Extra mounted negative diagnostic failed before Electron launch due to duplicate `namespace` declaration; TS negative was not executed. Those omitted mounted negatives remain **NOT VERIFIED**. Native service negatives do not substitute for mounted window/pins/History proof.
- Existing cleanup readback records 28 owned process receipts with PIDs/ports gone; full suite exited naturally1. Forced failure/negative cleanup is not counted as normal Close success.

## All eight failed identities (unwaived)

- `electron/main/preparedWorkspaceSave.retainedSet.native.test.ts` — a native g2 readback refusal gives no whole permit and never rolls back another Root or forgets old facts
- `electron/main/preparedWorkspaceSave.retainedSet.native.test.ts` — executing source work cannot be snapshotted as ACK; shared queue waits real settlement and reentrant calls refuse
- `electron/main/preparedWorkspaceSave.retainedSet.native.test.ts` — private ordinary pending/failed obligations cannot be omitted or washed by renderer saved flags
- `electron/main/preparedWorkspaceSave.retainedSet.native.test.ts` — unprepared parked/deleted asset inventory in any slot refuses before the first Root g2
- `electron/main/preparedWorkspaceSave.retainedSet.native.test.ts` — whole barrier requests a second exact collection and does not authorize a changed slot
- `electron/main/workspaceOrdinaryObservation.test.ts` — fresh observation is pure; actual reader initialization binds parent and subsequent replacement is refused
- `electron/main/workspaceOrdinaryObservation.test.ts` — later parent existence without the actual creator receipt cannot finalize a fresh observation
- `electron/main/workspaceOrdinaryObservation.test.ts` — unleased staged failure is Main inventory and cannot be omitted by either close capture

Five retained-set native cases time out at the unchanged120s after a CLI-only `readback-fail` injection adapter blocks during import (`json.load(stdin)` awaits EOF), cascading through that file's shared queue. Three ordinary-observation cases fail because sessions eagerly spawn with undefined Python options even when only pure observation is needed. These are introduced compatibility/pure-observation regressions, not approved exceptions. No test deletion, assertion weakening, timeout extension or fake cancellation was used.

## Independent review and missing acceptance

The independent static custody consultation covered the older **517-file** identity, manifest SHA256 `70017541fb9bc8274306a668d35741ae28fa3ee1b412c713996e1b7628f9bb3a`, not this final 522-file source. It found:

1. current canvas could authenticate historical bytes without exact current-version association;
2. missing producer-authenticated reciprocal absence;
3. cold editable History lacked sufficient receipt/current-version/document-origin semantic proof;
4. committed native write with cleanup warnings could omit the new custody version.

Latest absence/reader revisions have bounded Engineer evidence but have not been independently re-reviewed. None of these four custody findings is declared collectively closed. Separate older cancel-intent / private Close-signal findings also labelled F1/F3 must not be confused with this consultation's numbering.

Before-first-Save and other PNG producers remain incompletely covered; mounted wrong document/Root/history-byte/unknown-absence and0400/window/pins expansion is NOT VERIFIED. Windows unfinished, main not integrated, production quota unapproved. Finite fixture budgets are not approved product defaults. No universal PNG producer, partial/crash, clean-machine or cross-platform PASS is claimed.

## Preparation checks

All 522 worktree and staged source hashes match the manifest; unaffected inherited index entries remain identical to the public parent. The original main-tree/index fingerprints are unchanged. Static relative-import checks account for test stdin bundles' actual `resolveDir` and found no missing referenced local module.

`git diff --cached --check` over the non-deleted allowlist returns **exit2**: `electron/main/recoveryCloseIntegration.test.ts:59: new blank line at EOF`. This whitespace is part of the exact final tested source. It is preserved rather than silently editing source identity or claiming diff-check green. Prohibited deletions are audited only using index/path metadata, without rendering their old contents into the patch. Upload executor must decide this disclosed WIP warning before committing.

## Content and portability audit

All 522 manifest files were scanned for private-key/provider-token/credential-URL/literal-credential patterns without printing potential values. No secret candidate was detected. Absolute-path matches were manually inspected: existing synthetic `/Users/example` test and `/Users/name` UI placeholder, not personal profile references. Synthetic PNG/data URLs are test data, not credentials. New documentation uses repository-relative links and hashes, not personal local evidence paths.

Homebrew Python paths remain hardcoded in native tests/test composition (for example `appOpenCallerScope.mjs` and retained-set/session tests). TIFF dependency resolution and tests still refer to project vendor and a legacy spike fallback. These bytes are deliberately unchanged to preserve evidence; no portable rewrite or clean-machine execution was attempted. Dependency downloads/vendor/builds are not included; readers must prepare a compatible environment themselves. Missing acquisition/installation evidence is disclosed, not replaced by fake green results.

Only the inherited `.github/workflows/release.yml` exists. It is unchanged: automatic push triggers are `main` and `v*.*.*` tags; manual dispatch can release as well. Its actions are checkout/setup-node/setup-python; later jobs install/build/package, publish release assets and update the release repository. A push solely to this checkpoint branch does not match those configured automatic triggers. No workflow is added or disabled; remote configuration must be rechecked if it changes.

Next authorized work is the retrospective. Future fixes/matrices and independent high-risk acceptance require their own current scope confirmation. See [current handoff](../../context-handoff.md) and [TODO](../../todo.md).
