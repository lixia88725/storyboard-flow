# Remaining Storyboard Flow work

Updated 2026-10-31. This list is scope, not fresh permission. Current implemented state
and evidence belong in [context-handoff.md](context-handoff.md).

## Current output integration

- Add explicit recovery UX for unknown Trash outcomes after process loss. Current
  protocol retains evidence and refuses a guessed successful Save; normal failure/retry,
  backups, Undo regeneration and connected system Trash are verified.
- External TIFF manual Refresh is connected and has checkpoint/Undo/conflict/retry
  evidence (see current handoff). Remaining: real Photoshop identity/roundtrip checks,
  representative large-project resource measurements, and a separately designed automatic
  observation schedule. External rename/relink/new-file discovery remain separate work.
- Implement explicit Markdown export only for the new frontend. No import or external
  Markdown autosync; any future AI editing interface needs its own design.

## Remaining interaction and rollout gates

- Grid layer add/delete/single/group ordering, group opacity, whole-layer/selection blur
  and lasso move/scale/rotate plus independent matte/dialogue-overlay presentation are
  connected. Inspection playback/onion skin are connected with bounded GUI evidence.
  The user now targets the new dual-panel workbench instead of old zoom/timeline parity.
- Review the working prototype with the user. Add new-workbench Japanese layout and
  remaining presentation/tool controls; refine dock/resize/keyboard/pen interactions and
  layout persistence. Keep the `--workbench` route isolated until acceptance. The classic
  Workspace shortcut currently resets to classic on project switch; polish that if retained.
- Develop representative large-raster/decoded-memory benchmarks and thumbnail/cache policy.
  The 1,000-shot 640×360 fixture passes bounded loading/interaction checks (~3.4s opening),
  but all lightweight card DOM remains and the 96-entry URL cache is not a byte budget.
- Follow up the intermittent opacity GUI failure during group re-selection after panel
  reopen; unchanged-script retry and the final driver with an explicit group-selected
  wait passed. The original cause remains unproven; see the latest inspection review.
- Verify OS IME, native picker/dialogue drag, protected adjacent operations and
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
- Audit unique commits, uncommitted work and retained evidence before retiring old
  worktrees. No older worktree deletion is authorized merely by this list.
- Delete superseded runtime/scripts only after caller/coverage comparison and the
  replacement's acceptance; ignored build/dependency/evidence folders are not junk.

PSD-first/full Photoshop round-trip, SQLite, audio/timing expansion, PDF export,
cloud/collaboration and built-in AI are outside current scope. No push/publication.
Exact former todo history: [dated snapshot](docs/archive/coordinator/2026-10-31/todo.md).
