## G2 Japanese view and dialogue — 2026-10-30

The isolated new-format editor now reuses JapaneseStoryboardView and shares one Session
with its grid: script/dialogue, order, pixels and Undo/Redo. Session setDialogues keeps
active-shot/binding validation and text-during-paint behavior without bypassing Undo.
Real GUI verified Cut drag/Undo, multiline Chinese dialogue, sheet paint/Undo, guarded
view switching and exact checkpoint/Close/fresh-process reopen. No second writable Project.

Candidate `4c8cd8a1e7de0a0ae47f3a7e946244aa01f1ab83`: full allowed suite **379 files /
2833 tests**, complete build and real two-process GUI passed. Full/build receipts have
clean unchanged HEAD; details in `docs/refactor/reviews/2026-10-30/G2-JAPANESE-EDITOR.md`.
Implemented/self-tested only; full G2 independent acceptance remains open. Default App,
launcher, TIFF and production Close unchanged. Next: remaining shell/tools/selection and
output integration; Pending materialization, OS IME, Windows and scale remain unverified.
Only original main; no new agents/worktrees/dependencies, personal media or push.

## G2 first connected component workflow — 2026-10-30

Coordinator implemented an isolated new-format editor entry on main, reusing existing
SketchPad, LayerPanel and static-media components with the accepted Session/Pixels/Assets
cores. It is a small verification host, not a replacement for the full production App.
Default launcher, RecoveryEntry/App, TIFF Save and production multi-project Close remain
on their existing paths. No new worktrees or agents; no push or dependency installation.

Final implementation `b1f1cffb42aaf8c8e88c62803bcf3d3ccd650f28` passed the complete allowed
suite (**379 files / 2829 tests**), full build and preload checks. Receipts show clean,
unchanged HEAD before/after. Real two-process Electron self-test passed 11 cases: Chinese
text, reorder, drawing, multi-move opacity as one undo, Undo/Redo, checkpoint, certified
Close/reopen, refusal during a stroke, and further eraser editing with exact pixel Undo.
Late preview invalidation, shared-PNG layer identity and Close asset/root binding have
regressions. Initial failed/intermediate evidence remains; no checks were weakened.

Details: `docs/refactor/reviews/2026-10-30/G2-FIRST-EDITOR.md`. This is implemented and
self-tested, not independent acceptance of complete G2 or publication. Next: established
application-shell adapters, Japanese view and remaining tools/commands, then TIFF/output
and multi-project lifecycle gates. Large-project caching/performance, Windows and
installers remain unverified. The dedicated editor is not the daily-use launch target.

## Wave-two worktrees retired — 2026-10-30

User authorized clean consolidation before coordinator-owned G2 wiring. All three
completed managed checkouts were fully archived and verified, then removed. Git now
lists only the original main checkout. Final lane commits remain on
`codex/archive-wave2-session`, `codex/archive-wave2-pixels`, and
`codex/archive-wave2-assets`, plus a verified local Git bundle. Ignored evidence and
symlinks are retained in `.hermes/archive/2026-10-30-wave2/`; no source work was lost.
See `docs/refactor/reviews/2026-10-30/WAVE2-RETIREMENT.md` for audit and recovery details.
Old worktree paths below are historical; do not resume their completed tasks.
Coordinator's next task is G2 UI integration on main, without new parallel worktrees.
This cleanup does not claim G2 implementation or actual application acceptance.

## Wave-two batch 1 accepted — 2026-10-30

Coordinator integrated exact Session, Pixels and Assets source snapshots on main
`124ac1a80f3ec7729d5559bb105f3c4dc1abff27`. Combined complete suite passed **376 files /
2821 tests**; complete build passed with both typechecks. Both receipts show the same
SHA and clean status before/after. Real isolated Electron Canvas passed five cases;
real Session/Pixels/Depot/checkpoint composition passed eight, including text during
paint, Undo/Redo, failure/retry and folder relocation with the old root unavailable.

See `docs/refactor/reviews/2026-10-30/WAVE2-BATCH1.md` for exact lane SHAs and raw logs.
Pixels' incomplete original full-suite evidence is retained; main's complete combined
run closes its verification gap on byte-identical source. The abandoned verification
lock was preserved after confirming both owner and child had exited; no process killed.
Drawing ran on GPT-6.1-Terra after the user's model switch; the other lanes used Sol.

Three agents are finished; their clean managed worktrees and delivery evidence remain
available, with no new tasks dispatched. Accepted as G1 foundations only: production UI,
TIFF Save and application Close still use their existing paths. Next work is G2 adapters
and connected UI verification, followed by measured performance/platform acceptance.
No push, dependency installation, user media access or worktree deletion in this batch.

## Codex wave-two implementation dispatched — 2026-10-30

Three existing managed Codex worktree sessions resumed on gpt-6.1-sol/high. Shared contract
commit ca34ca1 defines the first bounded implementation batch: headless Session, real immutable
asset admission/read, Canvas brush/eraser pixel production. Main remains coordinator-owned.
See docs/refactor/wave2/IMPLEMENTATION-1.md and SESSIONS.md for ownership, thread IDs and gates.
Contract build passed; lane implementation/focused/full/build/Canvas results are pending.
No new-core production UI/TIFF wiring or acceptance claimed. No push, dependency installation,
old-project migration or cross-session-history behavior change. Next: inspect scoped delivery,
independent composition tests and review, then actual G2 UI wiring in a later assignment.

## Wave-one worktrees archived — 2026-10-30

User approved retirement. The three completed Hermes checkouts were fully archived and verified,
then removed; their branches/commits remain. Git now lists only original main. The cleanup-backup
and kickoff directories were relocated intact into `.hermes/archive/2026-10-30-wave1/` alongside
lane archives and audit manifests. Historical paths below refer to the pre-retirement locations.
Details: `docs/refactor/reviews/2026-10-30/WORKTREE-RETIREMENT.md`.
No agents restarted or next-wave worktrees created. Prepare new tasks/contracts before reopening lanes.

