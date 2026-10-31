# TIFF folder bootstrap and editor loop — 2026-10-31

Candidate: 20259602f1db4a4d117d3334f36a198b78b9f8ad (original main).
Bounded isolated-entry implementation/self-testing; independent acceptance remains open.
Full G3 is not complete: live A/B switching acceptance remains a separate gate.

## Behavior

Main's dedicated entry now supports --choose (native folder dialog) or an absolute root.
Existing .storyboard-flow data goes through strict project loading; it never triggers a
fallback import or format migration. A folder without project data goes through the new
bootstrap. Cancel leaves the folder unchanged. Opening status is shown during preparation;
Close waits for preparation to settle. Normal production App and launcher are untouched.

Bootstrap reads supported root/Pending TIFFs in natural order and preserves source bytes.
It allocates a fresh project and fresh shot/image/dialogue identities, preserving supported
layer properties, script and dialogue content. Duplicated portable identities are not merged.
Image bytes go through the real codec and depot receipts. Source bindings and checkpoint
are prepared in private derived staging, loaded there, then sources/catalog are rechecked.
A native no-replace directory rename publishes the whole namespace. Even a newly appearing
empty directory is protected. No copy/overwrite fallback or new dependency installation.
Original TIFF backups remain an explicit-Save responsibility.

Derived staging is cleaned only while root/stage identities still match. Abrupt crash or
identity/cleanup uncertainty can retain staging; no automatic stale-stage purge/resume claim.
Publication/flush/readback failure reports failure even if the namespace has appeared.
Existing project folders are never removed. A subsequent explicit open loads them strictly.

An actual startup race was fixed: a fast initial checkpoint could finish between React render
and effect subscription, leaving UI status stale. After subscribing, the editor now refreshes
from the authoritative Session snapshot. No second project owner or altered saved semantics.

## Verification

- Development focused: 2 files / 19 tests (8 new bootstrap tests + 11 TIFF Save tests), pass;
  /private/tmp/flow-import-focused3.log. Covers plain/layered/Pending/natural ordering,
  Unicode and exact decoded pixels, collision remapping, source preservation/first Save,
  invalid TIFF cleanup, existing project refusal, source mutation, empty/nonempty publication
  collisions, simultaneous bootstrap attempts, symlinks and duplicate filenames.
- Final complete build: .hermes/evidence/20261031T013816.949442Z-build/, exit 0.
- Full allowed suite: 384 files / 2906 tests passed, no failures/skips, exit 0,
  1171.924 seconds; .hermes/evidence/20261031T013846.898427Z-full/.
  Full/build receipts record clean unchanged 2025960 before/after.
- New import Electron harness: scripts/flow-import-smoke.mjs, 13 cases, receipt at
  /private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-import-smoke-qAY7zF/receipt.json.
  Starts with TIFFs only; native chooser result/cancel are scripted, not the importer.
  Actual pointer painting, script editing, Save/Undo/Save/Redo, byte-exact original backup,
  decoded TIFF pixels, normal Close, whole-folder relocation with old root path unavailable,
  fresh-process editable reopen/eraser/Undo/Save, and imported Pending are checked.
  This is same-machine relocation evidence, not Windows/cross-machine/installer acceptance.
- Existing editor Electron harness: scripts/flow-editor-smoke.mjs passed;
  /private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-whsSPP/receipt.json, 42 cases.
- All final receipts refer to clean unchanged 2025960. Raw logs/screenshots retained; imported-project reopen screenshot visually inspected.
  Native chooser visual interaction itself is not tested; the returned user selection is.

Development failures retained: flow-import-smoke-QMbPUa and h76WOG reproduced the real
startup checkpoint notification race. No readiness assertion was removed; fix verified by
uYmqtz and final qAY7zF. Initial focused test compared PNG container representations;
it now checks exact decoded pixels (TIFF decoding may change lossless PNG encoding).
The failed fixture/log evidence remains outside the repository.

## Remaining work and limits

See docs/refactor/TIFF-IMPORT.md for invocation and limits: 1–10000 TIFFs, 128 MiB/source,
512 MiB prepared PNG bytes and existing codec bounds. These are caps, not scale performance
acceptance. Read/write helpers currently run from source; packaged resources/Python discovery,
Windows/Linux native publication and network/removable filesystems remain unverified.

Still missing: live A/B switching and stale callback acceptance, ordered output naming,
exported-shot Trash deletion, external TIFF refresh, import into an existing live Session,
remaining drawing/presentation tools, full-shell routing and independent review. In-progress
conversion cancellation and detailed progress are full-shell work; native chooser cancel works.
No PSD/SQLite/migration, personal media, push, worktree cleanup or production default switch.
