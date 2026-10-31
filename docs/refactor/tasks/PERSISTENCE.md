# Persistence — wave 1 assignment

> Completed wave-one assignment, retained for scope and evidence interpretation. It does not restart the lane or authorize edits today.
> [Current navigation](../README.md).

## Outcome

Implement createProjectStore under CONTRACTS.md for synthetic new-format project roots:
write immutable PNG assets before publishing project metadata; reopen the exact checkpoint.
This does not replace the application's current Save/recovery path or write user TIFFs.

## Ownership and inputs

Write only `electron/core/persistence/**`, `electron/core/platform/**`, DELIVERY.md and QUESTIONS.md.
Shared types: electron/shared/refactorV1.ts. Read existing relevant filesystem helpers,
projectMetadataService.ts, saveRecovery.ts, managedSourceSave.ts and test/temporaryWorkspace.ts
to understand failure cases. Existing code is reference, not a requirement to recreate its
entire protocol. Do not modify it or weaken its checks. Keep platform differences inside your
owned platform Module; abstract only operations with a real production/test need.

## Work sequence

1. Establish baseline, write the failure/publication sequence and tests before implementation.
2. Implement validated real-filesystem checkpoint write/load with existing Node/sharp dependencies.
   Add internal injected faults only where real failures are hard to reproduce deterministically.
3. Add `electron/core/persistence/FORMAT.md`: actual layout, limits, atomicity/durability claims,
   root/path policy, Windows uncertainties, retained failures and no-GC rule.
4. Freeze, commit, run TESTING.md focused/full/build and report.

## Required acceptance cases

- Save/load a tiny synthetic multi-shot, multilayer project; exact metadata and encoded PNG bytes
  survive reopen. Active, parked, deleted-but-retained images and Unicode text are covered.
- Same asset reused is not overwritten; its existing bytes/hash are verified. A corrupt existing
  blob is an error, not automatically repaired by overwriting it.
- Same revision/same content is idempotent; stale revision, different same-revision content and
  a different project ID at the same root are conflicts.
- Snapshot submitted data before awaiting asset reads; mutate caller input mid-flight in a test
  and verify the receipt still identifies the submitted checkpoint, not a mixed version.
- Concurrent saves to one root (including different store instances) serialize; independent
  roots are not unnecessarily serialized. Do not claim cross-process concurrency support.
- Inject failures during asset creation, version record write and final head publication. The
  previous published checkpoint remains usable when publication did not occur; failures after
  an effect are represented honestly. No premature successful receipt or unowned cleanup.
- Missing/corrupt PNG, wrong hash/dimensions, malformed manifest and unsupported schema fail
  with meaningful codes. load/read do not silently return modified external asset bytes.
- Reject path traversal, symlink escapes and unsafe pre-existing paths using real temporary
  fixtures. Read-only/denied replacement is reported without chmod or privilege broadening.
- No TIFF, original image, personal userData, Trash or legacy recovery file is touched.
- Document real Mac results and untested Windows behavior separately. Cross-platform source
  structure and mocks are not Windows acceptance.
- A 1,000-shot metadata fixture referencing a bounded set of small immutable images reopens
  correctly; record exact workload and avoid claiming large-raster performance from it.

## Definition of done

Public Interface works on real owned temporary directories; every case has evidence; complete
allowed suite and full build pass; FORMAT.md describes limits accurately; committed implementation
and DELIVERY.md identify final tested SHA. Partial GUI recovery, TIFF output and full application
Save/Close remain future work, not implied by this checkpoint milestone.
