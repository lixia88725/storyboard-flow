# Whole-layer blur integration — 2026-10-31

Candidate: `ab59423ca1d46ae5d4000dd6d40eb21c2914efdd`, original main. Isolated new-format editor only; default App,
launcher, dependencies and retained worktrees unchanged. No push.

## Behavior

Blur applies a 1–50 px Gaussian filter to the selected visible, unlocked whole layer.
Radius and image input are captured before asynchronous reads. Canvas output replaces
the original pixels rather than compositing onto their sharp core. One successful Apply
produces one Session revision/history entry; Undo restores the exact previous asset.
Other layers, opacity, blend mode and project text remain unchanged. Internal checkpoint
stores the new asset; only explicit Save writes working TIFFs. Temporary canvases and
decoded bitmaps are released on completion/failure. This is not lasso-limited blur.

Successful edits dismiss prior no-effect operation refusals. Checkpoint errors and
unresolved operation effects remain visible. Independent review identified an unknown
asset effect being overwritten by a later ordinary refusal; remember now preserves the
unresolved effect and a three-step regression covers failure → refusal → successful edit.
Follow-up scoped review found that issue resolved. Reviewer did not run tests or accept GUI.

## Verification

Final complete build: `.hermes/evidence/20261031T093933.214991Z-build/`, exit 0.
Final complete suite: `.hermes/evidence/20261031T094013.839404Z-full/` 390 files / 2991 tests, exit 0, 1284.635 s.
Development focused checks: 94 tests / 2 files, `/tmp/flow-blur-focused-final.log`.
Real Canvas: 13 cases, `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-pixel-canvas-5FyxaG/`.
Canvas checks measure alpha spread/core reduction, captured radius despite caller mutation,
replacement plan and resource release. GUI confirms lock refusal, retry message clearing,
one revision, unchanged other layers/source TIFF before Save, Undo/Redo, Save and relocated reopen.
Coordinator inspected the final blur screenshot; no independent visual acceptance claimed.

| GUI check | Cases | Evidence |
| --- | --- | --- |
| blur | 17 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-blur-smoke-INJHoj/receipt.json` |
| opacity | 26 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-opacity-smoke-C6XeEF/receipt.json` |
| import | 13 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-import-smoke-lpEYbY/receipt.json` |
| editor | 42 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-ASpPWQ/receipt.json` |
| switch | 9 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-switch-smoke-HeAWkO/receipt.json` |
| trash | 10 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-trash-smoke-0aFJNn/receipt.json` |
| refresh | 13 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-refresh-smoke-EUOwlh/receipt.json` |

All 130 connected cases passed on the clean candidate. Picker choices are scripted.
Only the Trash test sends one identity-checked run-owned TIFF to system Trash; personal
Trash is never enumerated. Synthetic evidence remains retained. Complete suite and build receipts both identify the same clean unchanged candidate.

## Limits

Selection-limited blur and selection transforms remain open. No live blur preview;
Apply creates the effect. Japanese-view blur-specific interaction, Windows, large-raster
performance, Photoshop roundtrip, native picker/IME and installers remain unverified.
The existing full production shell remains outside this isolated route. Synthetic tests
and scoped review do not establish full independent application acceptance.
The initial sandbox GUI launch failed before the permitted GUI rerun; it is not PASS evidence.
