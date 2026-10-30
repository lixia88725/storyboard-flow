## Pending explicit-Save lifecycle — 2026-10-31

Candidate 5643287bc1d175ddffdcf59e6a55275ce30788db implements the approved logical Pending
policy in the isolated editor. Drag/restore/Undo changes membership and checkpoints only.
Save places parked TIFFs under project/Pending/; active TIFFs stay in the project root.
Editable layer assets remain under .storyboard-flow/checkpoints/assets/ and originals under
.storyboard-flow/originals/. Unchanged image/text inputs reuse TIFFs without raster encoding.
Moves have persisted identity/digest intents, exclusive publication and retry after interruption.

Final clean unchanged candidate: full allowed suite 383 files / 2898 tests, complete build
and 42 real Electron cases pass. Actual pointer parking, logical-only disk checks, Undo/Redo,
Japanese restore, Save relocation and new-process reopen are verified. Raw evidence/limits:
docs/refactor/reviews/2026-10-31/G3-PENDING.md. Policy: docs/refactor/PENDING.md.
Implemented/self-tested; independent acceptance remains open. No push or worktree cleanup.

Pending policy is now approved (supersedes the earlier undecided status below). Production
App/launcher remains unchanged. Next: actual TIFF import/bootstrap and A/B acceptance,
ordered filename synchronization, exported-shot Trash deletion, remaining tools and full-shell
routing. External TIFF refresh, Windows, installers and large-raster scale remain unverified.

## G3 explicit TIFF Save slice — 2026-10-31

Implementation ff1a159 plus Close-wait correction 7d152ea connects explicit TIFF Save
in the isolated editor, with first-original backups, native CAS writes, per-file retry
ledger and captured-revision status. Close waits for Save and rechecks active strokes.
Self-tests: full suite 383 files / 2890 tests passed; clean final build and 36 real
Electron scenarios passed. Full-suite receipt spans ff1a159 -> 7d152ea (UI/smoke-only
correction); it is not an unchanged-HEAD receipt. Exact evidence and limits:
docs/refactor/reviews/2026-10-31/G3-TIFF-SAVE.md.

G3 is NOT COMPLETE and independent acceptance remains open. Missing: actual TIFF
import/bootstrap UI, A/B acceptance, ordered naming, removed/parked output lifecycle,
Pending and production shell routing. Existing source names remain; new outputs use
shot-ID names. Bound membership changes currently refuse Save. No default App/launcher
switch, personal files, dependencies, worktree removal or push.

Pending recommendation (not approved): project-owned membership and automatic
checkpoint; file effects only on explicit Save. User asked for PD2 evidence and the
simplest/resource-efficient design. PD2 Idea Bin is a reference/group/state-based
cross-document library; the document does not specify drag-time TIFF moves. Existing
Pending file behavior remains unchanged until the product decision is made.

## G2 Board editing workflow — 2026-10-30

Candidate `9cdfda3d59990f92ff4cb5139b4d8116139f1a89` adds queued blank-shot creation,
shared Cmd/Ctrl/Shift selection, grouped reorder/end/delete and stable-ID dialogue
transfers to the isolated grid/Japanese editor. Each Board action is one history entry.
New shots inherit active dimensions; empty board defaults to 1920x1080 opaque white.
Full allowed suite **382 files / 2885 tests**, complete build and 31 isolated two-process
Electron GUI cases pass. Receipts show clean unchanged candidate. New blank is drawable,
Undo restores exact pixels, and reopened PNG is verified opaque white. Details:
docs/refactor/reviews/2026-10-30/G2-BOARD-EDITOR.md.

Implemented/self-tested only; independent acceptance remains open. Group drag/drawing
use actual pointer events; modifier selection/dialogue transfers use DOM events, not
OS-level dialogue drag proof. Default App/launcher and production TIFF remain unchanged.
Next: TIFF source binding, explicit Save/first backups and Pending lifecycle; structural
layer tools, blur/selection transforms and complete shell parity still remain. Windows,
scale and installers unverified. No new worktrees, cleanup, dependencies or push.

## G2 pixel tools and shot deletion — 2026-10-30

