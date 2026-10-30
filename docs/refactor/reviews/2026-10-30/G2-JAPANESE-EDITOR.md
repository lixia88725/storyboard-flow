# G2 Japanese storyboard and dialogue — 2026-10-30

Candidate: `4c8cd8a1e7de0a0ae47f3a7e946244aa01f1ab83`, original main only.
Status: implemented and self-tested; not independent acceptance or publication.
No new worktrees, agents, dependencies, personal media, default routing changes or push.

## Behavior

The isolated new-format editor now mounts the existing JapaneseStoryboardView alongside
its verification grid. Both read one Session project and use the same command/history,
pixel producer, immutable assets, checkpoint and Close chain. Presentation mode and
layer selection remain transient. The old Project shape is a read-only projection;
no second writable project or two-way state synchronization was added.

Session admits shot-scoped setDialogues through the existing Board implementation.
Dialogue records remain independently validated for identity/binding/collisions. Active
shots only; Pending edits are refused. Metadata edits may complete during pixel work
without overwriting them when paint finishes, but cannot overtake queued Undo/freeze.
Existing multiline normalization and stable-ID behavior is reused in the adapter.
Both grid and sheet display/edit dialogue; sheet uses existing action text and Cut handles.
An unfinished stroke, opacity gesture or pending Session request prevents a view switch.

## Verification

Focused: 2 files / 49 tests, including copied caller input, concurrent painting plus
Chinese dialogue, independent Undo/Redo, preserved other-shot dialogue, parked/foreign/
colliding IDs, and ordering behind Undo. Log: `.hermes/g2-japanese/focused.log`.

Build on clean unchanged candidate: exit 0, 11.657 seconds, both typechecks included.
Raw receipt/log: `.hermes/evidence/20261030T073039.897177Z-build/`.

Real two-process Electron GUI on clean candidate: both processes exited 0 via normal
certified Close. The prior 11 cases remain; additionally verified shared script/order,
Japanese Cut drag and Undo, revision-neutral view switching, Chinese multiline dialogue
Undo/Redo, Japanese pointer paint/exact Undo, refusal to switch during a stroke, dialogue
visible in grid and Japanese view after fresh-process reopen. Screenshot inspected.
Receipt/logs/screenshot: `.hermes/g2-japanese/final-gui/`. Synthetic project and full raw
outputs: `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-uu2ZwI/`.
The receipt lists 17 cases; the additional Cut drag assertion is in the executable harness.

Initial Cut drag smoke failed because separate scrollIntoView calls invalidated the
first captured rectangle. Harness now measures both handles in one viewport snapshot;
assertion retained and passing. Failed evidence retained at temporary root
`flow-editor-smoke-xcYUPl`; no product workaround or weakened assertion.

Full allowed suite: **379 files / 2833 tests passed**, exit 0, 1410.633 seconds.
Clean identical HEAD before/after; raw receipt/log in `.hermes/evidence/20261030T073140.888744Z-full/`.

## Remaining scope

This is self-verified isolated G2 wiring, not independent acceptance of complete G2.
Default App/launcher and production Save/Close remain unchanged. Pending materialization,
TIFF output, multi-project lifecycle, full production shell, multiline typing/IME feel,
cross-shot dialogue dragging, full selection/zoom/navigation and remaining drawing tools
are not certified by this batch. Multiline insertion was tested; OS IME composition was not.
No Windows/installer/large-project performance claim. Eager asset caching remains the
known limitation described in G2-FIRST-EDITOR.md. Undo remains session-local.
