# Selection pixel integration — 2026-10-31

Implementation: `de6c23bcd5b985645148a9c55291eb172276de6d`, original main.
Final verification candidate: `4af25f4814fc0497e5ece0d91a8361df4f88d4da` (only the existing Close test fixture changed).
Isolated new-format editor; default App, launcher and retained worktrees unchanged.
No dependency installation, personal media changes or push.

## Behavior

Existing lasso selection, move, corner scale and rotation gestures now submit a bounded
polygon and affine matrix through Session to the pixel-tools module. Renderer preview
PNG is not admitted as final content. The producer rereads the immutable baseline asset,
extracts the selection into a bounded full-image canvas, clears its original pixels and
composites the transformed patch. Session verifies the expected source asset, validates
the output plan, admits its PNG and records one history entry. Undo/Redo restore exact
assets. Selection remains transient, tied to shot/current layer and cleared on tool/layer
changes according to the existing policy; Select → Blur retains it. No disk schema changes.

Blur with a selection replaces pixels only within its clip; without a selection it still
blurs the whole layer. Locked/hidden/missing targets and stale source assets refuse.
Geometry bounds: 3–4096 polygon points, finite coordinates/matrix entries within ±1,000,000,
nonzero bounds and nonsingular matrix. Existing pixel/PNG limits continue to apply.
Temporary producer canvases and bitmaps are released. Working TIFF pixels change only
on explicit Save. Grid and Japanese views share the same flow.

Move/scale retain the actual lasso polygon rather than its enclosing rectangle. Async
preview preparation, result publication and cleanup check the initiating gesture's identity;
Escape or a new gesture cannot be overwritten/cleared by an old completion. Preview
pointer moves draw Canvas without PNG encoding; commit retains the existing callback's
PNG for compatibility, while the new editor uses only the geometry descriptor.

## Review

Scoped independent read-only review identified lost lasso shape and stale async cleanup/
preparation ownership. Both were fixed; follow-up review found no new issue. Reviewer
ran no tests and did not independently accept GUI, performance or platform behavior.

## Verification

Implementation build: `.hermes/evidence/20261031T102509.578922Z-build/`, exit 0, 9.731 s.
Final candidate build: `.hermes/evidence/20261031T110105.336430Z-build/`, exit 0.
Initial full run: `.hermes/evidence/20261031T102614.813627Z-full/`, 2995 passed / 1 failed.
The AST-executed Close callback fixture lacked the newly used gesture refs. Updated the
fixture only, preserving its no-publication assertions and adding proof the callback ran.
Focused Close + geometry rerun: 9 tests passed, `/tmp/flow-selection-close-focused.log`.
Final complete suite: `.hermes/evidence/20261031T110224.133284Z-full/`, 391 files / 2996 tests, exit 0, 1240.086 s.
Development focused check: 99 tests / 3 files, `/tmp/flow-selection-focused3.log`.
Real Canvas: 17 cases, `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-pixel-canvas-7uKnhY/`.

| GUI check | Cases | Evidence |
| --- | --- | --- |
| selection | 23 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-selection-smoke-cm5VHs/receipt.json` |
| selection-japanese | 23 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-selection-smoke-4KCnwI/receipt.json` |
| blur | 17 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-blur-smoke-6oOLGV/receipt.json` |
| opacity | 26 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-opacity-smoke-w8eKbl/receipt.json` |
| import | 13 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-import-smoke-fLQz9f/receipt.json` |
| editor | 42 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-NX7ndm/receipt.json` |
| switch | 9 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-switch-smoke-p3aGNg/receipt.json` |
| trash | 10 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-trash-smoke-yAp8Dh/receipt.json` |
| refresh | 13 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-refresh-smoke-iuR75V/receipt.json` |

All 176 GUI cases passed on the clean implementation candidate de6c23b. Runtime files
are byte-identical at 4af25f4; GUI/Canvas were not redundantly rerun for the test-only change. Only the Trash check sends one identity-checked run-owned synthetic TIFF to system Trash. Personal Trash is never enumerated; synthetic evidence is retained.

GUI checks include actual lasso/move/scale/rotation pointer input, one revision per
transform, exact Undo/Redo, selected-blur outside-region byte comparison, Escape cancel,
real asset IPC response delay while a new transform is active, TIFF Save and relocated
fresh-process reopen. Native picker choices are scripted. Canvas checks independently
assert moved/rotated/scaled pixels, cleared original pixels, selection-limited blur,
parameter capture across await and resource release; they are not performance benchmarks.

Early development reopen check used the old fixed eraser location after moving the art;
it correctly produced no pixel change there. The test now targets a real nontransparent
pixel in its synthetic PNG. Japanese outside-region checking uses the actual drawn lasso
boundary to account for screen-coordinate rounding, not an assumed exact half-width.

## Limits

No new rectangular-selector UI, saved selections, feathering, perspective/free transform,
PSD workflow, automatic external polling, presentation masks or playback was added.
Windows, native IME/pickers, real Photoshop, large rasters and installers remain open.
Synthetic self-tests and scoped review do not constitute full application acceptance.