Candidate `0a09ea605c99b9c83a1dc086660236c649104f8a` connects fill/clear/bounded merge
through the sole Session queue and one atomic image/history publication. The isolated
editor uses SketchPad fill drops in grid/Japanese views, LayerPanel merge, clear-current
layer and single-shot deletion. Full suite **381 files / 2879 tests**, complete build
and 22 actual two-process Electron scenarios passed on the frozen clean candidate.
See docs/refactor/reviews/2026-10-30/G2-PIXEL-TOOLS.md for receipts and limits.

Implemented/self-tested only, independent acceptance remains open. Default production
App and launcher remain unchanged. Merge only supports the documented contiguous,
visible, unlocked subset; unsupported cases refuse. Remaining Board insertion/multi-
selection/dialogue-drag UI, structural layer tools, blur/selection transforms, TIFF
Save/first backups and Pending lifecycle still need implementation/verification.
No new worktrees, cleanup, dependencies or push; all three prior worktrees retained.

## Batch 3 modules integrated and verified — 2026-10-30

Coordinator integrated exact reviewed Board, Drawing and TIFF source on main
`ff9de85a6e291cb9813bc4c967ebe75a69ca00bc`. Full allowed suite: **381 files / 2872 tests**;
complete build passed with clean unchanged candidate receipts. Actual isolated Electron
Canvas passed 12 cases. Cross-module synthetic Canvas PNG -> TIFF -> depot -> Session
insert/Undo/Redo -> checkpoint/reopen -> TIFF preserved exact raw pixels and Unicode text.
Board insertion and Drawing sparse-RGBA review findings are resolved. Bounded module
integration accepted; see docs/refactor/reviews/2026-10-30/batch3/ACCEPTANCE.md.

All three worktrees and raw evidence remain intact, no push or production routing.
Next: coordinator Session adoption of fill/clear/atomic merge and existing UI commands,
then TIFF Save/Pending/lifecycle gates. No new GUI wiring in this integration; Windows,
installers and representative large-project performance remain unverified. Prior batch
review-in-progress entries below are historical and superseded by this acceptance.

## Batch 3 coordinator review in progress — 2026-10-30

Verified lane full/build receipts and clean checkouts; no main integration yet. TIFF
17 real public-interface tests independently reran successfully. Board resumed to add
Session insertion using existing depot read/put and bound receipt validation. Drawing
resumed for a sparse-RGBA validation regression/fix found during source review.
See docs/refactor/reviews/2026-10-30/batch3/REVIEW-1.md. Prior green candidate checks do
not certify these new changes or combined integration. Retain all three worktrees;
no cleanup, push or production routing. Session atomic merge adoption remains open.

## Parallel batch 3 dispatched — 2026-10-30

User authorized three new Codex worktree sessions: Board and Drawing on GPT-6.1-Terra,
TIFF Formats on GPT-6.1-Sol, all high reasoning. Shared task baseline 9f45067; all observed
active. Read docs/refactor/batch3/PLAN.md and SESSIONS.md for scope, IDs and paths.
Coordinator remains on main. This supersedes earlier no-new-agents guidance for this
batch only. No implementation delivery accepted yet; no push or production routing.
First slices: Board commands, fill/clear/merge pixel preparation, supported TIFF codec
roundtrip. Main owns UI/Session adoption across lanes and Save/Pending lifecycle integration.
Heavy tests are serialized by the existing shared lock; each lane must report exact SHA,
focused/full/build and real synthetic evidence. Prior G2 verification below remains valid.

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

# Storyboard Flow — remaining verification and product work

This file records remaining scope, not permission to start it. This source integration does not promise that the entire application or all platforms have been accepted.

- Active Hermes refactor: follow `docs/refactor/README.md`, not the historical implementation
  tasks below. Wave 1 delivers isolated cores; full feature integration, actual GUI and Mac/Windows
  performance acceptance follow coordinator review. Keep this historical list on main only.

- 2026-10-29 save/provenance/EPIPE repair: implemented in original and attached source worktrees. Real 31-shot draw/autosave/Save/Undo/Save/normal Close/fresh editable reopen passed, with zero unfinished-operation prompts. Exact restored PNG hash and raw evidence are in the newest context-handoff section. Final suite/build results recorded there. Large retained-project Save/Close preparation remains slow and needs separately measured performance work; do not bypass native/recovery checks to make it faster. Independent acceptance, installed-app packaging and other-platform/filesystem acceptance remain TODO: verify.

