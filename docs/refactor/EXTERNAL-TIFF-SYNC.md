# External TIFF synchronization — target design

Status: design approved in principle by the user; implementation is staged. The
observation, reconciliation and native-ID codec foundation has focused/build evidence
and fixed-candidate full/build/GUI regression evidence in
[the foundation report](reviews/2026-10-31/G3-EXTERNAL-SYNC-FOUNDATION.md). No automatic adoption or production routing is enabled. The codec now writes native
layer IDs and Flow rasterVersion 2; application synchronization is not connected.

## Product rules

The user approved separate external artwork, Flow-created drawing and project text.
Non-conflicting external artwork updates should preserve local drawing and document
properties. Ambiguous or conflicting external versions become Pending alternatives,
with a visible explanation; do not discard either version. Refresh and conflict import
participate in Session Undo. Pending output still materializes only on explicit Save.

Project order, membership, name, naming settings, dialogue and script text remain
project-owned. TIFF text is useful on initial folder import, but is not authority to
replace existing project text during refresh. A text edit alone is not a pixel conflict.

Layer origin describes where a layer was created, not who can subsequently edit it.
An artist may edit a Flow-exported layer in Photoshop or an imported layer in Flow.
Compare actual changes against a shared baseline rather than assuming origin wins.

## Evidence and gaps

The designer's supplied PD2 analysis describes source-image Sync, separate drafts,
separate document properties and manually confirmed repository versions. Its function
names/strings are evidence for those mechanisms, not verified pseudocode for every
simultaneous-edit case. No claim that Flow must reproduce unspecified PD2 behavior.

Current code findings:

- `LayerV1.kind` is a drawing role, not provenance. Do not reinterpret `paint` as
  proof of local origin; external TIFFs can contain many paint layers.
- The previous codec associated XMP identity with raster layers by array index.
  Equal counts do not prove identity after external reordering. This must not authorize
  automatic refresh. Layer names are not identity either (duplicates/renames are legal).
- Bundled psdtags supports Photoshop's per-layer `lyid` record. The codec now
  supports that record without installing a dependency, but
  actual preservation through Photoshop Save must be verified with synthetic media.
- The output observer currently compares the whole encoded logical input. That is
  conservative detection only; it must not become the final image-conflict classifier.
- Before first Save, folder import retains decoded assets but may not retain original
  TIFF bytes. If an external app replaces those bytes, a later original-backup check
  cannot recover them. This requires an explicit source-preservation change, not a
  bypass of the existing original digest check.

## State and ownership

Keep three distinct values per bound image:

- **Baseline B:** last image version successfully accepted from, or published to, its
  bound TIFF; retain layer identity, dimensions, compositing properties and asset hashes.
- **Local L:** the current editable ImageDocument in Session, including local additions.
- **External E:** a stable decoded candidate from the observed TIFF bytes.

Layer IDs are stable across rename/reorder. Project-owned layer provenance and a
mapping to supported TIFF layer IDs must be serialized and validated; their edits must
survive history/checkpoint/clone paths. No alternate mutable project in the renderer.

Output observations and physical publication receipts belong to Main's output ledger.
They are not rewound by Session Undo: Undo changes the desired project state; a later
explicit Save publishes it. Image history and output history must not be conflated.

## Reconciliation rules

Use semantic image comparisons (asset digest, dimensions and layer properties), not
image/project revision numbers, file timestamps or project text. File stat signatures
only avoid unnecessary rereads; no timestamp or cached result authorizes replacement.

| B → L | B → E | Result |
| --- | --- | --- |
| No image change | Recognized supported change | Adopt external image change |
| Local new drawing layer | Existing external base changes, correspondence/order certain | Update base and retain local layer once |
| Layer A changed | Different layer B changed, correspondence/order certain | Compose those distinct layer changes |
| Same layer changed on both sides to the same semantic value | Same value | Keep one copy |
| Same layer changed differently, or delete versus edit | Conflicting | Keep L; preserve E as Pending alternative |
| No external semantic change | Local image change | Keep L; no duplicate Pending |
| Missing/duplicate identities, flattened previously layered output, uncertain order | Unknown | Preserve E as Pending if faithfully decodable; otherwise report unsupported and retain source |
| Canvas dimensions change with local drawing | Alignment unknown | Preserve both; no guessed scaling/alignment |

