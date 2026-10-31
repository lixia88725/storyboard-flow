# Structural layer integration — 2026-10-31

Candidate: `e9cdd3ff12941e0982fd9d0b8658656ab4d877f3`, original main.
Scoped isolated-editor implementation only. No default-route/launcher change, push,
dependencies, personal-media access or worktree retirement.

## Implemented

The existing grid LayerPanel now adds a transparent drawing layer above the current
layer, selects it after successful admission, deletes unlocked layers while retaining
at least one, and moves individual/selected groups through Drawing and Session.
Group ordering preserves the image's bottom-to-top order, not selection click order;
actual moves containing locked layers refuse atomically. One group move is one image
revision and one project history action. UI selection remains transient.

New layers use the same bounded PNG production/admission path as blank shots, with an
explicit background: shots default to white; new layers request transparent. The Session
validates destination/anchor/limits before producing pixels, verifies the asset receipt
before publication and serializes Undo/Close behind the operation. Failure leaves the
project/history unchanged; already admitted assets are retained. No renderer file writes.
Existing TIFF Save/checkpoint/Undo/reopen behavior is reused.

## Review and development corrections

Independent read-only review covered Drawing order/locks, Session queue/asset admission,
blank allocation and UI selection; no blocking findings. The reviewer ran no tests and
did not certify GUI or platforms. Real GUI pixel assertions caught the initial reuse of
white blank-shot pixels for new layers; the explicit background contract fixed it.
The driver initially targeted a text input rather than a draggable row surface; its
coordinate selection was corrected without changing LayerPanel gesture behavior.
A Session test initially used identical bytes for blank and paint, causing a legitimate
no-op; distinct bytes now exercise the intended history transitions.

## Fixed-candidate verification

| Check | Result | Evidence |
| --- | --- | --- |
| Complete allowed suite | 390 files / 2982 tests, exit 0, 1270.731 s | `.hermes/evidence/20261031T081614.403137Z-full/` |
| Complete build | exit 0, 9.792 s, both typechecks and Vite | `.hermes/evidence/20261031T081525.031475Z-build/` |
| New layer workflow | 18 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-layers-smoke-ZQBqq3/receipt.json` |
| TIFF import | 13 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-import-smoke-8ZqkyQ/receipt.json` |
| Existing editor | 42 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-487vhj/receipt.json` |
| Naming/switch | 9 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-switch-smoke-46OlRJ/receipt.json` |
| System Trash | 10 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-trash-smoke-AvrZrY/receipt.json` |
| External refresh | 13 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-refresh-smoke-XUyhZv/receipt.json` |

All 105 connected cases identify the same clean candidate. Picker selections are scripted;
real pointer input, Canvas, Session, preload/IPC, codec and filesystem are connected.
The coordinator inspected the layer screenshot; no independent visual acceptance is claimed.
Only the Trash regression dispatches one identity-checked, run-owned synthetic TIFF to
system Trash. It remains there intentionally; personal Trash is never enumerated.
Evidence directories are retained.

Development focused run: 185 tests / 6 files passed in `/tmp/flow-layers-focused3.log`.
Actual GUI checks add/paint/Delete/Undo, pointer reorder/one Undo, TIFF alpha/color bytes,
Save/Undo/Redo, whole-folder relocation, fresh-process eraser/Undo and normal Close.
Core tests additionally cover group ordering, locked/missing/duplicate/sparse selection,
revision exhaustion, rejected insertion, failed asset production and queued Undo/Freeze.

## Limits

This connects the existing grid panel; no new Japanese-view layer panel was added.
Multi-selection ordering has core/Session tests; native multi-select group dragging is
not independently GUI-certified. Group opacity editing, blur/selection transforms,
mask/dialogue overlays, playback/onion skin, OS IME and full production-shell parity
remain separate gates. Photoshop roundtrip, auto-sync, 1,000-image/large-raster behavior,
Windows and installers remain unverified. Scoped code review and synthetic self-tests
do not establish full application independent acceptance.
