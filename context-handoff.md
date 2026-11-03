# Current Storyboard Flow handoff

2026-11-02: [工作室试画反馈、未合入的布局草稿与三个会话收束记录](docs/refactor/STUDIO-FEEDBACK-2026-11-02.md)。

Updated 2026-11-01. Maintain this as a current snapshot; place completed milestone
receipts under docs/refactor/reviews/ instead of prepending another history entry.

## Pre-studio acceptance

Workbench candidate `89213f1` accepts brush input while an explicit TIFF Save publishes
its captured revision. Full build and 393 files / 3006 tests passed. Receipts:
`.hermes/evidence/20261101T054833.416191Z-full/` and `.hermes/bench-prestudio/`.
The [performance and handoff record](docs/refactor/STUDIO-PERFORMANCE.md) includes a
relocated 2K scene, all seven TIFFs in Photoshop, native Chinese composition and mouse
dialogue transfer, three opacity reruns and a textured 1,000-board workload.

## Studio trial

Double-click 打开双面板试画.command to resume the dedicated 2048×1152 example in
`.hermes/studio-preview/project`. Preserve its user edits. Trial tooling on `ae820cf`
passed the complete build and 392 files / 3003 tests. Evidence directories are
`.hermes/evidence/20261101T004041.931715Z-build/` and
`.hermes/evidence/20261101T004112.087456Z-full/`. A separate fixture verified normal
edit/close/reopen and explicit Markdown export of the reopened text. See the
[trial card](docs/refactor/STUDIO-TRIAL.md) and [2K measurements](docs/refactor/STUDIO-PERFORMANCE.md).

Candidate `4b6df30` fixes dropped consecutive strokes during autosave. On the isolated 2K
fixture, the rapid third stroke survived Undo/Redo and all four strokes survived reopen.
Full suite: 392 files / 3004 tests; build passed. Receipts: .hermes/evidence/20261101T013543.967574Z-full/ and
.hermes/evidence/20261101T015701.227625Z-build/. Both adjacent editor GUI smoke checks passed.
Raw GUI results: `.hermes/bench-cadence-final/`. The studio example itself was not edited.

Workbench candidate `43e2736` adds Japanese editable rows, workstation layout preferences
and an interrupted-Trash recovery notice. Complete build passed; full suite passed 392 files / 3004 tests.
Logs: `.hermes/evidence/20261101T031808.635908Z-full/`. A real macOS folder picker selected the isolated sample and opened the workbench (driver in
`.hermes/native-picker-nov01/`). Opening the same isolated profile restores
the view; project content and TIFF output remain separate. Recovery revalidates the
staged original and uses the ordinary Save path. A same-byte copy at the same path
is refused. GUI evidence: `flow-workbench-smoke-mH6ynt` (system temporary directory).
Opacity regression and supported TIFF Refresh passed in `flow-opacity-smoke-FuRgmS`
and `flow-refresh-smoke-9Cop0Q`. Actual Photoshop 2026 external Refresh was refused;
see the [performance and interchange notes](docs/refactor/STUDIO-PERFORMANCE.md).

## Runtime and verified candidate

The new-format editor remains isolated; default App and 启动测试.command are unchanged.
Current candidate `ebc8a2c70cba4a474744c3be0403d0a35171e809` adds an opt-in dual-panel
workbench (`--workbench`): direct grid/viewer drawing with live mirroring, earliest-selected
canvas, single-selection manual arrow flipping, dock/hide/resize panels, and visible-only
raster loading. Full suite: 392 files / 3003 tests; full build passed on the same clean
candidate. Small and 1,000-shot real Electron workbench variants pass 17 checks each;
119 protected classic-editor checks also pass. This is coordinator self-test, not independent
application acceptance. Read [workbench design](docs/refactor/WORKBENCH.md) and
[prototype evidence/limits](docs/refactor/reviews/2026-10-31/G4-WORKBENCH-PROTOTYPE.md).
The fresh open synthetic preview is `.hermes/previews/interaction-6xVMhW/`; preserve any
subsequent user edits. Existing preview/worktrees are untouched.

Prior core/editor milestone (retained behavior and historical evidence):
Implementation `16f42a72a7090f99b15439c599a7a35d3d33252b` supports grid/Japanese editing,
Session history/checkpoints, bounded pixel/layer tools with grid-panel add/delete/group ordering, opacity, blur and lasso selection transforms, logical Pending, explicit TIFF
Save/import-time original backup, TIFF-folder bootstrap, session-bound A/B switching and
ordered TIFF filenames with undoable scene/artist/version settings, and owned TIFF
deletion to system Trash on explicit Save. Undo regenerates deleted TIFFs from retained
assets; original backups survive. Naming changes
checkpoint metadata; explicit Save alone synchronizes names through a resumable journal.
Switching waits for Save/checkpoint; cancellation or failed preparation keeps the prior
Session/history. Reopening restores content, not a previous session's Undo stack.