Initially treat each changed layer as a whole; do not invent a pixel merge or merge
conflicting properties within one layer. Order and canvas changes are explicit image
changes. Independent additions are composed only when placement is unambiguous; do not
silently append a layer whose blend position changes the intended image.

Newly created local layers not yet exported have no external counterpart. Conversely,
a Flow layer that was exported is already represented in E and must not be overlaid
again. Missing XMP is not permission to guess from names or positions.

A plain initial source with a single known base can be refreshed beneath unexported
local drawing if identity and dimensions remain unambiguous. Once a layered output is
flattened externally, that shortcut no longer applies.

## Import, Save, refresh and Undo lifecycle

1. On initial import, preserve a byte-exact source snapshot inside the prepared project
   namespace before publishing it. Account for source bytes as well as decoded assets
   in admission/disk budgets. Do not retroactively claim unavailable originals exist.
   Decide the precise relationship to the existing first-Save backup before changing
   that path; old tests expecting no pre-Save backup need an explicit contract update.
2. Save records B only for outputs actually published and acknowledged. Keep an image
   baseline separate from the full TIFF content signature, so text edits remain cheap.
3. Refresh observes only bound active/Pending sources. Removed shots are not resurrected;
   new unrelated files, external renames and source relinking remain separate workflows.
4. Decode/admit a stable external candidate into immutable assets with bounded budgets.
   Capture the observed digest and Session incarnation. No filesystem paths from renderer.
5. Produce a pure reconciliation plan from B/L/E. Revalidate L and the observed source
   before applying; an intervening edit, Save, switch or newer external write invalidates
   that plan. Apply one reversible Session history action, preserving document metadata.
6. The new state and any Pending alternative must be durably checkpointed before the
   output ledger accepts the external digest as the current source baseline. Couple
   acceptance to the exact candidate/checkpoint receipt; an arbitrary renderer digest
   is not authority. Recovery must recognize completed acceptance without re-importing.
7. For conflicts, accepting the external digest is safe only once the external version
   is durably retained. A later Save can write L back to its root TIFF and the alternative
   to Pending. No source write occurs merely because Refresh ran.
8. Undo restores the pre-refresh desired image state and removes the Pending alternative
   from current membership as one action. Retained assets stay available. Undo itself
   never writes external TIFFs; explicit Save still performs publication.

Repeated inspection of the same external version must not create repeated alternatives.
The accepted digest is tied to durable retention, not a dismissible UI notification.
Source snapshots, alternative assets and failed-operation evidence have no automatic GC.

## Small module interfaces

- **Formats:** decode/encode raster plus proven portable layer correspondence; return
  identity confidence explicitly. No project mutation, path ownership or refresh policy.
- **Reconciliation:** pure B/L/E → unchanged, replacement plan or conflict reason.
  No filesystem, codec or UI dependencies. This is the main policy test surface.
- **Main refresh coordinator:** bounded observation/preparation/acceptance, bound to the
  current runtime and existing output serialization; hides source and ledger paths.
- **Session:** validate/admit a plan against current state; one history entry and normal
  checkpoint lifecycle. Never expose unrestricted project replacement as a shortcut.
- **UI:** manual Refresh first, concise updated/conflict/unsupported feedback. Focus-based
  auto-sync follows connected verification and performance measurements. Coalesce checks;
  if consistently slow, offer manual mode instead of overlapping scans or blocking input.

These are module responsibilities, not a requirement to create one file per bullet.
Extend existing modules where they already own the state; avoid duplicate ledgers or
queues with competing authority.

## Implementation sequence and completion evidence

1. Finalize provenance/baseline contract and source preservation. Verify native TIFF
   layer IDs through a bounded codec experiment; do not promise all Photoshop formats.
