# Checkpoint format — `.storyboard-flow/checkpoints`

This is the checkpoint layout used by the current Workbench. `index.ts` exports
`createProjectStore(): ProjectStoreV1`; `depot.ts` exports `openFlowAssetDepot` for
immutable PNG admission without publishing a project (see §12).
Application-wide Save, Refresh and lifecycle contracts are documented in
[ARCHITECTURE](../../../../docs/ARCHITECTURE.md); this document covers the storage module only.

## 1. Layout

```
<project folder>/                    caller-supplied root; must already exist, be canonical
└── .storyboard-flow/checkpoints/
    ├── project.json                 head manifest: ProjectV1 as canonical UTF-8 JSON
    ├── assets/<sha256>.png          immutable PNG blob per distinct asset id
    └── versions/<revision>.json     immutable manifest copy per published revision
```

* Directories are created with mode `0700`, files with `0600` (the process umask can only remove
  bits). The parent `.storyboard-flow/` directory is created or verified first; no unrelated file is changed; nothing outside `.storyboard-flow/checkpoints/` is written.
* `assets/<sha256>.png` is the encoded PNG byte-for-byte, and `<sha256>` is the lowercase hex
  SHA-256 of exactly those bytes (the `AssetIdV1`). There is one file per distinct asset id, even
  when many layers and images share it.
* `versions/<revision>.json` is **byte-identical to the manifest of that revision**. Head and
  history are separate copies on purpose: `project.json` is replaced on every publication, while
  `versions/` is append-only. A revision record is written once and never rewritten.
* The store keeps every asset and every version record. **There is no garbage collection, no
  pruning and no repair**: an asset no longer referenced by any shot stays on disk, and a
  record left by an interrupted save stays on disk and keeps its meaning.
* Leftover `*.tmp` files (see §4) are never deleted, reused or interpreted by any later run.

## Naming metadata extension — 2026-10-31

ProjectV1 optionally includes exact string fields `naming.sceneCode`, `naming.artistName`
and `naming.version`. Checkpoint validates and preserves them without defaulting or
normalizing text. Missing naming remains absent; unknown naming fields are rejected.
This store does not rename TIFFs. The explicit output layer derives ordered filenames.

## 2. Encoding

* Canonical JSON: object keys sorted by UTF-16 code unit, arrays in their stored order, compact
  separators (`,` and `:`), exactly one trailing `\n`, UTF-8, no BOM written.
* `project.json` is the `ProjectV1` document itself — no envelope, no wrapper fields.
* Text is stored as given: Unicode is not normalized, case-folded or repaired. Lone surrogates are
  written as `\uXXXX` escapes so the file stays valid UTF-8, and they read back unchanged. A
  leading UTF-8 BOM is tolerated when reading.
* Unknown fields are **rejected**, not dropped, at every level (`invalid-input`). Supporting a new
  field requires a schema decision, not a silent upgrade.
* Numbers must be finite: revisions are nonnegative safe integers, dimensions positive integers,
  opacity a finite number in `[0,1]`.
* `images` is a plain record built with own data properties, so every legal id is an ordinary key —
  including ids that collide with `Object.prototype` members such as `__proto__`, `constructor` or
  `toString`. None of them is ever interpreted as a prototype slot.
* Each shot references exactly one existing image, and **two shots may not share one editable
  image** (active or parked). An image no shot references is a retained image and stays legal.

## 3. Write order (`saveCheckpoint`)

1. **Snapshot** — the submitted `ProjectV1` is deep-copied and validated *before the first
   `await`*. Later edits by the caller, or a reader that keeps handing out the same buffer, cannot
   change what this call acknowledges. The receipt describes the submitted document.
2. **Bind root** — absolute path, existing canonical directory, not a symlink, not reached through
   an aliased parent (`invalid-input` otherwise).
3. **Queue** — an in-process queue keyed by the canonical root. Saves to the same root serialize,
   including across `createProjectStore()` instances; different roots are not coupled.