- 2026-10-28 editable autosave/original Save: user approved silent healthy Close and explicit Save updating original root images with first backups. Implemented and self-tested: all 355 allowed files / 2541 tests covered across full invocation plus corrected caller-binding rerun, complete build, preload/resources, and actual isolated multi-project GUI (no Save → Close → editable reopen, explicit Save/root updates/exact backup, zero normal Close prompts). True failures remain protected. Details/limits in newest context-handoff.md section. This supersedes earlier unsaved-import Close-refusal and no-original-overwrite-on-Save notes. Independent acceptance and installed-app update remain TODO: verify.

- 2026-10-28 managed child: old-folder conversion now uses `.storyboard-flow/` inside the original folder, no Destination picker; source address/recents remain stable and reopening resolves the editable child. Existing projects and ordinary image/script Import remain in place. Final self-verification: full invocation 352 files / 2535 tests, focused final 10 files / 76 tests (including the newly enumerated recent-handler file), both-typecheck build, preload sync and actual synthetic multi-project Import/draw/Save/Close/reopen passed. All 353 allowed files are covered across the logs. Details are recorded in the newest context-handoff.md section; previous outside-destination notes below are historical. Real user media, installation and independent acceptance remain TODO: verify.

- 2026-10-28 inline Import: old-folder modal removed; source preview is in the main workspace and top-left Import converts into a new folder. Full allowed tests 352 files / 2515 tests and complete build passed. After the startup-probe correction, 11 affected files / 79 tests and a rebuilt actual GUI verified conversion, painting, exact source preservation, dirty-project switching, Save-all → normal Close and fresh-process reopen. The full native suite was not repeated after that last narrow correction. Native chooser remains TODO: verify. An unsaved imported project held in another slot refuses Close until its obligations can be certified; retain this boundary and do not turn it into a successful Close by suppressing the failure. Detailed final lifecycle checks and raw evidence are in context-handoff.md.

- 2026-10-28 simplification/browser: legacy equivalence migration is retired, but old root images remain browsable. Explicit Import creates a new project outside the original folder. Isolated actual GUI browse→Import passed; expanded regression 166 files / 1393 tests passed. TODO: real destination chooser, converted-project drawing/Save/reopen, edited-current-project switching, and a clean full-suite run on final source in an environment permitted to read native memory metrics. Full-run failures and focused reruns are recorded in context-handoff.md. Keep native recovery/permission and Close simplification separate; their responsibilities still protect current projects and have not been proven redundant.

- Independent acceptance of the integrated source and final GitHub delivery follow the existing task/release gates; source self-tests are not independent approval or publication.
- Windows native owner/group/DACL/SACL/audit/integrity restrictions, clean-machine setup and cross-computer usage remain unverified. Safe refusal on unknown policy is not Windows support.
- Actual installers, full Python/vendor portability and real Photoshop, Trash, clipboard and device workflows need separately scoped verification. Packaging source contracts and generated ZIP validator fixtures do not substitute for installing/running a package.
- Add/Paste/drawing/History interactions across project switches, ABA/reload, in-flight preparations and post-write metadata failure need the remaining full application matrix.
- Import lock and shortcut behavior, Pending materialization/restoration, scene inheritance and empty-board dimensions retain their remaining interaction coverage.
- Large-scene marquee/scroll/zoom/pan, drawing transforms/blur, layer gestures, animation/timeline/Onion Skin and mixed aspect ratios need real-user-operation coverage at representative scale.
- Additional external TIFF/Markdown changes, rename/rollback collisions, partial JSON/MD/TIFF/Trash cleanup and actual Save-and-Close failure combinations remain beyond the bounded verified cases.
- Cross-process hostile competition, crashes/power loss, fsync durability, alias/ABA and all hidden-root/legacy/million-record behavior are not universal guarantees.
- The 8GiB recovery budget is a disk policy, not an application RAM ceiling. Broader performance/resource claims require measured evidence.

Built-in AI generation is retired. Ordinary Pending is not retired. PSD-first interchange, full-fidelity Photoshop round-trip, PDF/image-sequence export, SQLite/cloud/collaboration and new AI tooling require new product decisions.

Do not remove failures/recovery namespaces, widen access controls, enable dormant origin features or skip required assertions to complete this list. Preserve prior evidence and authorization boundaries; verify only the affected remaining scope with appropriate independent review.