## Naming and replacement launcher verified — 2026-10-29

- Naming candidate `7db58ed` passed complete allowed tests (373 files / 2713 tests), full build,
  preload sync, resource preparation and synthetic actual Electron Import/draw/Save/Close/reopen.
  Raw logs/receipts and intermediate failures remain in `.hermes/naming/`; full details in
  `docs/refactor/reviews/2026-10-29/NAMING.md`. Active naming policy is `docs/architecture/NAMING.md`.
- User subsequently authorized rebuilding the launchers. One root `启动测试.command` now compiles
  current source and directly launches Electron; old `scripts/test-launch.sh` removed, originals
  backed up locally. Shell syntax, real dependency-only check and isolated lifecycle/error harness
  passed. Finder double-click remains TODO: verify. Application code is unchanged after its tested SHA.
- Main/local only; no push, disk-project migration, dependency install or agent relaunch. Historical
  reports and the three Hermes source worktrees retained. Windows/installers/independent acceptance
  remain unverified. Use new test projects; next Hermes work starts from unified main.

## Naming unification — 2026-10-29

用户已批准全部统一为 Storyboard Flow。当前代码/环境变量/IPC/TIFF/恢复 schema 使用 Flow 命名；
目录按角色分为 `.storyboard-flow`、`.storyboard-flow-project` 和 `.storyboard-flow/checkpoints`。
详见 `docs/architecture/NAMING.md`。以下历史记录中的旧名称属于当时的候选，不再是当前命名规范。
本次不迁移或删除原有文件，不重启已停止的 Hermes；命名验证结果见新交接记录。

## Hermes wave-one cores accepted — 2026-10-29

- Coordinator main integrated exact corrected implementation snapshots: drawing 8374441,
  storyboard 6ae4547, persistence bbbdf7d. Briefing commits/root reports were excluded; reports
  are archived separately in docs/refactor/reviews/2026-10-29/accepted-lanes/.
- All six independent review defects reproduced then verified fixed. Four new public-Interface
  composition tests cover PNG/history/checkpoint/reopen, folder relocation/Pending, asset failure
  and stale-baseline rejection. Main candidate 72f4011 passed 372 files / 2711 tests and full build;
  both ran with unchanged HEAD and clean status. Details/raw logs: RECHECK.md in that review folder.
- Accepted only as headless foundational modules. Production UI, TIFF/Save routing and launchers
  unchanged; no push, agent relaunch, worktree removal, dependency install or naming migration.
  Three worktrees remain available. Shared verification lock released; combined runner finished.
- Next: separately coordinate naming and missing session/asset/composite-command contracts before
  real UI integration. Windows, crash durability, real gestures and large-raster performance remain
  unverified. Earlier failed checks and historical records below are retained, not superseded to PASS.

## Hermes refactor kickoff — 2026-10-29

- User approved implementation, local commits and coordinator integration without push, then
  chose Hermes as the external implementation agents. The user launches them and reports back;
  no built-in agents or Hermes processes are started by the coordinator.
- Existing 47 modified/untracked source files were backed up and committed unchanged as
  `235145c22d66ce500a8ea60ef6e4e7a7f21aee2c`. Backup and hashes are in
  `.worktrees/hermes-kickoff-20261029/`. Both latest launchers retain exact bytes and executable modes.
- `docs/refactor/README.md` is the new work entrance. Shared candidate types and explicit lane
  tasks cover image-document edits, storyboard/history and new-format internal checkpoints.
  They do not yet replace production drawing, UI or Save. Old-project compatibility is not
  required, but existing test data, failure evidence and runtime protections remain intact.
- Lane-specific briefing commits remove old handoff entrances only in those worktrees. They
  must not be integrated into main. Main retains historical records below. Coordinator reviews
  implementation commits separately; delivery needs focused/full/build logs and exact SHAs.

## Old worktrees consolidated into original main — 2026-10-29

- User explicitly authorized comparing/preserving both old worktrees and removing them after verification, with no discarded uncommitted work or push. Original checkout remains on `main` at `1c3ab7cca2283b471499b1ad0fd8d481ddbea2c4` (already one commit ahead of the locally recorded `origin/main`; no fetch, commit, merge or push in this cleanup).
- `save-provenance-fix`: 45 of 46 modified/untracked source files matched original main exactly; the remaining file was its older `scripts/test-launch.sh`. Main's latest root `启动测试.command` retains the old launch behavior, and main's `scripts/test-launch.sh` delegates to it. Both main launcher files were preserved byte-for-byte, including their modes; the old standalone version is archived. `test-fixture-cleanup`: all six modified/untracked source files matched main exactly. Dependency symlinks pointed into main and were archived as links, never followed or used to remove main dependencies. Old generated builds/caches are also archived.
- Durable local backups and raw audit/receipts: `.worktrees/cleanup-backup-20261029/` (Git-ignored). `main.tar.gz` contains all 694 present tracked/untracked permitted source entries before cleanup; the two old-worktree archives contain all 866 and 858 permitted filesystem entries respectively, including ignored outputs and symlinks but excluding Git administrative files. Archive entry sets, file SHA-256 values, sizes, modes and link targets were verified before removal; exact manifests are in `audit.json` and `backup-verification.json`. The prohibited uncertified fixture was absent in all three checkouts and was not read, copied, hashed or executed.
- Both old chats were idle/not loaded; a read-only process check found no command lines referencing either old checkout. The current chat has no attached managed-worktree artifacts. After a fresh unchanged-state audit, explicit `git worktree remove --force <exact-old-path>` succeeded for each user-named dirty checkout; force was used only after preserving and verifying their complete permitted contents. This user-authorized consolidation supersedes the earlier historical archive-refusal notes below. `git worktree list --porcelain` now contains only the original `main` checkout.
- Scope is workspace consolidation, not an application implementation or new acceptance run. Only this additive handoff section changes tracked source during cleanup. Main's pre-existing source, tests, launchers and uncommitted status are retained; shell syntax checks passed for both launchers. No app launch, personal media/userData operation, dependency installation, full test/build rerun or publication in this cleanup. Final preservation checks and command results are recorded in the backup directory.