4. **Store directories** — `.storyboard-flow/checkpoints/`, `assets/`, `versions/` created or verified as
   real directories. A symlink or non-directory with one of those names is `conflict`.
5. **Existing head** — read, parse and fully validate. An unreadable or invalid head is never
   overwritten (`conflict`). Then: different project id → `conflict`; lower revision → `conflict`;
   equal revision with different logical content → `conflict`; equal revision with identical
   content → no-op (nothing is rewritten and the receipt is returned).
6. **Assets first**, in ascending asset-id order: the reader's bytes are copied and hashed, the
   hash must equal the claimed id, and the PNG must be decoded and must match the dimensions that
   **every current reference** declares. A process cache holds dimensions for up to 4,096 fully decoded PNG digests.
   Every save hashes the supplied bytes and checks every current reference against those dimensions;
   cache misses require a full decode. A missing
   file is written as `<asset|version|project>.<24-hex>.tmp` and published with a hard link, so a
   partially written blob never appears under its final name and an existing blob is never replaced.
   An existing file is verified by digest, not trusted by name. The asset directory is flushed
   before admission completes, including existing-file and raced EEXIST paths. Retrying after
   a failed flush must perform this flush again before a checkpoint can advance.
7. **Version record** — `versions/<revision>.json` published the same way (temporary file + link).
   An identical record already present is accepted; different content for an already recorded
   revision is `conflict`.
8. **Head publication** — a temporary file in the store directory is written, flushed with
   `fsync`, then `rename`d over `project.json`, and the store directory is flushed. Only after that
   is the receipt returned.
9. **Receipt** — `{ projectId, revision, manifestPath }`.

A checkpoint therefore never names an asset that does not exist, and a reader never observes a
manifest whose assets are missing *because of this store*.

## 4. Failure behaviour

| Where it fails | State left on disk | Result |
|---|---|---|
| Snapshot / validation, before any I/O | nothing created | `invalid-input` / `unsupported-version` |
| Asset bytes unavailable (reader threw) | assets admitted earlier in this call retained | `missing-asset` |
| Asset bytes do not hash to the id, or an existing blob's bytes do not match its name | offending blob untouched, never repaired | `conflict` |
| Asset is not PNG, is truncated, or its dimensions contradict the layer | nothing published for that asset | `invalid-input` |
| Asset directory not writable | assets already stored retained | `io-failure` |
| Version record not writable | assets retained, head unchanged | `io-failure` |
| Version record of that revision already exists with other bytes | head unchanged, both retained | `conflict` |
| Head temporary file cannot be written | assets and version record retained, head unchanged | `io-failure` |
| Stopped after the head file was written and flushed, before `rename` | head unchanged; this call's temporary file is removed (if its identity changed it is retained and named) | `io-failure` |
| `rename` failed | head unchanged; temporary file handled as above | `io-failure` |
| `rename` succeeded, directory flush failed | **new head is published**; the message says durability is unconfirmed | `io-failure` |

Rules that hold for every failure:

* No receipt is returned unless the head was published (or was already identical).
* Assets and version records are immutable: a failure never rewrites or deletes one. Only the
  temporary files created by the failing call itself are removed, and only after their
  device/inode identity has been checked.
* A temporary file that cannot be removed is named in the error message; nothing is deleted "by
  name" that this call did not create.
* Nothing is chmod-ed, no permissions are widened and no privilege is requested to make a write
  succeed. A denied write is reported as `io-failure`.
* A retry of the same revision after a failed publication is a normal save: the retained version
  record is byte-identical, so only the head is published this time.

## 5. Load (`loadCheckpoint`) and `readAsset`

* `loadCheckpoint` binds the root, requires the store directory (`not-found` when absent or when
  `project.json` is absent), parses and validates the manifest completely, then requires **every**
  asset the snapshot names — including images no shot references — to exist as a plain, nonempty
  regular file (`missing-asset`, or `conflict` for a link/non-regular/oversized entry).
