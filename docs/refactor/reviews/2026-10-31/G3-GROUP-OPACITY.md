# Group opacity integration — 2026-10-31

Candidate: `455ee0e0b7b719e95c601ae7c36789723a1770b4`, original main. Scoped isolated-editor integration;
no default routing, launcher change, dependency install, worktree retirement or push.

## Behavior

Multi-selected unlocked layers preserve their individual starting opacities and receive
one relative horizontal-drag delta, clamped to 0–1 and rounded to 0.001. Locked members
are excluded by the existing panel selection policy. During dragging only presentation
previews change; no Project/checkpoint is published. Pointer release installs one atomic
Drawing result through Session, yielding one revision and one Undo/Redo entry.

Drawing validates every layer, expected previous opacity, requested value and lock before
publishing any change. Stale/missing/invalid members refuse the whole action. Unchanged
members/no-op edits need no revision increment. Pointer cancellation and closing/unmounting
the group panel clear previews without project changes. Save/Close and unrelated editor
requests refuse while the opacity gesture remains unsettled.

The existing production panel callback remains the fallback when the new optional group
callback is absent. No production routing was changed. New gesture callbacks and the
synchronous admission gate are supplied only by the isolated editor.

## Review

Independent read-only review found that an older asynchronous commit's cleanup could
clear a newer preview and its Close guard. A shared synchronous begin-gesture gate now
blocks single/group gestures while an earlier gesture, Session request or output operation
is pending. The guard remains occupied through commit settlement; follow-up review found
no remaining issue in the scoped fix. The reviewer ran no tests and did not independently
accept GUI/platform behavior.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Complete allowed suite | 390 files / 2986 tests, exit 0, 1264.845 s | `.hermes/evidence/20261031T085327.695693Z-full/` |
| Complete build | exit 0, 9.788 s, both typechecks and Vite | `.hermes/evidence/20261031T085216.369280Z-build/` |
| Group opacity workflow | 26 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-opacity-smoke-jj5bhG/receipt.json` |
| TIFF import | 13 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-import-smoke-X0mUGB/receipt.json` |
| Existing editor | 42 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-kfF6nP/receipt.json` |
| Naming/switch | 9 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-switch-smoke-vUDZtu/receipt.json` |
| System Trash | 10 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-trash-smoke-ZuRWKh/receipt.json` |
| External refresh | 13 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-refresh-smoke-bEcNpF/receipt.json` |

All 113 connected cases identify the same clean candidate. Picker selections are scripted;
real pointer input, Canvas, Session, preload/IPC, codec and filesystem are connected.
The coordinator inspected the group opacity screenshot; no independent visual acceptance is claimed.
Only the Trash regression dispatches one identity-checked, run-owned synthetic TIFF to
system Trash. It remains there intentionally; personal Trash is never enumerated.
Evidence directories are retained.

Development focused check: 129 tests / 4 files pass in `/tmp/flow-opacity-focused.log`.
Real GUI tests use multi-select pointer input, multiple horizontal moves, an 800-ms
preview hold with exact unchanged checkpoint, pointer cancellation, panel-close cancel,
locked-member exclusion, one Undo/Redo, TIFF opacity values and relocated reopen.
A real IPC asset response is delayed to verify that pending new-layer admission blocks
a new opacity gesture. Pointer-cancel itself is dispatched synthetically by the driver.

## Limits

This covers grid LayerPanel group opacity and nearby existing workflows. No new Japanese
layer panel, blur/selection transforms, mask/dialogue presentation or playback was added.
Default production App, native IME/picker/group interaction on other platforms, Photoshop
roundtrip, automatic monitoring, large-project performance and installers remain separate
gates. Synthetic self-tests and scoped code review do not establish full independent
application acceptance. Evidence roots remain retained.