## Save/provenance and disconnected logging repair — 2026-10-29

- User authorized software fixes and tests, confirmed no unsaved work to preserve, and explicitly allowed discarding unfinished records in test-only storyboards. Focus remained the application. The initial Desktop handoff was read as evidence, not authority. No commit, push, dependency installation, global configuration change or installed-app replacement.
- Candidate base: `1c3ab7cca2283b471499b1ad0fd8d481ddbea2c4`. Fourteen scoped source/test files and exact SHA-256 hashes are in `/private/tmp/storyboard-save-provenance-fix/candidate-frozen.json`. Original checkout and attached `save-provenance-fix` managed worktree match that manifest. Original concurrent changes were preserved; 31 unrelated pre-existing files remained byte-identical before this handoff update. Main's existing work was retained when integrating the small logging change. Backups and raw evidence remain under `/private/tmp/storyboard-save-provenance-fix/`.
- Root cause: macOS system provenance can differ between old source files and files created by the current process. Cross-file inheritance now omits only `com.apple.provenance`; raw native observations, same-file stability checks, accounting, immutable partition keys and security attributes remain complete. Legacy claim fingerprints remain readable. Empty unexplained reserve records still refuse safely.
- Native staged writer: effective read-only access queries replace an `O_WRONLY` permission probe that itself changed source provenance/ctime. Existing-file replacements and first backups use the OS's atomic copy-on-write clone so Desktop-created stages do not acquire unrelated `com.apple.macl` grants. Never strip MACL or change system privacy settings. Unsupported clone capability alone falls back to the existing fully checked staging route; permission/I/O errors refuse. Stage budgeting funds the larger of old and new bytes plus raw attributes. Read-only originals remain non-writable; their first backup is an exact read-only clone. Metadata preparation uses descriptor metadata operations without opening read-only data writable. Only owned new stages may retry bounded ctime-only observation churn; original files remain strict.
- Main memory: comparison-only raster copies were removed. Independent funded before-snapshots remain; exact verified immutable Main backings may be shared. Full file/native rechecks remain. The production 1 GiB budget and GC-based charge release are unchanged. Regression now isolates one operation from setup and holds every adopted backing; the optimized path passes at 18 MB, while the old implementation fails before the PNG effect (`memory-old-18m-counterfactual.log`). An earlier 19 MB whole-setup test mixed baseline preparation with GC timing and failed once; that failure remains in `full-suite-delivery.log` and was not treated as a pass.
- Screenshot's `write EPIPE`: the test launcher had exited while its Electron child still logged to a closed pipe. `diagnosticOutput.ts` handles stdout/stderr disconnection while continuing file logging. No global exception swallowing. The smoke launcher uses the direct macOS Electron binary. Actual disconnected-pipe Electron test passed with exit 0 and continued logging (`pipe-disconnect-result.json`); three regression tests cover the logging helper.
- Real connected acceptance passed on the user's explicitly disposable Desktop test project: **31 shots**, actual pointer stroke → PNG autosave → explicit Save → Undo restoring exact original PNG bytes → second Save → normal Close → fresh-process editable reopen → normal Close. Zero unfinished-operation prompts. Evidence: `actual-app-clone-final.log`, `actual-app-result.json`, `actual-app-after-save.png`. This exercised old source provenance versus the current process, real preload/Main/native filesystem calls, TIFF output and normal Close. Both final test processes exited normally. Saving/closing this large retained project is still slow (minutes); performance is not certified or claimed fixed.
- Test-project recovery namespaces and exact origin registry key were archived before rebuilding a healthy baseline, under the user's explicit permission. Full initial project/recovery/claim archives and every failed attempt remain in `user-backup/`; no recovery failure was reclassified as successful Save. Recent-folder preferences restored exactly. Test stroke was undone and its PNG hash verified; all 95 actual PNG layer files across the test folder match the initial archive byte-for-byte (`final-layer-content-audit.json`; AppleDouble archive metadata is counted separately, not treated as images). Source images were updated only by explicit Save.
- Focused final native tests: **3 files / 33 tests**, exit 0 (`native-release-final.log`), covering cross-context policy/legacy records, source stability, stage churn, larger original stage budgeting, unsupported clone versus denied permission, readonly backup and source-save failures. `staging-final-expanded.log` covered 15 owned-stage/memory tests; the completed suite below supersedes intermediate candidates. Earlier failures, fixture-only setup errors, missing vendor-path failures and test timeouts are retained rather than erased.
- Final synthetic multi-project GUI passed (exit 0): `gui-clone-final.log`, `swb-inline-import-RuZakl/result.json`. Covered Import, dirty project switching, no-Save Close and fresh editable reopen, explicit Save updating originals, exact first-backup preservation and zero normal Close prompts. LaunchServices/direct launch happened to share the same provenance, so that switch is not evidence of actual marker drift; actual distinct native markers were separately verified in `real-provenance-result.json`.
- Final full build passed with both typechecks (`build-release-final.log`); only the existing large-bundle warning. The attached managed worktree also built successfully (`build-managed-release.log`).
- Complete allowed `npm run test` passed **359 files / 2586 tests**, exit 0, 1200.93 seconds (`full-suite-clone-final.log`). Command: `TMPDIR=/private/tmp/storyboard-save-provenance-fix SWB_PYTHON_DEPS_DIR=<original-checkout>/vendor/python/photoshop-tiff npm run test`, run in the isolated worktree. Final native compatibility refinements were made while this long invocation was running; its later native tests loaded those refinements (20 provenance tests, 10 physical-outcome tests, 3 managed-source tests), and the final focused 33-test run separately passed. Do not describe the invocation as an immutable-start candidate audit. Code was frozen afterward in `candidate-frozen.json`; original build, final GUI/source hashes and final delivery manifest identify the delivered files.
- Final `git diff --check` passed. All final GUI and pipe-disconnect test processes exited, with no owned Electron processes remaining (`owned-process-cleanup-final.json`). The managed worktree remains attached because the app refuses archiving its primary checkout; no manual deletion workaround was used. Source is delivered locally, not committed/pushed/published.
- Scope limits: self-tested, not independently accepted, published or installed. Native chooser, Windows, non-APFS real volumes, clean-machine installer and hostile cross-process/crash durability remain unverified. Synthetic unsupported-clone tests do not prove every filesystem. Full suite excludes the prohibited uncertified renderer test; it was not read, copied, hashed or executed. Tests used existing vendor dependencies, not installed dependencies. Personal clipboard and Trash were forbidden in GUI harnesses.

