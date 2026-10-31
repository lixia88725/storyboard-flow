# Current Storyboard Flow handoff

Updated 2026-10-31. Maintain this as a current snapshot; place completed milestone
receipts under docs/refactor/reviews/ instead of prepending another history entry.

## Runtime and verified candidate

The new-format editor remains isolated; default App and 启动测试.command are unchanged.
Implementation `16f42a72a7090f99b15439c599a7a35d3d33252b` supports grid/Japanese editing,
Session history/checkpoints, bounded pixel/layer tools with grid-panel add/delete/group ordering, opacity, blur and lasso selection transforms, logical Pending, explicit TIFF
Save/import-time original backup, TIFF-folder bootstrap, session-bound A/B switching and
ordered TIFF filenames with undoable scene/artist/version settings, and owned TIFF
deletion to system Trash on explicit Save. Undo regenerates deleted TIFFs from retained
assets; original backups survive. Naming changes
checkpoint metadata; explicit Save alone synchronizes names through a resumable journal.
Switching waits for Save/checkpoint; cancellation or failed preparation keeps the prior
Session/history. Reopening restores content, not a previous session's Undo stack.

Final candidate `16f42a72a7090f99b15439c599a7a35d3d33252b` passes 392 files / 3003 tests
and complete build. It passes 221 connected Electron scenarios (including the corrected opacity
driver precondition), plus mixed-aspect/Undo-isolation/playing-Close checks. Current
renderer-only changes are self-reviewed/tested; full independent application acceptance
and full G3 remain open. The earlier intermittent opacity failure remains recorded for follow-up. Exact scope/logs:
[latest review](docs/refactor/reviews/2026-10-31/G3-PLAYBACK-INSPECTION.md).
Nondurable in-process Trash ACKs block Close/switch. A process loss after OS success
before durable confirmation remains an unknown outcome; no recovery UI is provided yet.
Native picker results are scripted. Windows, installers, representative large rasters,
full production-shell parity and hostile cross-process/crash behavior are not certified.

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
transient. Production zoom/timeline parity and large-project memory/performance remain open.
Documentation cleanup on codex/docs-cleanup is complete, reviewed and integrated; its
clean worktree/branch are retained. Root history is archived below. No old runtime/script deletion.

Use [todo](todo.md) for unfinished gates and [documentation index](docs/README.md) for
design pointers. Check live Git/worktree state before editing or cleanup: previous
retirement reports describe their date, not today's inventory. Three older checkouts
remain retained; their unique work must be audited before any retirement.

## Historical evidence

The exact former 454-line handoff is preserved in
[the dated snapshot](docs/archive/coordinator/2026-10-31/context-handoff.md).
Its task-specific permissions, old path names and statuses are historical. Source
safeguards remain in [AGENTS.md](AGENTS.md); rationale in [decisions.md](decisions.md).
