# Current Storyboard Flow handoff

Updated 2026-10-31. Maintain this as a current snapshot; place completed milestone
receipts under docs/refactor/reviews/ instead of prepending another history entry.

## Runtime and verified candidate

The new-format editor remains isolated; default App and 启动测试.command are unchanged.
Implementation `bba2bb51da35bbce73d1534b2b8c6000490ce7da` supports grid/Japanese editing,
Session history/checkpoints, bounded pixel/layer tools, logical Pending, explicit TIFF
Save/first-original backup, TIFF-folder bootstrap, session-bound A/B switching and
ordered TIFF filenames with undoable scene/artist/version settings. Naming changes
checkpoint metadata; explicit Save alone synchronizes names through a resumable journal.
Switching waits for Save/checkpoint; cancellation or failed preparation keeps the prior
Session/history. Reopening restores content, not a previous session's Undo stack.

That clean unchanged candidate passes 386 files / 2922 tests, complete build and 64
real Electron scenarios. Naming received scoped independent code review and corrections; full application
independent acceptance and full G3 remain open. Exact logs and scope: [latest review](docs/refactor/reviews/2026-10-31/G3-SAVE-NAMING.md).
Native picker results are scripted. Windows, installers, representative large rasters,
full production-shell parity and hostile cross-process/crash behavior are not certified.

## Current work

Next coordinator slice is exported-shot Trash transactions on explicit Save.
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