## Test workspace cleanup — 2026-10-29

- Worktree cleanup boundary: the app refused `archive_worktree` with "The task's primary checkout cannot be removed." The verification checkout `/Users/xiali/.codex/worktrees/test-fixture-cleanup/appshot-bitmap-layers` remains attached and usable. The delivered fix and documentation are in the original project checkout; future commit work must account for its pre-existing concurrent edits. No manual workaround deletion was attempted.
- Fixed all eleven checkout-relative temporary-directory allocations in four test files: writer gate, recovery store, Mac recovery authorization and Mac metadata. `test/temporaryWorkspace.ts` allocates canonical system-temp containers, owns sibling copies/aliases, removes successful-test containers without following external symlinks, and retains failed-test evidence outside the checkout. Temp overrides inside the checkout are refused. Existing protection assertions and production code are unchanged. See `docs/testing/temporary-workspaces.md`.
- Removed 36 existing empty `gate-clean-*` / `gate-v2-partial-*` directory trees using only bottom-up `rmdir`; no nonempty recovery data was deleted. Focused tests rerun in the original workspace created no new top-level entries.
- Candidate: base `1c3ab7cca2283b471499b1ad0fd8d481ddbea2c4` plus scoped files recorded in `/private/tmp/storyboard-fixture-fix/candidate-manifest.json`. Used an isolated worktree to preserve concurrent development. All 27 pre-existing modified/untracked source files remained byte-for-byte unchanged when the fix was integrated and at final verification.
- Self-verification: complete allowed `npm run test` passed **356 files / 2545 tests** (exit 0); complete `npm run build` passed (both typechecks included, existing bundle-size warning). Final focused run passed **5 files / 33 tests** in the isolated candidate and again in the original workspace with concurrent changes present. Full-suite top-level directory comparison found no additions; the helper left no containers in the suite's temporary directory. `git diff --check` passed. The non-certified excluded test was not read or executed.
- Commands: `SWB_PYTHON_DEPS_DIR=<original-checkout>/vendor/python/photoshop-tiff TMPDIR=/private/tmp/storyboard-fixture-fix npm run test`; `npm run build`; focused `npm run test -- electron/main/temporaryWorkspace.test.ts electron/main/workspacePhysicalWriterGate.test.ts electron/main/workspaceRecoveryStore.test.ts electron/main/macRecoveryContentAuthorization.test.ts electron/main/macRecoveryMetadata.test.ts` with the same vendor dependency path. Dependencies were reused, not installed.
- Raw evidence: `/private/tmp/storyboard-fixture-fix/` contains `full-suite.log`, `build.log`, `focused-final.log`, `integrated-focused.log`, old-empty cleanup inventory, root inventories, candidate sources/hashes and preserved-work hashes. Full suite/build certify the isolated candidate; the focused integrated run checks compatibility with concurrent original-workspace edits. This is self-verification, not independent acceptance or an installer/GUI release. No commit or push in this task.

# Storyboard Flow — source integration handoff

## Editable checkpoints and explicit original-image Save — 2026-10-28

User explicitly approved keeping drawing durably without Save, seamless normal Close, and updating original root images on explicit Save with a first-overwrite backup. This supersedes the older source-preservation-on-Save and unsaved-import Close-refusal requirements below. Import/autosave still do not overwrite originals.

