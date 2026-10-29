# Checkpoint format — `.storyboard-flow-v2` (wave 1 candidate)

Status: **experimental**. This layout is not activated anywhere in the application. The current
Save/recovery path, TIFF writing and legacy project folders are untouched; nothing reads this
format in production. `electron/core/persistence/index.ts` exports the only public entry point,
`createProjectStore(): ProjectStoreV1`.

## 1. Layout

```
<project folder>/                    caller-supplied root; must already exist, be canonical
└── .storyboard-flow-v2/
    ├── project.json                 head manifest: ProjectV1 as canonical UTF-8 JSON
    ├── assets/<sha256>.png          immutable PNG blob per distinct asset id
    └── versions/<revision>.json     immutable manifest copy per published revision
```

* Directories are created with mode `0700`, files with `0600` (the process umask can only remove
  bits). No other file or directory is created; nothing outside `.storyboard-flow-v2/` is written.
* `assets/<sha256>.png` is the encoded PNG byte-for-byte, and `<sha256>` is the lowercase hex
  SHA-256 of exactly those bytes (the `AssetIdV1`). There is one file per distinct asset id, even
  when many layers and images share it.
* `versions/<revision>.json` is **byte-identical to the manifest of that revision**. Head and
  history are separate copies on purpose: `project.json` is replaced on every publication, while
  `versions/` is append-only. A revision record is written once and never rewritten.
* The store keeps every asset and every version record. **There is no garbage collection, no
  pruning and no repair in wave 1**: an asset no longer referenced by any shot stays on disk, and a
  record left by an interrupted save stays on disk and keeps its meaning.
* Leftover `*.tmp` files (see §4) are never deleted, reused or interpreted by any later run.

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
4. **Store directories** — `.storyboard-flow-v2/`, `assets/`, `versions/` created or verified as
   real directories. A symlink or non-directory with one of those names is `conflict`.
5. **Existing head** — read, parse and fully validate. An unreadable or invalid head is never
   overwritten (`conflict`). Then: different project id → `conflict`; lower revision → `conflict`;
   equal revision with different logical content → `conflict`; equal revision with identical
   content → no-op (nothing is rewritten and the receipt is returned).
6. **Assets first**, in ascending asset-id order: the reader's bytes are copied and hashed, the
   hash must equal the claimed id, and the PNG must be decoded and must match the dimensions that
   **every current reference** declares. That decode and dimension check runs for an asset that is
   already stored as well: the digest proves the bytes are unchanged, never that a new descriptor is
   correct, so a reused blob is checked exactly like a new one (once per asset per save). A missing
   file is written as `<asset|version|project>.<24-hex>.tmp` and published with a hard link, so a
   partially written blob never appears under its final name and an existing blob is never replaced.
   An existing file is verified by digest, not trusted by name.
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
* Loading is strict by design in this wave; a lenient read-only partial view is future work.
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
* **Directory flush coverage is not uniform, and no power-loss durability is claimed.** The version
  directory is flushed after a version record is linked, and the store directory after the head is
  renamed; the `assets/` directory is *not* explicitly flushed after a new blob is linked. A crash
  immediately after a save could therefore keep the head (and its flushed directory entry) while
  losing a just-linked asset entry, which a later `loadCheckpoint` would report as `missing-asset`.
  These tests do not simulate power loss, so this remains an open durability question for review —
  not a guarantee. Reported as a limitation rather than changed in this correction.
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

## 11. Not implemented in wave 1

No production Save/Close wiring, no TIFF or original-image writing, no legacy project migration, no
physical asset deletion or garbage collection, no watcher, no Trash/userData/clipboard access, no
tile storage, no SQLite, no PSD data, no lenient partial read view, and no cross-process locking.