2. Implement the pure planner: no-op, clean refresh, retained local layer, external edit
   of an exported Flow layer, same-layer conflict, deletion, reorder, flattening,
   dimension change, text-only local edits and identical semantic versions.
3. Connect Main preparation/acceptance and one Session history operation. Test stale
   plans, checkpoint failure, retry/reopen deduplication, Pending, partial Save and Close.
4. Add manual Refresh and real connected synthetic TIFF edit → refresh → Undo → Save →
   reopen tests. Run the full approved suite and complete build on a fixed candidate.
5. Actual Photoshop roundtrip and representative many-image measurements precede any
   claim of automatic seamless Photoshop compatibility. Windows remains a separate gate.

No current slice enables PSD-first workflows, pixel merging, default production routing,
SQLite, new dependencies, source migration or deletion of retained project data.

## PD2 follow-up and the Flow decision

The user supplied the designer's follow-up: PD2 commits draft pixels as layers into
TIFF, then clears the transient draft stack to avoid displaying the same content twice.
Its explicit Restore Sketches path recovers archived raster drafts. The assertion that
normal Undo does not restore the disk TIFF remains a strong inference from the cited
methods/strings, not observed executable behavior.

Flow adopts the single-visible-instance invariant, not destruction of editable drafts.
The internal layered image remains the editing authority; Save publishes a TIFF view
of that image and records its baseline. A refreshed exported layer maps onto its existing
identity, never an extra overlay. Local layers added since that publication remain local.
Keep the already approved Undo → explicit Save workflow; do not introduce irreversible
commit or clear the current layer/history stack merely to imitate PD2.

## Development evidence (not integration acceptance)

- Read-only output observation: 23 focused tests and complete build passed, development-stage evidence (now committed, still unwired); `/tmp/flow-external-focused.log`, `/tmp/flow-external-build.log`.
- Pure reconciliation policy: 13 tests passed; `/tmp/flow-reconcile-focused.log`.
  Complete build also passed: `/tmp/flow-reconcile-build.log`. These tests exercise
  policy using already validated image documents, not proof of format identity.
- Bounded native layer-ID experiment using existing psdtags: IDs survive TIFF
  write/read, duplicate names, reorder and rename, with ID-to-pixel correspondence
  preserved even without XMP. Evidence:
  `/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-layer-identity-bk1izb4k/receipt.json`;
  generator `/tmp/flow-layer-identity-probe.py`. Synthetic library roundtrip only,
  no actual Photoshop process and no application codec changes.
- The foundation full-suite/build and 74 existing GUI regression scenarios now pass;
  connected refresh UI, crash/retry acceptance and real Photoshop roundtrip remain
  NOT RUN. No automatic synchronization is enabled.

## Native identity foundation

New output writes `rasterVersion: 2`. Each raster layer has one positive signed-32-bit
Photoshop `lyid`; the XMP layer record maps that number to its Flow ID/kind/exact opacity.
Native IDs derive deterministically from the stable Flow layer ID, independent of layer
name/order. A collision within the image refuses encoding; it never silently shares IDs.
Reordered raster records map through native IDs rather than stale XMP positions.

Decode reports `portable` for complete matching v2 maps, `native` for unique complete
native IDs without Flow XMP, and `unverified` for plain or old positional inputs. The
last category cannot authorize automatic layer reconciliation. Legacy v1 identity reads
remain available for import, but are explicitly unverified. Duplicate native IDs,
missing/unknown v2 correspondence and count mismatches refuse rather than guess. Existing
unsupported compositing/XMP rules remain intact; this is not full Photoshop fidelity.

The pure planner is not a trust boundary: its inputs must already be validated/admitted,
and its identified flag must come from verified baseline correspondence. Merely being
`native` does not prove correspondence with any arbitrary project. Main must bind the
source, baseline and candidate before calling it. `localOutputChanges` in observation
includes text and is diagnostic only; it must not drive image-conflict policy.

Scoped independent review found native-only decode inferred layer kind from array
position, which made reorder look like a layer edit. Generic imported layers now use
a stable `image` kind unless Flow metadata supplies a kind. Regression combines local
pixel edits with external native-only reorder and verifies one combined result.