- Production Main opts into `automaticCheckpoints`. A first completed owned-project autosave or first ordinary bitmap mutation establishes the existing native/readback-certified current terminal without changing TIFF pixels, pendingBake or filenames. Non-owned import inputs retain their ordinary route. `certifyEditableSet` requires all slots to be Main-proven healthy, then uses full exact retention and the existing second frozen capture. Failed/unknown/active effects, hidden roots, retained intents, quotas and native restrictions are not waived. Close waits for an existing Save before freezing/draining slots.
- `managedSourceSave.ts` runs only inside explicit Main Save for recognized `.storyboard-flow/` children. It preflights stable shot/source mappings, external hashes and parent recovery guards, then updates corresponding root images in their existing names/encodings after internal output publication. Newly created shots use collision-refused new paths. Parking/deletion still uses the internal project lifecycle; this feature does not additionally delete source originals.
- New import markers record input/source names and hashes; prior count-only markers are supported by matching the original root's decoded PNG against the archived imported PNG. Intermediate Save naming may change `sourceFileName`, so `swb.sourcePath` also participates in matching; conflicts refuse. Source ledger records stable shot ids and current/pending output hashes. Original bytes are backed up once under `.storyboard-flow/.original-images/`. Backup native policy is inherited from the original; staged output preserves target restrictions and uses compare-and-replace byte checks. All source-sync failures after internal publication report incomplete Save, retain installed outputs/backups and do not produce a successful Save ACK.
- Safety scope: no real media, installed application replacement, dependency install, global config, clipboard/Trash, commit or publication. Existing uncommitted work backed up in `/private/tmp/storyboard-direct-save/before.tar.gz`. Native helper additions are optional parameters; existing layer callers retain their contract. Tests use only synthetic isolated projects/userData.
- Final targeted regression: 4 files / 26 tests passed (`focused-final.log`); expanded failure/retention regression: 7 files / 48 tests passed (`focused-expanded.log`, before the final source-name correction, which is covered by the final targeted suite). Full build with both typechecks passed (`build-final.log`); preload sync, resource preparation using existing dependencies and script syntax passed. Complete allowed invocation finished: 352 files passed / 3 failed, 2490 tests passed / 51 failed (`full-suite.log`, exit 1, 1248.21 s). All failures came from three function-extraction test callers missing the new production `prepareManagedSourceSave` dependency. Those callers now bind the actual imported helper; no assertions or production code were changed to fix them. Full rerun of all three affected files passed 149 tests (`full-failures-rerun.log`, exit 0, 24.88 s). `suite-coverage.json` reconciles all 355 allowed files / 2541 distinct tests with no missing files. This is combined complete coverage, not a second all-green single invocation. The production candidate used for the passing GUI/build was unchanged by these fixture-only corrections.
- Actual isolated Electron GUI passed (`gui-isolated.log`, fixture/receipt `swb-inline-import-HbfVe2/result.json`): Import without destination picker, real brush, Close without explicit Save, fresh-process editable reopening with exact painted PNG and pending output, original images unchanged until Save, dirty-project keyboard isolation, second project Import, explicit Save updating originals, exact first backups preserved on repeat Save, hidden unsaved project retained, zero Close prompts and a final fresh-process reopen with the same painted PNG. All three app launches closed normally; no forced stop, clipboard or Trash on the passing run. Screenshot inspected. GUI is self-verification, not independent acceptance or installed-app acceptance.
- Earlier GUI logs remain diagnostic, not PASS: `gui-initial.log` exposed a transient source-name mapping bug corrected using import provenance and covered by native regression. `gui-final.log` included a Gaussian blur interaction outside the scripted flow; the user reported a possible accidental blur action. The final run hides its dedicated Electron windows to isolate desktop input while retaining actual renderer/Main/CDP pointer behavior and byte-equality assertions. Earlier failing runs stopped only test-owned processes after assertions. An initial unit fixture used default lossy TIFF and was corrected to explicitly lossless TIFF without weakening pixel equality.



- Reproduction: `env TMPDIR=/private/tmp/storyboard-direct-save SWB_PYTHON_DEPS_DIR="$PWD/vendor/python/photoshop-tiff" npm run test`; affected rerun uses `electron/main/normalSaveMainChain.test.ts electron/main/normalSaveScriptImportChain.test.ts electron/main/tiffSavePreparation.test.ts`; `npm run build`; `npm run check:preload`; `npm run prepare:package-resources`; `env TMPDIR=/private/tmp/storyboard-direct-save node scripts/electron-inline-import-smoke.mjs`. Node 22.22.3, Python 3.14.3 and existing compatible dependencies were used. The uncertified test path was neither read nor executed; the configured exclusion and enumerated coverage remain intact.
- Final cleanup moved 38 generated checkout fixtures intact to the evidence directory's `workspace-fixtures/`; `workspace-fixture-cleanup.json` records paths/identities/alias targets. No retained failure objects were deleted. Read-only process inventory showed no remaining test Electron processes. Exact HEAD, diff digest and changed-source hashes are in `candidate.json`, with the tracked patch and changed-source archive. No independent acceptance, installed-app update or publication. Windows, clean-machine packaging and real-user-media acceptance remain TODO: verify. The broad bitmap smoke was not run because it also exercises clipboard/Trash; its scenarios are retained.

## Managed child project and stable source address — 2026-10-28

User explicitly changed the conversion destination: create the editable copy **inside** the selected source folder, keep that source as the user-facing address, and remove Destination selection. This supersedes the outside-source restriction in the older records below; original image/legacy metadata preservation and native recovery authority still apply.

