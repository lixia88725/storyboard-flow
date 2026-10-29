# Hermes delivery — persistence

Status: COMPLETE

- Worktree / branch: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence` / `codex/hermes-persistence-wave1`
- Shared base / briefing commit: `c7630b3543bb6c7e7aa18bf9159aa97046a8970e` / `decb251`
- Tested implementation SHA: `bbbdf7d729dde5363854926bbcc46f207ea56b0a` (review correction; the earlier candidate
  `34749121600def664f8e8676fbe9a7d6f0711d56` is superseded — its gates are kept below as history)
- Report HEAD (report-only commit after the tested SHA): the branch-tip commit that adds this file
  ("Update delivery report after review corrections") — resolve with `git rev-parse HEAD`; a commit
  cannot contain its own SHA. Implementation code is unchanged since `bbbdf7d`.
- Implementation commits to integrate (briefing commit excluded):
  `33be777` (checkpoint store), `3474912` (refuse loading assets through a replaced asset directory),
  `bbbdf7d` (review P1/P2/P3 corrections)

## Result

`electron/core/persistence/index.ts` exports `createProjectStore(): ProjectStoreV1`, a real-filesystem
checkpoint store for synthetic new-format project roots. Written files:

```
<root>/.storyboard-flow-v2/project.json          head manifest, ProjectV1 as canonical UTF-8 JSON
<root>/.storyboard-flow-v2/assets/<sha256>.png   immutable content-addressed PNG blobs
<root>/.storyboard-flow-v2/versions/<rev>.json   immutable manifest copy per published revision
```

`saveCheckpoint` deep-copies and validates the submitted `ProjectV1` **before the first await**, binds
a canonical root, queues per root in-process, verifies or creates immutable assets (SHA-256 checked,
PNG fully decoded, dimensions compared with every layer that references the asset), writes the
immutable version record, and only then publishes `project.json` by `temp file → fsync → rename →
directory flush`. The receipt is returned only after publication. `loadCheckpoint` re-validates the
manifest strictly, requires every asset the snapshot names — retained, unreferenced images included —
and returns an asset reader that re-checks root binding and the content address on every read.

Owned modules: `electron/core/persistence/{index,checkpoint,validate,assets,layout,fileOps,canonicalJson,limits,lock,errors,faults}.ts`,
`electron/core/platform/index.ts`, `FORMAT.md`, fixtures `store.fixture.ts` and 9 test files.

**The production application is not connected in this wave.** No Save/Close/recovery/UI/TIFF path
imports the store; no legacy project is migrated; no existing behaviour, test exclusion, config or
dependency was changed. `FORMAT.md` documents layout, encoding, write order, the failure table, exact
limits, root/path policy, error-code mapping, durability claims and untested platform behaviour.

## Corrections — review 2026-10-29 (P1/P2/P3)

Scope: only the three persistence items. D1/D2 (drawing) and S1 (storyboard) were not touched; no
shared contract, directory name, compatibility migration or production wiring was changed.

Red evidence, captured before the fix on the reviewed candidate `3474912`:
`/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T130857Z-correction-red/output.log`
— 3 files failed, **6 tests failed / 42 passed**, and the six failures are exactly the new regressions.

| Item | Regression (red before, green after) | Correction in `bbbdf7d` |
|---|---|---|
| P1 reused asset dimensions | `assets.test.ts` "re-checks the dimensions of an already stored asset against the current claim" (an 8×6 blob reused by a claim declaring 10×10 was `ok:true`); "rejects two references to one stored asset that declare different sizes"; "rejects a hash-named non-PNG blob that is already present in a fresh store" | `storeAsset` no longer returns after the digest check: the PNG decode and the dimension check run on every save and cover **all current references** of that asset, existing blob or not. Mismatch → `invalid-input`, previous head retained. |
| P2 prototype-key image id | `format.test.ts` "keeps legal image ids that collide with Object prototype keys" (`__proto__` active, `constructor` parked, `toString` retained) — was silently dropped while Save returned ok | `images` is built with `Object.fromEntries`, so every legal id stays an own data property through save, manifest and load; `Object.hasOwn` reference checks work for those ids. |
| P3 shared editable image | `load.test.ts` "refuses two active shots that share one editable image, before any write"; "refuses an active and a parked shot that share one editable image" (same test asserts a retained, unreferenced image is still accepted) | Validation refuses duplicate image ownership across active and parked shots, before any filesystem write. |

Consequential test change: `conflicts.test.ts` "different content published under an already used
revision" previously added a second shot on an image another shot owned; it now differs by project
name and an extra dialogue, because that shape is correctly rejected as shared ownership after P3.

Correction notes: every save now decodes each referenced asset once, because the dimension check cannot
be skipped for an already stored blob (cost noted in `FORMAT.md` §3 step 6). The review's
assets-directory flush observation is documented in `FORMAT.md` §9 as an open durability limitation
rather than changed here, since it is outside P1–P3.

## Acceptance evidence

All cases run real behaviour on owned temporary directories (`test/temporaryWorkspace.ts`); no
mock-only assertions. Unless stated, the raw evidence is the focused log
`.hermes/evidence/20261029T113117.403973Z-focused/output.log` (absolute path in §Verification).

| TASK case | Test/scenario | Result | Raw evidence |
|---|---|---|---|
| Tiny multi-shot, multilayer save/load; exact metadata and encoded PNG bytes survive reopen; active, parked, deleted-but-retained images and Unicode | `format.test.ts` "publishes immutable assets, the version record and the manifest, then reopens the exact checkpoint"; "keeps Unicode text exactly…" (combining marks, emoji, CJK, NUL, lone surrogate); "round-trips an empty project" | PASS — 5 assets including the retained `image-4`, manifest byte-identical to `canonicalUtf8(project)`, every asset byte-identical after reopen | focused log |
| Same asset reused is not overwritten; existing bytes/hash verified; corrupt existing blob is an error, not repaired | `conflicts.test.ts` "does not overwrite a reused asset and verifies its existing bytes" (same inode + `mtimeNs`); "reports a corrupt existing blob as a conflict and never repairs it by overwriting" | PASS — second save leaves the blob untouched; corrupt blob → `conflict`, file bytes unchanged, head still revision 1 | focused log |
| Same revision/same content idempotent; stale revision, different same-revision content, different project id are conflicts | `conflicts.test.ts` "treats the same revision with the same content as a no-op"; "rejects a stale revision…"; "rejects different content published under an already used revision"; "rejects a different project id at the same root"; "treats a version record as immutable" | PASS — idempotent save rewrites nothing (inode/mtime unchanged); all other cases `conflict` with the head unchanged | focused log |
| Snapshot submitted data before awaiting asset reads; caller mutation mid-flight does not produce a mixed receipt | `concurrency.test.ts` "acknowledges the submitted checkpoint even when the caller mutates it mid-save" (mutates name, revision, shots and layer opacity from inside the reader); "stores a private copy of the bytes the reader hands out" | PASS — receipt `{project-scene, revision 1}`, manifest equals the submitted document, stored asset equals the original bytes | focused log |
| Concurrent saves to one root serialize, including different store instances; independent roots not serialized; no cross-process claim | `concurrency.test.ts` "serializes two stores writing the same root…" (5-then-5 reader order, `pendingRootCount` 1→0); "does not serialize independent roots" (both readers meet a barrier); "shows a reader either the previous or the new head…" | PASS — second store's reader never runs while the first save is in flight; both roots read concurrently; a load during a save sees the previous checkpoint | focused log |
| Injected failures during asset creation, version record write and final head publication; previous checkpoint stays usable; effects after a failure reported honestly; no premature receipt | `failures.test.ts` — read-only `versions/` (real `EACCES`), read-only `assets/` (new asset refused), read-only store dir (version record written, head publish refused), injected `beforeHeadReplace`, injected `beforeHeadWrite`, reader failure on the second asset | PASS — every case `io-failure` with `ok:false`; previous head loads unchanged; `versions/2.json` retained and reused by a later successful retry; no temp file left; permissions re-asserted as still `0500` (nothing chmod-ed) | focused log |
| Missing/corrupt PNG, wrong hash/dimensions, malformed manifest, unsupported schema fail with meaningful codes; load/read never return modified bytes | `assets.test.ts` (hash mismatch → `conflict`, reader throw → `missing-asset`, non-PNG → `invalid-input`, truncated PNG → `invalid-input`, wrong dimensions → `invalid-input`, **reused blob with a new size claim → `invalid-input`**, **two references with different sizes → `invalid-input`**, **hash-named non-PNG pre-placed blob → `invalid-input`**, deleted asset → `missing-asset`, tampered bytes → `conflict`, unknown id → `not-found`); `load.test.ts` (23 validation cases + **shared image ownership, active-active and active-parked** + non-JSON / non-UTF-8 / array / wrong schema / wrong version manifests) | PASS — codes as listed; tampered asset bytes refused at read time; the three reused/pre-placed cases are the review P1 regressions | focused log (green), correction-red log (red) |
| Legal ids that collide with `Object.prototype` keys survive save/load (review P2) | `format.test.ts` "keeps legal image ids that collide with Object prototype keys" — `__proto__`, `constructor`, `toString` as active, parked and retained images; exact own-key sets compared in the manifest and after load | PASS — all three ids are own keys with identical documents after reopen | focused log |
| Retained unreferenced images stay legal while shared ownership is refused (review P3) | `load.test.ts` shared-image tests assert `image-4` (no shot) is accepted, and two owners are `invalid-input` before any write | PASS | focused log |
| Reject path traversal, symlink escapes, unsafe pre-existing paths on real fixtures; denied replacement reported without privilege broadening | `paths.test.ts` (symlinked root, aliased parent, symlinked store/assets/version entries, symlinked head, symlinked asset file, assets dir swapped for a link) + the read-only cases above; `load.test.ts` "an asset id shaped like a path traversal" | PASS — `invalid-input` for root/link policy, `conflict` for unsafe store entries, `io-failure` for denied writes; link targets verified byte-unchanged | focused log |
| No TIFF, original image, personal userData, Trash or legacy recovery file touched | `format.test.ts` "touches nothing outside the store directory…" (decoy `frame-0001.tif`, legacy `.storyboard-workbench/project.json`, `notes.txt`: bytes, inode and `mtimeNs` unchanged; no new path outside `.storyboard-flow-v2/`) | PASS | focused log |
| Real Mac results and untested Windows behaviour reported separately | `format.test.ts`/`FORMAT.md` §9; `platform.test.ts` (POSIX directory fsync `synced`, `win32` branch `skipped` without filesystem access, `link` `EEXIST`, rename does not write through a link) | PASS as a Mac result; **Windows is untested and not claimed** — see Limitations | focused log |
| 1,000-shot metadata fixture over a bounded set of small immutable images reopens correctly; exact workload recorded | `scale.test.ts` "publishes and reopens 1,000 images over a bounded asset set" | PASS — exact deep-equality of the whole project, all 8 assets read back | focused log (prints the workload line) |

Also verified: no-op detection (`idempotent`), invalid input never touching the filesystem
(`load.test.ts` asserts the store directory is not even created), and an empty project round-trip
with no asset reader call.

## Verification

| Command | Tested SHA | Exit | Counts / duration | Log / receipt |
|---|---|---|---|---|
| `focused --lane persistence` (final code) | `bbbdf7d` | 0 | 9 files / 75 tests passed, 6.51 s | `.hermes/evidence/20261029T131644.511244Z-focused/output.log` |
| `full --lane persistence` (final code) | `bbbdf7d` | 0 | 368 files / 2661 tests passed, 1155 s (receipt 1155.64 s) | `.hermes/evidence/20261029T131653.126887Z-full/output.log`, `…/receipt.json` |
| `build --lane persistence` (final code) | `bbbdf7d` | 0 | both typechecks + vite build + `build:electron`, 9.22 s | `.hermes/evidence/20261029T135557.459465Z-build/output.log`, `…/receipt.json` |
| `git diff --check` and `git diff --check decb251..HEAD` | `bbbdf7d` | 0 | clean, no output | — |
| Correction regressions before the fix (red) | `3474912` | 1 | 3 files failed, 6 failed / 42 passed | `.hermes/evidence/20261029T130857Z-correction-red/output.log` |
| *Earlier candidate, superseded — kept as history* `focused` | `3474912` | 0 | 9 files / 69 tests passed, 5.60 s | `.hermes/evidence/20261029T113117.403973Z-focused/output.log` |
| *Earlier candidate* `full` | `3474912` | 0 | 368 files / 2655 tests passed, 1253 s | `.hermes/evidence/20261029T113130.665639Z-full/output.log` |
| *Earlier candidate* `build` | `3474912` | 0 | both typechecks + vite build, 9.37 s | `.hermes/evidence/20261029T115624.146526Z-build/output.log` |
| *History* baseline `focused` before any edit | `decb251` | 1 | "No test files found" — baseline, **not** a PASS | `.hermes/evidence/20261029T110636.199797Z-focused/output.log` |
| *History* `focused` / `build` attempts while another lane held the slot | `3474912` / `bbbdf7d` | 75 | returned before running; live locks left untouched, retried after they cleared (three such waits, owner.json inspected each time) | — |

Absolute paths of the raw logs (all under the worktree, `.hermes/` is git-ignored):

```
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T110636.199797Z-focused/output.log
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T113117.403973Z-focused/output.log
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T113130.665639Z-full/output.log
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T113130.665639Z-full/receipt.json
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T115624.146526Z-build/output.log
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T115624.146526Z-build/receipt.json
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T130857Z-correction-red/output.log
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T131644.511244Z-focused/output.log
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T131644.511244Z-focused/receipt.json
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T131653.126887Z-full/output.log
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T131653.126887Z-full/receipt.json
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T135557.459465Z-build/output.log
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence/.hermes/evidence/20261029T135557.459465Z-build/receipt.json
```

Initial failures, preserved rather than hidden:

1. First local run of `format.test.ts` failed on the assertion filtering the "no files outside the store"
   tree (the test's own filter missed a nested decoy path, not a product defect). Fixed the assertion;
   the retained fixture container `/private/var/folders/…/T/storyboard-tests-2TX0DS` was left in place
   as documented for failed runs.
2. First local run of `failures.test.ts` failed because the test expected the `versions/` **directory**
   to be absent after an early asset failure, while the store creates its directories up front. The
   assertion now checks that the directory holds no record. Retained container
   `/private/var/folders/…/T/storyboard-tests-YLEXCA`.
3. `hermes-verify focused` exited 75 once because `codex/hermes-drawing-wave1` held the slot with a live
   `full` run (owner.json inspected, process alive). I waited it out and never touched its lock.
4. Self-review after the first commit found that `loadCheckpoint` validated asset entries but not that
   `assets/` was still a real directory; a link planted there could have supplied the required files
   from outside the store. Fixed in `3474912` with a regression test.
5. Review correction: the six new regressions were written first and failed on `3474912`
   (6 failed / 42 passed, log listed above), then passed after `bbbdf7d`. Every gate in the table was
   re-run on `bbbdf7d`; the `3474912` rows are the superseded candidate's history.
6. `hermes-verify` exited 75 three times during this correction (drawing, storyboard and drawing again
   holding the slot). Each time I inspected `owner.json`, confirmed the owner process was alive, waited,
   and retried; no lock was removed and no other lane's process was touched.

Skips: none on this platform. Three permission-based cases in `failures.test.ts` self-skip on Windows
(`it.skipIf(win32)`) because Windows does not express "cannot create an entry in this directory" via
directory mode bits; they are the only conditional cases and they executed here.

Performance workload (recorded, not a speed claim): 1,000 images / 1,000 shots (900 active, 100 parked)
/ 2,000 layers / 500 dialogues / 8 distinct 32×24 PNG assets; manifest 725,887 bytes; save 110–121 ms,
load 16–19 ms across the runs above, on macOS 26.6.2, Apple silicon (`darwin/arm64`), APFS, Node as
provisioned in the worktree. This is a metadata workload: it says nothing about large rasters, drawing
responsiveness, or GUI behaviour.

## Integration notes

Contract questions (none block this wave; the default taken is documented in `FORMAT.md`):

1. **Version record content.** CONTRACTS says "retains the immutable version record" without defining it;
   I store a byte-identical copy of that revision's manifest. Cost: ~2× manifest bytes per revision
   (725 KB per revision in the 1,000-shot fixture). If a small pointer/integrity record was intended,
   change this before wave 2 — the write path is one function (`writeVersionRecord`).
2. **Error-code mapping.** The contract does not map conditions to the seven codes. I used `conflict`
   for every content-address disagreement (reader bytes ≠ claimed id, existing blob ≠ its name, head
   id/revision conflicts, unsafe pre-existing entries) and `io-failure` for syscall/durability failures.
   If the application needs to distinguish "corrupt asset" from "conflicting revision" before wave 2,
   that needs new codes or a discriminator — not a message parse.
3. **Hard links on Windows.** Asset and version publication use `link()` so a partial blob can never
   appear published, and there is deliberately no copy fallback. On filesystems without hard links
   (FAT/exFAT, some SMB shares) saves fail with `io-failure`. If such folders must work, the fallback
   policy is yours to decide; it is a correctness trade-off, not an implementation detail.
4. **Unknown fields are rejected** (`invalid-input`) at every level rather than preserved, reading
   CONTRACTS' "reject unsupported structure where needed" as the literal rule. Adding a field therefore
   requires a schema decision.
5. `loadCheckpoint` is strict by contract and also does not verify history completeness: a missing
   `versions/<revision>.json` is neither reported nor repaired. There is no GC anywhere, so retained
   assets and records accumulate by design.

Dependency / environment: no dependency, config, lockfile, script or test-exclusion change. Only Node
built-ins and the existing `sharp` dependency are used. Dependency symlinks untouched.

Retained state and cleanup: all fixtures are owned temporary containers created through
`test/temporaryWorkspace.ts`; successful runs remove their own container. Two containers from the failed
local runs (listed above) and the verify script's own `/var/folders/…/storyboard-hermes-persistence-*`
temp roots are still on disk — they are outside the checkout and were left rather than deleted as failure
evidence. No background process of mine is running; both verify jobs exited (0).

Limitations, stated plainly: this wave is headless core functionality on macOS only. Windows, network and
removable filesystems, GUI recovery, partial/lenient read views, TIFF output, original-image writeback,
asset deletion/GC, cross-process writers and full application Save/Close are **not** implemented or
verified. Dimension checks now run on **every** save, for a reused blob and for each of its references
(the digest proves the bytes, not the descriptor), so a save costs one PNG decode per referenced asset.
PNG checking is "sharp decodes it", not a hardened parser claim. The `assets/` directory is not
explicitly flushed after linking a new blob (open durability question documented in `FORMAT.md` §9);
no power-loss or universal POSIX durability acceptance is claimed.

Next integration work (wave 2, coordinator-owned): wire the store behind the real Save/Close and recovery
chain, add the read-only partial project view, decide on asset GC and on the Windows filesystem policy,
then re-run the combined suite plus the actual synthetic GUI chain.
