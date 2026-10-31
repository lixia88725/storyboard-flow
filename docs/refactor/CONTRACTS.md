# Wave-1 contracts

Authority: this document plus `electron/shared/refactorV1.ts`. Coordinator-owned.
Module = implementation behind an Interface; the Interface includes ordering, failure and
performance semantics, not just TypeScript declarations. Test through the same Interface used
by callers. Keep private seams private; do not add an abstraction for an imaginary future implementation.

## Current naming extension — 2026-10-31

The user retained existing scene/artist/version naming settings. ProjectV1 may include
`naming: { sceneCode, artistName, version }` (exact string fields, unknown fields rejected).
`setProjectNaming` changes project name/settings as one undoable Board edit. New TIFF
imports initialize naming; absent naming remains absent in low-level checkpoints. See
[SAVE-NAMING.md](SAVE-NAMING.md) for explicit-Save output behavior and failure semantics.
The wave-one baseline below otherwise remains unchanged.

## Data rules

- ProjectV1 is a new candidate, unrelated to the legacy Project V1. No old project loader,
  format migration or production auto-conversion is implemented in this wave.
- All IDs are nonempty ASCII `[A-Za-z0-9_-]{1,80}` except assetId: lowercase 64-character SHA-256
  of the encoded PNG bytes. The persistence adapter verifies the hash; drawing treats it as a reference.
- Revisions are nonnegative safe integers. A changed image edit increments image revision once.
  A changed storyboard edit increments project revision once. A no-op increments neither.
- Image dimensions and layer dimensions are positive integers; wave 1 layers match canvas size.
  Layers are ordered bottom-to-top and have unique IDs within their image. At least one layer
  remains. Opacity is finite in [0,1]. Supported blend modes are normal, multiply and screen.
- Shot IDs are unique across active and parked arrays. Each shot references exactly one existing
  image; wave 1 does not share one editable image between shots. Array order is authoritative.
- Dialogue IDs are unique across the project; their shot must exist, active or parked. Array
  order determines dialogue order for a shot. Text remains Unicode and is not silently normalized.
- Retained unreferenced images may remain after deletion for history; UI/export uses active
  shots only. No physical asset deletion or garbage collection in wave 1.
- Unknown schema versions return unsupported-version. Unsupported fields must not be silently
  lost by a read/edit/save path: reject unsupported structure where needed. No speculative migration.
- No absolute paths, DOM objects, data URLs or typed pixel buffers in ProjectV1. No generic
  metadata bag for future PSD data. Missing existing-feature fields are documented for wave 2,
  not evidence that feature parity has already been achieved.

## Drawing entry point

`src/core/drawing/index.ts` exports:
`applyImageEdit(image: ImageDocumentV1, edit: ImageEditV1): ResultV1<ImageEditResultV1>`.
Input is never mutated. `before` is the supplied version; `after` shares unchanged immutable
data where safe. Identical property values or moving a layer to its current position are no-ops.
Index means final array index after removal for moveLayer, insertion index for insertLayer.
Invalid indices, duplicate IDs, malformed assets and values return invalid-input.
Missing layers return not-found. Removing the final layer is invalid-input.
Locked layers refuse pixel replacement and removal; visibility and the lock toggle remain
editable. For other layer-property/reorder behavior, inspect current shared rules and document
the preserved policy; request a contract decision for any material ambiguity.
`visualChanged` is true for pixels, visible composition properties, insertion/removal/reordering;
name/lock-only edits do not invalidate the rendered image. Safe conservative invalidation is
allowed; claiming unchanged pixels without evidence is not.

This wave establishes the image-document edit boundary, not a replacement brush algorithm.
Produce a drawing extraction map for existing brush/eraser/selection/blur/rendering entry
points; their real pixel behavior will be moved behind this boundary in wave 2.

## Storyboard entry point