- `managedFolderProject.ts` recognizes a fixed `.storyboard-flow/` child and its bounded, non-executable `.source-folder.json` preparation marker. Explicit Import exclusively creates the child, copies visible image pixels, writes the marker only after copying, then uses the existing staging Import. Prepared inputs are reused; existing completed projects are opened without another import. Collisions, aliases, corrupt records and incomplete copies are retained and refused. Merely finding a folder/marker does not grant editability; ordinary asset/Open/recovery validation still runs.
- Original root images and `.storyboard-workbench/` stay unchanged. Internal working TIFFs, current JSON and bitmap assets live in the child. Save, observation, History, cleanup and recovery continue using that actual child root. The physical writer guard still checks ancestors, including original-folder recovery protection. No permission guard or Save contract was loosened.
- The renderer's existing import controller remembers only display aliases; address bar and recent folders use the source. Main derives the new project's name from that source. Startup recovery probes the child and opens its actual recovery entry when required. A refused existing child shows source previews with editing/Import blocked, rather than silently overwriting the child or showing another project's editable board under the requested path.
- Real GUI checks caught the existing held-slot recents gap: switching back to an already-open slot did not rescan, so Main never remembered that last activation. Added top-frame/directory-validated `recent:rememberOpenedFolder`, synchronized both preloads/types, and record only successful activations. Preferences-only failures do not turn a successfully opened project into failed Import.
- Product-name audit: UI/window/package/new TIFF metadata already use **Storyboard Flow**. Remaining exact `Storyboard Workbench` occurrences are compatibility readers/types, tests and explanatory documentation. `.storyboard-workbench`, SWB and XMP namespace remain compatible. Ordinary current-project and PNG/JPEG/TIFF/script Import routing remains unchanged; no existing external converted folder is moved automatically.
- Evidence folder: `/private/tmp/storyboard-nested-import/`; pre-existing uncommitted work backed up in `before.tar.gz`. Final focused regression: **10 files / 76 tests passed**, exit 0 (`focused-final.log`). Final `npm run build` passed both renderer/Electron typechecks (`build-final.log`); `npm run check:preload` passed (`preload.log`); both smoke scripts parse and `git diff --check` is clean. Complete allowed test invocation **352 files / 2535 tests passed**, exit 0, duration 1240.51 s (`full-suite.log`). The new recent-handler test file was added after that invocation enumerated files and passed in the focused run; `suite-coverage.json` reconciles **353 allowed files / no missing files** across these runs. The long run began before the final recents/blocked-display refinements; affected final sources are covered by the 76-test regression and final rebuilt GUI, not a second complete native run.
- Final actual GUI **passed**, exit 0 (`gui-verified.log`), fixture/receipt `swb-inline-import-6rJ87Z/result.json`: no destination chooser, source address/project name/recents, reopening the same source without duplicate Import, actual brush stroke, dirty-project keyboard isolation, second-project Import, hidden-unsaved Close refusal, Save-all, normal retained Close and fresh-process reopening of the last active source. Original PNGs/legacy JSONs and directory listings are checked; painted layer hash retained. Both test app launches closed normally, no forced stop on the passing runs. Screenshots were inspected. `gui-final.log` also passed before the final blocked-project/display refinements; `gui-verified.log` is the final-build evidence. No skips within this scenario. Final process inventory showed no remaining GUI test processes.
- Reproduction: `env TMPDIR=/private/tmp/storyboard-nested-import SWB_PYTHON_DEPS_DIR="$PWD/vendor/python/photoshop-tiff" npm run test`; focused command names are retained at the top of `focused-final.log`; `npm run build`; `npm run check:preload`; `env TMPDIR=/private/tmp/storyboard-nested-import node scripts/electron-inline-import-smoke.mjs`. Existing Node 22.22.3 / Python 3.14.3 / compatible vendor dependencies were used. Native tests/Electron required escalation for native metrics and launch. The full bitmap smoke was not run because it exercises unrelated clipboard/Trash workflows; its existing scenarios are retained. No installer, cross-machine or real-user-project acceptance is claimed.
- Cleanup: 29 generated checkout entries moved intact to `workspace-fixtures/` with `workspace-fixture-cleanup.json`; no failure/recovery data deleted. Earlier failed GUI attempts stopped only their test-owned processes; passing runs closed normally, and final inventory found no test GUI process. Exact base, changed-file hashes and diff digest are in `candidate.json`. No independent acceptance or publication.
- Earlier GUI logs are retained: `gui.log` exposed a test scheduling error (issuing the next open before the path control became available); `gui-retry.log` exposed the genuine last-opened-folder bug fixed above. Subsequent logs contain existing watcher refusal during protected slot retention and the expected hidden-unsaved-project Close refusal; those boundaries are not bypassed. Only synthetic projects and separate userData are used, with chooser/clipboard/Trash access forbidden and confirmation responses supplied by the harness. No real media, install, dependency download, commit, push or publication.

## Inline source preview and shared Import — 2026-10-28

User authorized implementation after choosing the existing top-left Import as the only conversion action. This supersedes the modal presentation below; the source-preserving new-folder conversion contract remains unchanged.

- `FolderImageBrowser.tsx` now renders a normal workspace section with image previews, one short conversion notice and Return to workspace. The toolbar Import is highlighted; Save/Add/matte/view/Pending editing controls are disabled for the preview. The original editor stays mounted inside a hidden/inert wrapper, with its state and History intact. Returning restores its path. Ordinary editable-folder Open and ordinary image/script Import keep their original routing.
- `folderImageImportController.ts` owns explicit copy → existing staging Import → publication, duplicate-click/switch blocking, cancel/error feedback and prepared-folder retry. Document-level keyboard isolation runs after the visible focused control and before hidden editor window shortcuts; this keeps native Enter/text input usable. Native close/reload refuses while conversion is in flight. No new source write path, metadata migration, dependency, preload contract, Save/Import writer or permission-policy change.
- Self-tests: full allowed Vitest run completed **352 files / 2515 tests passed**, exit 0 (`full-suite-final.log`). After the later startup-probe correction described below, affected final regression **11 files / 79 tests passed** (`focused-final.log`); the entire native suite was not repeated after that narrow correction. Full `npm run build` including both typechecks passed (`build-final.log`); Vite reports its existing large-chunk warning. Smoke scripts parse; existing bitmap smoke's legacy scenario is preserved and updated for the inline view. No preload changes; full bitmap smoke not executed because it also exercises Trash/clipboard and unrelated paths.
- Source-preservation GUI checks found that `RecoveryEntry` previously used the legacy external-change probe at startup and could create an empty `storyboard-script.md` before App inspected an old folder. `startupRecoveryMode` now inspects first and bypasses that probe for browse-only sources; current-project probes use the existing normal read-side script check. Added cancellation/current/protected routing regressions. This fixes the actual startup side effect without widening any writer or recovery authority.
- Actual isolated Electron checks use only generated images, separate userData and the real renderer/preload/Main/Import. Native chooser/prompt responses are supplied by the test entry; clipboard and Trash APIs are explicitly forbidden. Verified inline previews, keyboard Enter activating toolbar Import, cancellation, conversion to owned TIFF/layers, actual pointer painting, keyboard isolation while viewing old files, return to dirty editor, a second Import while the previous project has changes, and Save. Original source PNGs/JSON were hash-checked unchanged. Screenshots inspected.
- The multi-project check revealed an existing protected-state boundary: a newly imported hidden project without Save cannot be certified for Close (`Close collection Root has no Main-owned Save lease or authenticated settled reader`); Close is cancelled and the window remains available. No guard was weakened. The final GUI test confirmed that switching back and saving that imported project allows normal retained Close. It then launched a fresh process and verified the painted layer hash and editable project. This is a verified protected-state constraint, not a waived failure; self-tests do not constitute independent acceptance.
- Final GUI run **passed**, exit 0: `gui-final-source-preservation.log`, fixture/receipt `swb-inline-import-D5C7im/result.json`, and screenshots `inline-preview.png` / `editable-after-import.png` in that fixture. Both test app launches closed normally through the production Close path; no forced stop was needed on the final run. Root directory entries, internal source entries and original PNG/JSON hashes all remained exact. There were no skips within this focused multi-project scenario.
- Evidence is retained under `/private/tmp/storyboard-inline-import/`. Initial `full-suite.log` was interrupted after outdated test-caller bindings were found; shared test scopes were updated without dropping assertions, then the complete allowed suite was rerun. Earlier GUI diagnostics retain failures from test selectors, native Enter event formatting, pending autosave timing and bounded waits, and the real startup Markdown side effect above; those attempts are not PASS evidence. The broad native suite took about 19 minutes. Its 29 generated checkout fixtures were moved intact to `workspace-fixtures/` with `workspace-fixture-cleanup.json`, rather than deleting failure/recovery data. Two earlier test windows still held after Close refusal were force-stopped only after that refusal settled; `process-cleanup.json` records their identities. Final process inventory found no remaining test Electron windows.
- Reproduction: `env TMPDIR=/private/tmp/storyboard-inline-import SWB_PYTHON_DEPS_DIR="$PWD/vendor/python/photoshop-tiff" npm run test`; `npm run build`; `env TMPDIR=/private/tmp/storyboard-inline-import node scripts/electron-inline-import-smoke.mjs`. The focused regression names are the 11 files listed in `focused-final.log`; execution used installed Node 22.22.3 and Python 3.14.3 with existing matching vendor dependencies, no install. Native/GUI checks needed an environment permitting native metrics and Electron launch; the denied sandbox Electron launch is retained in `gui.log`.
- Candidate base: `af7068ad3d62a90cee5b16750a15820d10cd5fb2` plus this uncommitted diff. Exact changed-file hashes and the tracked diff digest are in `/private/tmp/storyboard-inline-import/candidate.json`. No independent acceptance, package/installer update, commit, push or publication in this task. Native picker interaction, real user media and cross-machine behavior remain unverified.

