# Remaining Storyboard Flow work

Updated 2026-11-01. This list is scope, not fresh permission. Current implemented state
and evidence belong in [context-handoff.md](context-handoff.md).

## Current output integration

- Workbench now identifies interrupted Trash operations by filename, rechecks restored
  originals and allows a verified retry. Native Trash restore by a human on Windows/macOS
  remains a platform check; preserve unresolved evidence if the original cannot be found.
- External TIFF manual Refresh is connected and has checkpoint/Undo/conflict/retry
  evidence (see current handoff). Photoshop 2026 writes unsupported image resources (tag 34377) even for simple raster layers; see STUDIO-PERFORMANCE.md. The approved first step preserves the Photoshop original and publishes a separately named Flow working TIFF. The workbench creates an independent composite-plus-ink project from a selected single-page 8-bit RGB TIFF. Its editable output was reopened in Photoshop 2026. Tracking subsequent changes to the original PS document remains future work. Remaining work also includes
  representative large-project resource measurements, and a separately designed automatic
  observation schedule. External rename/relink/new-file discovery remain separate work.
- Explicit Markdown export from a saved checkpoint is available through the trial CLI.
  Decide its UI placement after studio feedback. No import or external
  Markdown autosync; any future AI editing interface needs its own design.

## Remaining interaction and rollout gates

- Grid layer add/delete/single/group ordering, group opacity, whole-layer/selection blur
  and lasso move/scale/rotate plus independent matte/dialogue-overlay presentation are
  connected. Inspection playback/onion skin are connected with bounded GUI evidence.
  The user now targets the new dual-panel workbench instead of old zoom/timeline parity.
- Review the working prototype with the user. Japanese rows and workstation layout preferences are connected. Review remaining
  presentation/tool controls and refine dock/resize/keyboard/pen interactions. Keep the `--workbench` route isolated until acceptance. The classic
  Workspace shortcut currently resets to classic on project switch; polish that if retained.
- Rapid consecutive brush strokes now survive the 100-ms autosave test and normal reopen.
  400-board navigation, full-grid scroll/idle and checkpoint measurements are recorded. Next verify sustained stylus input and realistic artwork on target hardware.
  See docs/refactor/STUDIO-PERFORMANCE.md.
  The 1,000-shot 640×360 fixture passes bounded loading/interaction checks (~3.4s opening),
  but all lightweight card DOM remains and the 96-entry URL cache is not a byte budget.
- Follow up the intermittent opacity GUI failure during group re-selection after panel
  reopen; unchanged-script retry and the final driver with an explicit group-selected
  wait passed. The original cause remains unproven; see the latest inspection review.
- The real macOS Open button returned the expected synthetic folder and opened the workbench.
  macOS Doubao Pinyin composition arrows and native mouse dialogue transfer/Undo passed in synthetic projects. Verify other platforms/input methods, protected adjacent operations and
  representative marquee/zoom/pan/layer gestures in the real application.
- Production entry integration and independent acceptance follow bounded G2/G3
  evidence; isolated editor self-tests do not certify the default App.
- Measure 1,000-image/large-raster workloads on the reference 32-GB M1 Mac, then
  Windows/other-machine filesystems and real installers/Python resources.
- Preserve recoveries and the 8-GiB disk policy. Do not weaken native checks or
  rename failed/unknown effects as successful Save to close a gate.

## Repository cleanup

- Keep documentation entry/current handoff/task list concise; preserve historical
  evidence separately. See [cleanup inventory](docs/maintenance/CLEANUP-REVIEW.md).
- Four old worktrees have been retired. Branches and ignored evidence were preserved locally. No older worktree deletion is authorized merely by this list.
- Delete superseded runtime/scripts only after caller/coverage comparison and the
  replacement's acceptance; ignored build/dependency/evidence folders are not junk.

PSD-first/full Photoshop round-trip, SQLite, audio/timing expansion, PDF export,
cloud/collaboration and built-in AI are outside current scope. No push/publication.
Exact former todo history: [dated snapshot](docs/archive/coordinator/2026-10-31/todo.md).