`src/core/storyboard/index.ts` exports:
`applyStoryboardEdit(project: ProjectV1, edit: StoryboardEditV1): ResultV1<ProjectEditResultV1>`
and a project history facade with `current()`, `apply(edit)`, `undo()`, `redo()`.
Define/export a local history Interface with ResultV1 results and an explicit maxEntries option.
No independent per-image undo stack. Inputs remain immutable; failure/no-op adds no history.
New edits after undo clear redo. History snapshots retain asset references, not pixel bytes.
Undo/redo restores content with a NEW monotonic project revision (never reuse an old revision);
image content revisions may be restored from the saved snapshot. New image edit baselines must
still match the current image content, not merely a historical revision number.

- moveShots keeps moved shots' current relative order (active order then parked order), removes
  them from both arrays, inserts before beforeId in destination or appends when absent. beforeId
  must belong to destination and not be moved. Duplicate/unknown input IDs are invalid.
- insertShot requires new shot and image IDs and an in-range active insertion index.
- removeShots removes membership and associated dialogue records, retaining image records.
  This is an internal model operation, not permission to delete TIFFs or assets.
- setDialogues replaces that shot's dialogues at its first existing dialogue position, or at
  the end if none; entries must target that shot and must not collide with other dialogue IDs.
- applyImageEdit validates that result.before matches the currently installed image completely,
  result.after is valid for that ID and expected revision, and change flags are consistent.
  Reject stale or fabricated result shapes with conflict/invalid-input. A boolean is not authority.
- ChangeSetV1 reports affected IDs and semantic changes; no view-specific dirty flags.
- Preview/onion-skin lookup selects neighboring active shots by IDs; drawing consumes the
  returned image references. No new playback policy or preview renderer is needed in wave 1.

## Persistence entry point

`electron/core/persistence/index.ts` exports `createProjectStore(): ProjectStoreV1`.
Only synthetic, explicitly new roots are used. The candidate layout is:
`.storyboard-flow/checkpoints/project.json`, `assets/<sha256>.png`, `versions/<revision>.json` within that
directory. This is the unified Flow namespace with a checkpoint role subdirectory; do not activate it in production or change old folders.
The exact manifest is ProjectV1 encoded as UTF-8 JSON. Required assets are ALL images in the
snapshot, including retained images. Prior versions and assets are retained; no automatic cleanup.

- saveCheckpoint writes/verifies immutable assets first, retains the immutable version record,
  then publishes project.json through an owned temporary file. Snapshot caller-owned data before
  the first await so mutations after submission cannot change the acknowledged version.
- Existing assets are verified, not blindly trusted by name. Missing/invalid/hash-mismatched PNG
  data fails without publishing a new head. Check decoded dimensions against layer descriptors
  using existing sharp; do not claim universal PNG/parser hardening.
- Existing head must have the same project ID. Lower revisions conflict; an equal revision is
  idempotent only for identical logical content, otherwise conflict. Calls to a root serialize
  across store instances within the process; independent roots may run independently. No
  cross-process concurrent writer support is claimed in wave 1.
- Keep canonical root binding and reject traversal/symlink escapes, unsafe pre-existing temp
  paths and inconsistent files. Do not chmod originals or weaken permissions on errors.
- On failures, report a typed error and retain evidence; do not return a receipt before final
  publication succeeds. Describe crash/replacement guarantees accurately per platform.
- loadCheckpoint validates schema and references; missing required assets returns missing-asset.
  In this low-level wave strict loading is intentional; the future read-only partial project
  view is separate and not yet implemented. readAsset verifies binding/integrity at read time.
- No TIFF output, rename sync, Trash, watcher, UI, old recovery rewrite or source-folder writeback
  yet. Test the ownership/publication boundary before adding those effects in wave 2.
- Internal fault-injection seams are permitted for tests, but do not expose them in the public
  production Interface. Test real temporary filesystem behavior as well as injected faults.

## Deferred decisions

Final on-disk pixel representation, tile storage, SQLite, raster engine language and PSD support
are not decided by this contract. No agent expands this wave to solve them. Current gesture feel,
matte/dialogue overlays, selection state, naming and complete existing-feature parity remain
coordinator-owned integration requirements after these foundations are reviewed.
