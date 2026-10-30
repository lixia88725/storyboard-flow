# G3 explicit TIFF Save slice — 2026-10-31

Implementation: ff1a159; Close-wait correction: 7d152ea (final candidate).
Isolated new-format editor only. G3 as a whole is NOT COMPLETE.

## Behavior

Main owns original source bindings and a per-project serialized output service.
Renderer requests explicit Save with a captured ProjectV1; later edits remain dirty.
Checkpoint and TIFF status are separate. Save never changes Undo history.
Source mappings are initialized through Main's bindSources API, never guessed from
filenames or accepted from renderer IPC. Existing sources retain their bound names;
new shots use stable shot-ID TIFF names. No order-based renaming is implemented.

All candidate TIFFs are encoded before any output replacement (512 MiB aggregate
prepared-byte cap). Native policy-preserving staged writes use original-byte CAS
or create-only, and wait for the actual child process. First imported bytes are
retained at .storyboard-flow/originals/<shotId>.tif, verified but never overwritten.
The .storyboard-flow/tiff-output.json ledger publishes per-file pending hashes before
replacement and a complete captured-project receipt only after all readbacks pass.
Partial failures retain backups and pending evidence; recognized bytes can be retried
after reopening. External edits, damaged/missing originals after replacement and
unsupported output membership changes refuse. No automatic permission widening.

Close waits for current TIFF output, rechecks gestures, then freezes/checkpoints and
certifies the existing Session. A stroke begun while waiting keeps the editor active.

## Verification

Development focused: 3 files / 10 tests (native TIFF Save, runtime, dedicated preload).
Real tests cover exact pixels/Unicode, repeated Save, Undo Save/reopen, mutation after
capture, failed asset preparation, external edits, damaged/missing original backups,
partial second-file native read-only failure and reopen retry. No assertion deletion.

- Complete build: exit 0, .hermes/evidence/20261030T162906.028075Z-build/;
  clean unchanged final candidate 7d152ea before/after.
- Full allowed suite: 383 files / 2890 tests, exit 0, 1164.934 seconds;
  .hermes/evidence/20261030T160934.063047Z-full/. No failures or skips.
  IMPORTANT: this run started at ff1a159 and ended at 7d152ea. It is not a
  frozen-HEAD receipt. The only intervening files are FlowEditor.tsx and the
  standalone Electron smoke script; no Vitest test/Main/core/preload files changed.
  Final UI is covered separately by the clean-candidate build and 36-case GUI run.
  Do not relabel the full-suite receipt as an unchanged-candidate certification.
- npm run check:preload: exit 0; dedicated bridge parity is also in Vitest.
- Development focused raw log: /private/tmp/flow-tiff-save-focused3.log.
- git diff --check passed.
Real isolated Electron: 36 cases, including prior Board/pixel cases, explicit Save,
Undo Save, unchanged original bytes, saved TIFF/reopened PNG pixel equality, Close
waiting for Save, and a new stroke during that wait retaining an editable window.
Development 36-case receipt: flow-editor-smoke-av0Esr (dirty before final commit).
Final frozen-candidate GUI receipt:
/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-Q1gP7p/receipt.json
records clean 7d152ea and all 36 cases. Reopen screenshot inspected.
Command: node scripts/flow-editor-smoke.mjs. Dedicated userData and synthetic media;
clipboard and Trash are forbidden by the harness. Raw logs/screenshots retained.
Earlier development runs eYCIUb/e8Sfdg passed 34 cases before the extra Close cases.

## Limits and remaining work

Implemented/self-tested is not independent acceptance. No default App/launcher switch,
old-code deletion, push, dependency installation, personal media or worktree cleanup.
All three prior worktrees remain intact.

Still missing for complete G3: TIFF-to-project import/bootstrap UI, A/B switching
acceptance, ordered output filename synchronization, removed/parked output lifecycle,
Pending and full-shell integration. Current smoke seeds a checkpoint and binds a
synthetic source TIFF; it does not prove the import/bootstrap chain. Saving after
removing an already bound shot refuses instead of claiming the on-disk set is synced.

Pending's existing immediate TIFF materialization/move is unchanged. User was asked
whether to keep it or defer file effects until Save. User requested PD2 evidence and
a simplicity/resource recommendation, but has not selected a policy. PD2 sections
2.1 and 6.3 describe Idea Bin references/groups/state, not exact drag-time TIFF effects.
Recommendation: project-owned Pending membership, automatic checkpoint, explicit-Save
file synchronization. Do not infer authorization for this policy yet.

No Windows, installer, network/removable filesystem or 1000-image raster performance
acceptance. Per-file native writes and whole-batch preparation require scale work.
Single writable root owner is assumed; no cross-process lock claim. TIFF is only the
existing codec's documented supported subset, not Photoshop full-fidelity support.