* Loading is strict by design; no lenient read-only partial view is provided.
* Loading does not take the save queue: because the head is replaced atomically, a load during a
  save sees either the previous or the new checkpoint, never a partial one.
* The returned `readAsset(id)` is bound to the loaded checkpoint: ids outside that project's asset
  set are `not-found`, malformed ids are `invalid-input`. Every read re-checks the root and asset
  directory binding, opens the file without following links, re-hashes the bytes and returns a
  private copy. Bytes that no longer match the content address are `conflict`; a vanished file is
  `missing-asset`. Externally modified bytes are never returned.
* Loading does not verify digest history or repair it: a missing `versions/<revision>.json` is not
  reported by `loadCheckpoint`.

## 6. Limits

| Bound | Value | On excess |
|---|---|---|
| Manifest / version record | 64 MiB | `invalid-input` when encoding; `conflict` when an existing file exceeds it |
| Single PNG asset | 512 MiB | `invalid-input` from the reader; `conflict` for an oversized existing file |
| Decoded pixels per asset | sharp's default input limit (268,402,689 px) | `invalid-input` |
| Shots (active + parked) | 100,000 | `invalid-input` |
| Images (retained included) | 100,000 | `invalid-input` |
| Layers per image | 4,096 | `invalid-input` |
| Dialogues | 500,000 | `invalid-input` |
| Width/height (image and layer) | 1 … 100,000 | `invalid-input` |
| Single text field | 1,048,576 UTF-16 code units | `invalid-input` |

These are the numbers in `limits.ts`; the table and the code must change together.

## 7. Root and path policy

* The root must be an absolute path to an existing, **canonical** directory. A symlink, a path that
  is really an alias (e.g. macOS `/tmp` instead of `/private/tmp`) or a non-directory is
  `invalid-input`; a root that does not exist is `invalid-input` for a save and `not-found` for a
  load.
* Store, asset and version directories must be real directories. A symlink or plain file in one of
  those places is `conflict` and nothing is ever written through it.
* Asset and version file names are derived from validated values (64 lowercase hex digits, a
  nonnegative safe integer), so traversal is structurally impossible; the loaded reader also
  rejects any id that is not 64 lowercase hex characters.
* Existing files are opened with `O_NOFOLLOW` where the OS provides it and are required to be
  regular files (lstat before and fstat after opening, identity and size compared across the read).
* Temporary files are randomly named in the destination directory and created with `O_EXCL`, so
  they cannot collide with, or be confused with, a file from another run.

## 8. Error codes

| Condition | Code |
|---|---|
| Malformed project/manifest structure or values, unknown fields, bad ids, bad dimensions, unreadable or truncated PNG | `invalid-input` |
| Recognisable document of another schema or version | `unsupported-version` |
| Required asset file absent | `missing-asset` |
| Existing bytes contradict their content address; project id, revision or recorded revision content conflict; unsafe pre-existing entry (link, non-regular file, aliased directory) | `conflict` |
| No store directory or no manifest to load | `not-found` |
| Filesystem or durability failure, including an unverifiable cleanup | `io-failure` |

## 9. Durability, atomicity and platform differences

* The head is replaced by `rename` within one directory: readers see the old file or the new file.
  File contents are flushed before the rename; on POSIX the directory entry is flushed after it.
* **Windows is untested.** On `win32` the directory flush is skipped (a directory cannot be opened
  as a file), so a `rename` can be lost in a power failure even though the data was flushed. The
  rename maps to `MoveFileEx(MOVEFILE_REPLACE_EXISTING)`; whether it can fail while another process
  holds the target open is not verified.
* Assets and version records are published with a hard link, which requires a filesystem that
  supports links (APFS/HFS+, ext4, NTFS). On a filesystem that refuses links (FAT/exFAT, some
  network shares) the save fails with `io-failure`; there is deliberately no copy fallback,
  because a non-atomic create would make a partial blob look published.
