# Batch 3 coordinator review 1 — 2026-10-30

Status: review in progress; no lane integrated into main, no publication or cleanup.
All three original delivered checkouts were clean; complete full/build receipts were
verified with identical HEAD and clean status before/after. Board's tested c8ac82a differs
from implementation b8eb87f only in its prior report. Those gates establish their recorded
candidate self-tests, not acceptance of still-missing behavior.

## Disposition

- Board b8eb87f: removeShots/moveDialogues changes reviewed for active-only validation,
  snapshot/queue semantics, retained assets and atomic history. Insertion remains missing.
  Coordinator inspected depot.ts and assets.ts: put revalidates PNG decode/dimensions even
  for existing blobs. Assigned Session-owned read -> put -> bound receipt validation,
  followed by one insertShot history publication after all references succeed. No new
  depot trust API or caller-supplied receipt needed. Board resumed under original scope.
- Drawing 5f9a23c: prior three evidence gaps closed in the real Canvas receipt, including
  close/reset instrumentation (not GPU reclamation), normal compositing and clear snapshot.
  Source review found fill RGBA validation uses Array.every, which skips sparse holes.
  Dispatched red regression followed by full four-component validation; old candidate is
  not accepted pending this fix. Shared Session atomic merge adoption remains coordinator work.
- TIFF 9040704: reviewed TypeScript adapter and Python worker, immutable snapshots,
  actual PNG admission, bounded channel decompression, strict supported raster subset,
  layer opacity/composite behavior and settled-child cleanup. Independently reran real
  public-interface tests: 17 passed, exit 0, 12.93 seconds total. Raw log retained at
  .hermes/batch3-review/tiff-focused.log. Eligible for later combined verification, not
  proof of production Save, backup, replacement, Photoshop, Windows or packaging.

## Next integration decisions

Session remains the only state/history owner. Fill/clear/merge need one Session-owned
queued operation: snapshot image -> produce private pixels -> validate captured baseline
and plan -> admit PNG -> validate receipt -> publish one atomic Drawing result to Board.
A merge must replace target pixels, normalize compositing properties and remove source
layers within one image revision/history entry, never separate visible layer commands.
Keep unsupported merge policies explicit; current module is not full legacy merge-visible.
This is an integration design constraint, not an implemented contract in main.

Board and Drawing received bounded follow-ups in their existing threads. TIFF stays stopped.
Wait for final source identities and their checks, review changes, then integrate exact
owned implementation commits and run combined tests/build and real connected scenarios.
Do not remove worktrees or failure evidence before integration is accepted and archived.
