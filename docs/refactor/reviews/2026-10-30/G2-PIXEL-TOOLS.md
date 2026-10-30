# G2 queued pixel tools and shot deletion — 2026-10-30

Implementation candidate: 0a09ea605c99b9c83a1dc086660236c649104f8a.
Status: bounded implementation and self-tests complete; full allowed suite passed.
No independent acceptance, production routing or publication claimed.

Session now owns queued fill, clear and bounded merge. It snapshots the request,
computes the permitted plan from the captured image, validates the producer's baseline
and plan, admits PNG through the actual asset depot and validates the bound receipt.
Only then does it publish one image revision and one project history entry. Merge's
pixel replacement, source removal and compositing reset remain private until complete.
Text during pixel production remains a separate history entry; Undo/freeze wait for
production/admission to settle. Invalid output and failed admission do not install state.

The isolated editor connects SketchPad color drops in grid and Japanese views, a
clear-current-layer button, existing LayerPanel merge controls, and single-shot deletion.
Selection falls back to an existing layer after a merge. The new optional LayerPanel
merge capability defaults to prior structural-edit behavior for existing callers.
Default App/launcher/production Save, new layer creation and multi-selection controls
remain unchanged. The editor is still a bounded verification host, not the full product.

Evidence:
- Focused development: 7 files / 170 tests, including forged baseline/plan/dimensions,
  sparse colors, locked merge, failed admission, input mutation, text/Undo/freeze and
  one-step merge Undo/Redo. Log: .hermes/editor-tools/focused-development.log.
- Complete frozen build: exit 0, 9.715 seconds; both typechecks included.
  .hermes/evidence/20261030T142006.248586Z-build/ (clean unchanged HEAD).
- Full allowed suite: 381 files / 2879 tests passed, exit 0, 1188.412 seconds;
  .hermes/evidence/20261030T142040.612237Z-full/. Candidate unchanged and clean
  before/after, no failed or skipped tests.
- Real isolated two-process Electron GUI: scripts/flow-editor-smoke.mjs, 22 cases pass
  on frozen clean candidate; both processes exited 0 through normal Close.
  /private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-lKV4fc/receipt.json.
  Preserves prior pointer drawing/eraser, real reorder, opacity, Chinese dialogue,
  Japanese/grid switching, checkpoint and Close/fresh-reopen cases. New checks verify
  fill and clear exact Undo, merge one image revision/one Undo, deletion retaining
  assets/Undo, and Japanese fill checkpoint plus fresh editable reopen. Fill uses
  an actual DOM DataTransfer/drop event, not an OS-level drag; Canvas execution is real.
  Screenshots inspected; raw snapshots/screenshots/owned synthetic projects retained.
  Initial passing development run retained at flow-editor-smoke-yINTSZ under the same temp parent.

Limits and next work:
- Merge supports contiguous visible unlocked layers; non-normal blends require the
  bottom of the stack. Hidden gaps, locked-source merge-visible and unsupported cases
  return an explicit failure. Do not claim complete legacy merge parity.
- Remaining Board insertion/multi-selection/dialogue drag UI and layer structural tools
  remain open, as do blur and selection transforms.
- TIFF explicit Save/first backup/source binding and Pending lifecycle are separate
  subsequent gates; this change only writes internal checkpoints through existing paths.
- No personal media, dependencies, new worktrees, push or old-code deletion. Existing
  three batch-3 worktrees remain intact. Windows, scale and installer acceptance untested.