* **No universal power-loss durability is claimed.** Asset directory entries are now flushed after
  every admission (including reuse/retry), before version/head publication. The version directory
  is flushed after a new record is linked, and the store directory after the head is renamed.
  Windows skips directory flushes. Ancestor creation, device caches and filesystem behaviour are
  not proven power-loss safe; tests inject sync errors but do not simulate power loss.
* `O_NOFOLLOW` is not available on Windows, where only the `lstat` checks guard against links.
  Case-insensitive filesystems do not affect this layout, whose names are fixed lowercase.
* Verified on macOS 26.6.2 (arm64, APFS) with real files. No Windows, network-filesystem or
  removable-media run has been made; unit-level platform branches are not OS acceptance.

## 10. Concurrency

* Within one process, saves to the same canonical root are serialized by an in-process queue; that
  covers multiple `ProjectStoreV1` instances. Independent roots proceed independently.
* **Multiple processes writing the same root are not supported and not defended against.** There is
  no lock file and no cross-process claim; the last head rename wins. Content-addressed assets and
  create-once version records are still never overwritten, so the damage of a second writer is
  limited to a conflicting head, reported as `conflict` on the next save.

## 11. Module scope

The store writes checkpoints and immutable PNG assets. Session and the application runtime
wire it into autosave and Close; TIFF output, original-image preservation and Trash handling
belong to other Project Files modules. This store does not provide legacy project migration,
physical asset deletion/GC, watchers, userData/clipboard access, tile storage, SQLite, PSD
storage, partial reads or cross-process writer locking.

## 12. Asset depot

`openFlowAssetDepot(options)` in `depot.ts` implements the `src/platform/contracts/flowWave2.ts`
Interface without changing `index.ts`/ProjectStoreV1. Open copies options before its first await,
binds a canonical root and session id, and loads an existing checkpoint normally. Only a genuine
`not-found` allows an empty initial asset set; malformed/unreadable checkpoints and missing assets
remain errors. Open is read-only and never advances head. Root identity is rechecked at use time.

`put` snapshots input before await, enforces caller PNG-byte/pixel limits (also retaining the
store's 512 MiB ceiling and sharp's default input-pixel limit), computes encoded-byte SHA-256,
checks current dimensions and requires a successfully decoded PNG digest. Individual asset writes
   share a root queue with checkpoint asset checks; checkpoints themselves still publish in order. It creates only the asset namespace/blob, never
head/version records or a provisional Project. At most eight puts per depot retain encoded input
while waiting; excess requests return `busy` before copying bytes.

An operation id is a nonempty string without NUL; it is never used in a path. Within one depot
it is bound to its submitted hash/dimensions once admitted to the root queue, including failed
attempts. Different input conflicts. After a successful put, same-input retries verify the actual
blob before reuse and flush again; a missing/tampered blob fails rather than recreating it or
returning a cached receipt. Receipts are fresh objects and include `directorySync: synced|skipped`.

Reads allow only initial checkpoint references and successful puts of this depot. They recheck
binding/hash and return private copies. A new head or a new depot does not expand an existing
depot's whitelist; old eligible ids remain readable, and a new depot gets its own checkpoint set.
Orphan/failed-admission blobs are retained but cannot be read merely because their path is known.
There is no delete/GC or persistent operation-id promise across depot lifetimes.

Flow failures report typed effect evidence: validation/read failures have no new writes (`none`),
a confirmed linked immutable blob surviving flush failure is `retained`, and unconfirmed write or
cleanup outcomes are `unknown`. No message parsing is used. Failure never grants read eligibility,
replaces a corrupt existing blob, widens permissions or advances checkpoint head. This local
admission is neither a process-wide RAM bound nor an IPC/security or cross-process writer lease.