Prior candidate `16f42a72a7090f99b15439c599a7a35d3d33252b` passes 392 files / 3003 tests
and complete build. It passes 221 connected Electron scenarios (including the corrected opacity
driver precondition), plus mixed-aspect/Undo-isolation/playing-Close checks. Current
renderer-only changes are self-reviewed/tested; full independent application acceptance
and full G3 remain open. The earlier intermittent opacity failure remains recorded for follow-up. Exact scope/logs:
[latest review](docs/refactor/reviews/2026-10-31/G3-PLAYBACK-INSPECTION.md).
Nondurable in-process Trash ACKs block Close/switch. A process loss after OS success
before durable confirmation remains an unknown outcome; no recovery UI is provided yet.
Native picker results are scripted. Windows, installers, representative large rasters,
production frontend rollout and hostile cross-process/crash behavior are not certified.

## Current work

Exported-shot Trash transactions are implemented and verified in the isolated editor.
Manual external TIFF synchronization is complete within the bounded isolated route. The user approved separating external
artwork, Flow drawing and project text, with genuinely conflicting/ambiguous versions
retained in Pending. See [target design](docs/refactor/EXTERNAL-TIFF-SYNC.md).
Manual Refresh is now connected through Main and one Session history operation.
Independent external layers preserve local drawing/text; same-layer conflicts enter
Pending, deduplicated on retry/reopen. Refresh and Undo never write working TIFFs.
Import preserves first originals before project publication. Durable refresh intents
recover failed checkpoint/ledger completion and lost replies; uncertain publication
blocks unrelated work until Refresh retry. Actual RGBA comparison avoids PNG encoding
false conflicts. Prepared/completed ledger budgets are checked before new effects.
Real Photoshop identity preservation and automatic polling remain unverified/unimplemented.
PD2's stack-clearing behavior informs the design; Flow keeps editable internal layers.
User-confirmed project/scene/stb/artist/version/0010 naming is implemented and verified.
The grid LayerPanel now creates transparent layers, deletes unlocked layers and moves
single layers/groups through one Session history action. Newly created layers are selected
only after admission; Undo/Close wait for creation. New-shot white backgrounds are retained.
Group opacity now previews without checkpoint writes and commits all selected unlocked
layers as one undoable action. Cancellation clears the preview. Single/group gestures
cannot overlap pending Session/output work.
Whole-layer Gaussian blur (1–50 px) now applies to the selected visible unlocked layer
as one undoable pixel replacement. Lasso-limited blur and move/scale/rotate are now
connected in grid and Japanese views. Temporary polygons survive transforms without
becoming rectangles; stale async completions cannot clear newer gestures. Each transform
validates its original asset and enters one Session history action. Drag previews no longer
encode PNG on each pointer move. Save alone writes TIFF output. Successful edits clear prior no-effect refusals,
while unresolved operation effects and checkpoint failures remain visible.
Independent scene matte/dialogue settings now drive grid/Japanese canvases and Pending
previews. Expanded matte adds nonpaintable display padding without changing editable image
pixels/dimensions; turning it off never crops originals. Save derives padded content and
locked matte/dialogue TIFF layers. Verified generated layers normalize back to original
coordinates on import/Refresh; externally changed overlays/padding remain intact and are
preserved as an unverified Pending alternative during Refresh. Settings participate in
Session history/checkpoints. Playback/onion skin are now connected through an isolated
Inspect entry from grid/Japanese views. Only the current canvas mounts; paused drawing
uses ordinary Session edits with preview-only adjacent active images. Playback excludes
Pending, waits for image decoding, stops at the last shot, and pauses on load failure or
window blur. Navigation/Close refuses unsettled gestures. Speed and onion settings are
transient. The user now targets a new dual-panel frontend rather than old zoom/timeline parity.
Large-raster memory/performance remains open; the prototype scale check uses small synthetic rasters.
Documentation cleanup on codex/docs-cleanup is complete, reviewed and integrated; its local branch is retained. Root history is archived below. No old runtime/script deletion.

Use [todo](todo.md) for unfinished gates and [documentation index](docs/README.md) for
design pointers. Check live Git/worktree state before editing or cleanup: previous
retirement reports describe their date, not today's inventory. All four remaining secondary worktrees were retired on November 1. Their tips are held by local branches; archived ignored data is in `.hermes/worktree-retirement-20261101/`.

## Historical evidence

The exact former 454-line handoff is preserved in
[the dated snapshot](docs/archive/coordinator/2026-10-31/context-handoff.md).
Its task-specific permissions, old path names and statuses are historical. Source
safeguards remain in [AGENTS.md](AGENTS.md); rationale in [decisions.md](decisions.md).
