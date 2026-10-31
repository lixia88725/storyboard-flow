# Explicit Save: owned TIFF deletion

Scope: the isolated new-format editor. Logical Board deletion and checkpoints do
not touch working TIFFs. Explicit Save owns output removal; Main injects Electron
`shell.trashItem`. No renderer paths, Trash enumeration or unlink fallback.

## Persisted transaction

The output ledger retains shot ownership, original digest, current/pending output
digests, and a deletion intent. An intent binds project root, source membership,
original basename, file device/inode/digest, and a fresh staging directory identity.

1. Resume earlier recorded rename/membership/deletion effects before interpreting
   the newly captured project. Admission budgets and prepare all kept pixels before
   starting a new deletion. Verify sources and collision policy.
2. Preserve the immutable first original under `.storyboard-flow/originals/`.
3. Persist `stage` intent; move the exact owned file exclusively to
   `.storyboard-flow/deletions/<uuid>/<basename>` using the existing link/release
   protocol. Persist `ready`, then `dispatching` before invoking system Trash.
4. Await the real OS response, cache the ACK immediately, verify staged absence,
   flush the staging directory and persist `confirmed`. Only then drop the cached
   ACK. Missing files without such evidence never imply success.
5. Retire the output entry with `retired: "trashed"`, keeping shot/original
   provenance. A never-published, absent output with no original instead retires as
   `absent-unpublished`; this does not claim a Trash effect.
6. Complete remaining outputs, moves and ordered naming before issuing Save receipt.

Partial Save can have settled effects but returns no successful receipt. Retrying
finishes durable intent; an intact staged file after OS refusal is retryable. A
confirmed entry is not sent to Trash again. Cached but nondurable ACKs prevent
normal Close and project switch until retry makes the ACK durable.

## Undo and retention

Retired entries do not reserve active filenames. Undo restores Board content;
explicit Save regenerates its TIFF from retained project assets using a fresh
exclusive intermediate basename, then normal ordered naming. It never reads Trash.
Original backups and PNG assets are retained. Foreign destinations are not replaced.
Empty staging directories and output tombstones have no automatic GC. Ledger history
is bounded to 10,000 entries and 8 MiB, including transaction growth reservation;
exceeding a bound refuses rather than discarding provenance.

## Limits and evidence boundary

If the process terminates after the OS has moved the TIFF but before confirmation
becomes durable, a later process sees `dispatching` plus absence and refuses with
an unknown-outcome error. It must not manufacture success or automatically scan
Trash. This iteration does not provide an unknown-outcome recovery UI; retain the
project/evidence for explicit recovery. An ACK with unexpected remaining/reappearing
staged content also refuses. Concurrent hostile filesystem mutation is not certified.

Only the app's one-writer root is supported. Directory flush/link behavior retains
existing platform constraints; Windows, removable/network filesystems and power-loss
recovery are not certified by macOS checks. Reopen restores project content, not a
previous process's Undo stack.

`flowOutputTrash.test.ts`, `flowTiffSave.test.ts` and `flowEditorRuntime.test.ts`
cover protocol/failure/retry/restore and Close boundaries. `scripts/flow-trash-smoke.mjs`
checks the actual Electron UI and native system Trash with freshly generated owned
TIFFs and isolated userData. Its wrapper validates root, directory, inode and digest
before OS dispatch; it never enumerates personal Trash. Owned synthetic trashed TIFFs
are intentionally left there, and test evidence stays in the reported temporary root.
