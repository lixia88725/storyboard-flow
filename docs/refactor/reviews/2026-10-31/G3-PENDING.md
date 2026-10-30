# Pending explicit-Save lifecycle — 2026-10-31

Candidate: 5643287bc1d175ddffdcf59e6a55275ce30788db, original main.
Implements the user-approved logical Pending policy in the isolated new-format editor.
Default production App/launcher remains unchanged; this is not complete G3/G4 acceptance.

## Behavior

Session admits active/Pending membership moves into its single queue and document history.
Existing pixel/text editing restrictions on parked shots remain; only membership is newly
admitted. Paint already in flight settles before a queued park command. Group park, restore,
and reorder change references/order only, preserve all immutable assets, and checkpoint.
One Undo restores the complete moved group. No TIFF encoding or filesystem effects occur
from the membership command, Undo or Redo. UI refuses moves during an unsettled stroke.

FlowPending uses the existing static-media projection and dnd-kit on the same Session as
the grid and Japanese view. Actual drop into Pending, toolbar group parking, drag back onto
an active card, Pending reorder and restore-to-end are connected. No new project state owner.

Explicit Save captures both active and parked lists. Active outputs live in the project
root; parked outputs live in Pending/. Stable imported names are preserved; new outputs use
shot IDs. Editable layer PNGs stay under .storyboard-flow/checkpoints/assets/, and original
TIFF backups stay under .storyboard-flow/originals/. Copying the whole project retains them.
Undo after Save changes membership only; the next Save reconciles the physical location.

Unchanged image/text inputs reuse the verified TIFF without calling the codec or reading
PNG assets; membership-only moves preserve the inode. Changed inputs still use the existing
native policy/CAS writer. Each move records an intent with source inode/device and digest,
publishes by exclusive hard link, verifies identity/content, releases the source name and
flushes directories before acknowledgment. Interrupted two-name or destination-only states
resume on the next explicit Save. Collisions/aliases/unknown identities retain evidence and
refuse; there is no overwrite fallback and no whole-batch atomicity claim.

## Evidence

- Development: native TIFF Save 11 tests and Session 73 tests pass (84 total), including
  prior restrictions, active/Pending Undo/Redo, checkpoint, queued paint, unchanged assets,
  Save/restore/reopen, native partial failure, collision preservation, Pending directory
  alias refusal, interrupted link/release recovery and zero codec/PNG reads on no-change Save.
  Logs: /private/tmp/flow-pending-focused3.log and flow-pending-session-final.log.
- Final complete build: .hermes/evidence/20261030T164025.201586Z-build/, exit 0,
  clean unchanged candidate before/after; includes both typechecks.
- Full allowed suite: 383 files / 2898 tests passed, no failures or skips, exit 0,
  1156.734 seconds; .hermes/evidence/20261030T164045.369205Z-full/.
  Full/build receipts both record clean unchanged 5643287 before and after.
- Final real Electron: node scripts/flow-editor-smoke.mjs passed on clean 5643287;
  /private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-lCuN15/receipt.json.
  Physical directory audit matches parked ids shot4/shot2 to Pending/shot4.tif and
  Pending/shot2.tif with no root duplicates; saved revision 52 matches checkpoint and
  all move/pending intents are cleared. 42 cases including all prior 36. New actual pointer
  drop, logical-only file checks, single Undo/Redo and exact asset preservation, visible
  Pending Save, Japanese restore followed by Save, Undo/Save repark and fresh-process reopen.
  Close ordering uses a test-only gate on the real Save IPC reply so results do not depend
  on raster speed. No renderer/project/store substitute; actual native Save still runs.
- Development GUI pass: flow-editor-smoke-mQBs9g and flow-editor-smoke-3Hi04W.
  Retained failed run rGzeWc: script tried Japanese view before the initial checkpoint
  settled; app correctly refused and the script then queried the absent view. Harness
  now waits for readiness. No assertion was weakened or removed.

## Limits and next work

Implemented and self-tested; independent acceptance remains open. The GUI does not certify
OS-native external drag/drop, Photoshop interoperability or every Pending reorder/group UI
combination. It directly tests pointer parking and DOM restore, with core group history tests.

Full G3 still needs actual TIFF import/bootstrap and A/B switching acceptance. Ordered naming,
exported-shot Trash deletion, remaining tools and full production shell routing are separate.
Already exported shots removed from both lists still refuse Save. External TIFF edits refuse
rather than auto-refresh; importer integration must implement that separately. No persistent
Undo, SQLite, PSD, dependency installation, personal media, push or worktree removal.

Hard-link filesystem support is required (no FAT/exFAT fallback). Windows, installers,
removable/network filesystems and 1000-image raster performance remain unverified. Data is
project-relative; native multi-directory move durability on Windows is not claimed.