## Image browsing and new-folder Import — 2026-10-28

Delivery: the user requested committing and pushing these source changes on 2026-10-28. Use Git history/remote status for the delivery result; the verification limits below still apply and do not certify the generated test builds.

This supersedes the earlier old-project *refusal UI* below, not the decision to retire legacy equivalence migration.

- User clarified that opening an old folder must still display its pictures, and explicitly chose conversion into a **new folder**, preserving the original project and images.
- Added a separate root-image browser for legacy/uneditable folders and formats needing conversion: PNG/JPEG/TIFF/WebP/GIF/AVIF. Memory previews do not write caches or traverse old internal layers. Current projects and fresh ordinary PNG/JPEG/TIFF folders keep their existing Open/Import workflow. Refused normal Open can fall back to readable images without a Save-failed modal.
- `Import to new project…` asks for an outside destination parent, makes a unique child directory, copies flattened visible image pixels to PNG, then uses the existing Import in a staging slot to create owned TIFF/layers and durable metadata before publication. No old dialogue, script or editable-layer migration; animated images use their first frame. Cancel writes nothing; failed preparation retains partial copies only in the new directory and reports their location.
- Fixed first-Import directory observation: TIFF preparation now uses existing `mkdirObserved` for its own metadata-parent creation. Identity replacement refusals remain tested, not bypassed.
- Source: `FolderImageBrowser.tsx`, `folderImageBrowserService.ts`, `ipc/folderImageBrowserHandlers.ts`, shared `folderImages.ts`, App routing, synced preload interfaces. Tests cover source preservation, formats, cancellation, malformed metadata, unreadable images, routing races and staging Import. The existing bitmap smoke legacy scenario now asserts decoded previews and unchanged original files rather than blanket refusal.
- Final expanded regression: **166 files / 1393 tests passed**. Explicit typecheck, build (renderer and Electron), preload consistency and smoke syntax checks passed. Full allowed test run completed with **344 files passed / 6 failed; 2487 tests passed / 7 failed**, plus the rejected promise from the old App test fixture. Three failures were outdated callback bindings/error-channel expectations corrected during that run and passed in the expanded rerun. Four memory tests hit `RAM_ADMISSION`: sandboxed `sysctl` returned Operation not permitted, while the same read-only query outside the sandbox returned valid normal-pressure readings. No production memory policy was loosened. Final rerun of all six failed files outside the sandbox: **6 files / 104 tests passed**, no unhandled errors. There has not been a second complete-suite run on the final source.
- Actual isolated Electron GUI passed old-folder browse (2 decoded images, no Save modal) → Import → owned TIFF/layers/durable JSON in the new directory; source TIFF/PNG hashes and JSON unchanged. Native destination dialog used a test-only chooser returning a synthetic destination; renderer, preload, Main and Import were real. Screenshot inspected. Test app was force-stopped only after assertions; this does not verify clean Close. No personal userData, clipboard or Trash touched.
- Read-only check of the user's supplied `S25V0_lixia`: all 40 root images decoded with the new preview service; project JSON unchanged. No real conversion or source write was performed.
- Logs/fixtures: `/private/tmp/storyboard-browse.i4jQnX/`: `regression-final.log`, `build-final.log`, `typecheck-final.log`, `preload-final.log`, `full-suite.log`, `native-memory-rerun.log`, `full-failures-rerun.log`, `gui-smoke-visual.log`. Synthetic GUI output and screenshot are under `gui-xrn6pF/`; local GUI runner/entry remain in the same temporary evidence directory.
- TODO: verify real native destination chooser, fresh converted project drawing/Save/reopen, and edited-current-project → browser → Import switching. The full bitmap smoke was not run (it also touches Trash/clipboard and unrelated workflows). No commit or push performed.

## Local simplification — 2026-10-28 (earlier verification record)

