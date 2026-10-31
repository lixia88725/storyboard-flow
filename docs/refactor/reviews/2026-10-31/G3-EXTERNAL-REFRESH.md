# Manual external TIFF refresh — 2026-10-31

Implementation candidate: `d2ed4eee0e14016314b1ae20c93ced938290d8e6` on original main. Local implementation only;
no push, default-route/launcher change, dependency install, personal-media access or
worktree retirement. The report commit changes documentation only.

## Behavior

- Manual **Refresh images** in the isolated editor reads bound active/Pending TIFFs.
  Independent external base/layer changes preserve local drawing, project text and order.
  Same-layer conflicts or uncertain identity preserve the external image as a new Pending
  alternative. Source TIFFs remain untouched until explicit Save.
- One Session history action covers all changes and new alternatives. Undo/Redo changes
  desired project state, never external TIFF bytes. Repeated Refresh and reopening do
  not duplicate an already accepted external version.
- Initial TIFF import now preserves the first original in the prepared namespace before
  project publication; source bytes count toward the existing 512-MiB preparation limit.
  Save continues to validate/preserve that exact backup.
- A durable intent couples the captured before-state, prepared assets, after-checkpoint
  and output baseline. Retry/reopen finishes a recorded request; completed receipts handle
  lost replies. Uncertain publication blocks unrelated edits/Save/Close until Refresh retry.
  This is recovery of a requested operation, not background auto-sync.
- RGBA pixel digests distinguish actual image changes from PNG encoding differences.
  Immutable PNG hashes remain asset identity. Accepted external assets remain retained;
  no garbage collection or irreversible draft destruction is added.

## Review and corrections

Independent read-only code review found that the completed refresh ledger and Save's
new image baselines could exceed the ledger limit after durable effects. It also found
that deterministic pre-write budget refusal could be mislabeled unknown, trapping the
Session in retry. Both prepared/completed Refresh states and every positive Save record
increase are now budgeted before new effects. Boundary regressions use real 8-MiB ledgers.
Coordinator review also closed checkpoint/Close admission races by reserving pending/sealed
state before asynchronous journal checks. Follow-up scoped code review passed; the reviewer
ran no tests and did not certify GUI/platform behavior.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Complete build | exit 0, 9.758 s; renderer/Electron typechecks and Vite | `.hermes/evidence/20261031T073950.287368Z-build/` |
| Complete allowed suite | 390 files / 2974 tests, exit 0, 1277.909 s | `.hermes/evidence/20261031T074019.102561Z-full/` |
| Preload consistency | exit 0 | `/tmp/flow-refresh-final-preload.log` |
| External refresh | 13 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-refresh-smoke-zBduZC/receipt.json` |
| TIFF import | 13 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-import-smoke-yuqkjt/receipt.json` |
| Existing editor | 42 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-3IL4ew/receipt.json` |
| Naming/switch | 9 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-switch-smoke-cUwKiI/receipt.json` |
| System Trash | 10 connected cases | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-trash-smoke-NlLptt/receipt.json` |

The 87 connected cases identify the same clean candidate. Picker results are scripted;
real pointer drawing, preload/IPC, Session, checkpoints, TIFF codec and filesystem are
connected. Refresh includes a delayed real IPC result proving normal Close waits.
The coordinator visually inspected the refresh screenshot (external red base, local
stroke and project text retained); this is not independent visual acceptance.
The Trash regression sends only one identity-checked, run-owned synthetic TIFF to system
Trash; that file is intentionally retained. Personal Trash is never enumerated.

Development evidence: `/tmp/flow-refresh-focused5.log` (118 tests before final budget
fixes), `/tmp/flow-refresh-budget.log` (31 tests including 3 new budget cases),
`/tmp/flow-refresh-build6.log`. Earlier failing runs remain evidence of development,
not PASS: initial PNG byte-hash expectations, duplicated import decode affecting race
fixtures, and a GUI harness reading a Pending output from the root were corrected.
The sandbox-only Electron attempt exited by signal before the workflow; real GUI runs
used scoped escalation and isolated userData.

Runtime regressions cover failed checkpoint publication, journal-completion failure,
lost final acknowledgement, exact checkpoint matching, recovery asset eligibility,
unsupported source preservation, same-layer conflicts, deduplication, source-original
preservation and pending/sealed admission. Session tests cover one history action,
retry without republishing stale state, queued-edit/freeze refusal and malformed results.

## Limits and remaining gates

Actual Photoshop Save/identity preservation was not exercised; external edits were
synthetically encoded TIFFs. Supported bounded TIFF layers are not full Photoshop/PSD
fidelity. Automatic polling, external file discovery/rename/relink and background refresh
are not implemented. Large-raster/1,000-image performance, Windows/filesystems/installers
and full production-shell parity remain unverified. The 8-MiB output ledger and retained
external assets can limit long sessions/projects; refusal is visible and no history is
silently deleted. Default App remains unchanged. Full application independent acceptance
is still open, distinct from scoped code review and self-run connected scenarios.
