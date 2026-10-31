# Current Storyboard Flow handoff

Updated 2026-10-31. Maintain this as a current snapshot; place completed milestone
receipts under docs/refactor/reviews/ instead of prepending another history entry.

## Runtime and verified candidate

The new-format editor remains isolated; default App and 启动测试.command are unchanged.
Implementation `8385b1f1afc391c2e56e57c21d65bc7f58fa1ac1` supports grid/Japanese editing,
Session history/checkpoints, bounded pixel/layer tools, logical Pending, explicit TIFF
Save/first-original backup, TIFF-folder bootstrap, session-bound A/B switching and
ordered TIFF filenames with undoable scene/artist/version settings, and owned TIFF
deletion to system Trash on explicit Save. Undo regenerates deleted TIFFs from retained
assets; original backups survive. Naming changes
checkpoint metadata; explicit Save alone synchronizes names through a resumable journal.
Switching waits for Save/checkpoint; cancellation or failed preparation keeps the prior
Session/history. Reopening restores content, not a previous session's Undo stack.

That clean unchanged candidate passes 387 files / 2939 tests, complete build and 74
real Electron scenarios. Naming and Trash received scoped independent code review and
corrections; full application independent acceptance and full G3 remain open. Exact
logs and scope: [latest review](docs/refactor/reviews/2026-10-31/G3-OUTPUT-TRASH.md).
Nondurable in-process Trash ACKs block Close/switch. A process loss after OS success
before durable confirmation remains an unknown outcome; no recovery UI is provided yet.
Native picker results are scripted. Windows, installers, representative large rasters,
full production-shell parity and hostile cross-process/crash behavior are not certified.

## Current work

Exported-shot Trash transactions are implemented and verified in the isolated editor.
Current slice is external TIFF synchronization. The user approved separating external
artwork, Flow drawing and project text, with genuinely conflicting/ambiguous versions
retained in Pending. See [target design](docs/refactor/EXTERNAL-TIFF-SYNC.md).
The synchronization foundation now includes read-only observation, a pure three-way
image planner and TIFF rasterVersion 2/native layer IDs. Development focused tests and
build passed; candidate full/connected gates are pending. Automatic adoption is not
connected. Before enabling it, bind image-only baselines, source preservation and one
Session history/checkpoint transaction. PD2's stack-clearing behavior informs the design;
Flow retains editable layers and maps exported identities once instead of clearing them.
User-confirmed project/scene/stb/artist/version/0010 naming is implemented and verified.
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