- Base: local `main` at `ad4c34e` (PR3 integrated locally; no push in this task).
- User decision: only current-version new projects are supported for editing; preserve old test project files without promising direct editing.
- Removed the old single-layer TIFF equivalence exporter/importer/probe chain and its packaging requirement. Ordinary editing checks the old-project format before recovery observation/workspace freeze; readonly recovery remains available. No user project assets were read or changed.
- Open errors now use a non-modal open status instead of setting Save/Autosave failure state. Save rollback, filename collision checks, layer paths, recovery records and unsaved-close protection are unchanged.
- Self-tests: expanded regression passed 162 files / 1331 tests; full build (both typechecks included), preload sync, package resource preparation and six synthetic package-validator tests passed. The complete allowed `npm run test` attempt was interrupted (exit 130) after several minutes without further results while a Python child remained active. Three old error-channel test expectations found during verification were updated to assert open status rather than Save failure, and all passed in the expanded rerun. Full-suite PASS is **not** established.
- Actual isolated Electron GUI: synthetic old-project startup showed a non-modal unsupported-format status, no Save-failed modal, unchanged original JSON; the same window then opened a fresh empty folder. Only the test-owned Electron was stopped. No personal userData, clipboard, Trash or artwork was used. This is self-verification, not independent acceptance.
- TODO: verify new-folder Add/draw/Save/reopen and switching from an edited current project to an unsupported old project in the actual GUI (the latter has Main/slot regression coverage). The legacy case in `scripts/electron-bitmap-smoke.mjs` now asserts non-modal refusal and unchanged displayed shots; that full smoke was not run because it also exercises Trash/clipboard and unrelated workflows.
- Raw local logs and synthetic fixtures: `/private/tmp/storyboard-simplify.5bM8kH/`. Final receipts: `regression-final.log`, `build-final.log`, `preload-final.log`, `package-resources.log`, `package-validator.log`, `gui-smoke.log`; interrupted attempt: `full-suite.log`. No commit or push performed.

Verification commands (this workstation; synthetic temporary data only):

```sh
npm run build
npm run check:preload
npm run prepare:package-resources
env TMPDIR=/private/tmp/storyboard-simplify.5bM8kH python3 scripts/test-release-package.py
env TMPDIR=/private/tmp/storyboard-simplify.5bM8kH SWB_PYTHON_DEPS_DIR=/Users/xiali/Documents/Storyboard-flow/vendor/python/photoshop-tiff npm run test
env TMPDIR=/private/tmp/storyboard-simplify.5bM8kH SWB_PYTHON_DEPS_DIR=/Users/xiali/Documents/Storyboard-flow/vendor/python/photoshop-tiff npm run test -- src/renderer src/shared electron/main/workspaceFormat.test.ts electron/main/normalOpenPreviewInitialization.test.ts electron/main/normalOwnedOpenChain.test.ts electron/main/normalSaveTransport.test.ts electron/main/recoveryCloseBarrier.test.ts electron/main/fileRenames.test.ts electron/main/normalSaveMainChain.test.ts
node /private/tmp/storyboard-simplify.5bM8kH/gui-smoke.mjs
```

Scan disposition: retired the legacy TIFF equivalence chain, its double invocation and packaging probe; separated Open status from Save errors. Retained current-project output identity, path boundaries, rename collision/rollback, unfinished writes, History/recovery and Close safeguards. Native recovery policy and workspace switching are tightly connected to current-project data retention, not established dead code; broader removal needs a concrete replacement behavior and separate verification rather than deleting checks by keyword.

The earlier source-integration boundary and remaining platform caveats below still apply.

This is the complete approved source integration candidate, not an installer or a formal Release. Do not infer Windows, clean-machine, real Photoshop, Trash, clipboard, crash or cross-process guarantees from local checks.

Start with AGENTS.md, README.md and todo.md. Architecture is in docs/architecture/SYSTEM.md; stable rationale is in decisions.md. Workstation logs, private task discussions and one-off diagnostic launchers are intentionally not distributed. Required synthetic fixtures and executable test tooling remain in source.

## Integration contents

The source combines the existing main CI/release preparation with the Mac data-safety/recovery implementation, retired built-in AI modules, renderer/module cleanup and evidence-comparison tooling. Existing production guards, failure records, History/custody and recovery budget policy remain intact.

The first-create Save path includes compatible Python selection at the environment boundary, bounded complete native directory re-observation with fixed identity/restrictions, and retained-close comparison against the actual persisted Project after a required persistence succeeded but final ACK failed. Retention does not turn failed Save into success.

Native tests select Python through PATH rather than a workstation Homebrew absolute path. Use Python 3.12 with matching installed TIFF dependencies. CI passes its installed vendor path explicitly. Both packaging recipes include the production native helpers; package validation rejects missing helpers. This source change is not proof that either complete package has run on its target machine.

## Verification boundary

The preceding integration self-test exercised a real offline App: new synthetic empty directory → Add → edit dialogue → Save → normal retained Close → fresh-process reopen with the same dialogue → normal retained Close. Failure retention also has real Main/native regression coverage; service-level fault injection is not equivalent to a natural failed-GUI scenario. Exact source/build identities and raw receipts are held in the private task handoff. Final delivery/independent review status must be read from the task record, not inferred from this page.

The special non-certified normalSaveMetadataHistory test is intentionally absent and excluded in Vitest configuration. Other required fixture sources remain present. See todo.md for unverified product/platform areas.

## Local development

Use Node.js 22 and Python 3.12. Once installation is authorized, use the lockfile with npm ci and install the requirements into vendor/python/photoshop-tiff. Export SWB_PYTHON_DEPS_DIR to that directory for tests, and use an isolated TMPDIR for synthetic work. Python native wheels must match interpreter and architecture. Do not use production folders as fixtures.

Build with npm run build (both typechecks included), then npm run check:preload. Required tests use the allowed Vitest configuration; tests and smoke scripts still need an authorized safe execution environment. Do not run legacy smoke commands blindly against real userData, Trash or clipboard.
