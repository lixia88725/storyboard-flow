# Flow PhotoCraft bridge

This is an isolated integration candidate. It reads TIFF/PSD through PhotoCraft's
`io`, `doc`, `compose` and `cms` crates. Existing Flow pixel tools operate on basic
raster layers or new drawing layers above a protected source display. Explicit
“另存为 PSD…” appends those new drawing layers to a retained RGB8 PSD file model.
It is a limited export, separate from normal project Save.

Upstream: https://github.com/storytold/photocraft/tree/a259993118ac7ce1d4c828a385abbc3191841e86
(version 0.20.1; MIT OR Apache-2.0). The source is an ignored local dependency at
`vendor/photocraft`; no user media belongs there. `Cargo.lock` pins the resolved
Rust graph, including craft-libs commits `c5a1cbfb…` and `b8f7d93b…`.

## Build locally

Requires the fixed Rust 1.99.1 toolchain (upstream minimum 1.95), Node and the
existing Flow dependencies:

```sh
npm run setup:photocraft
npm run build:photocraft
npm run build
```

Dependency preparation is explicit; startup and normal JS builds never install
Rust or download dependencies. A task-local Rust installation can use independent
`RUSTUP_HOME` / `CARGO_HOME` and a command-scoped `PATH`; do not modify shell
profiles. The reader binary can be selected with `FLOW_PHOTOCRAFT_BIN`.

The build checks the actual `rustc` version/host, uses `--locked --all-targets`
and an explicit native target, and includes the synthetic fixture example used
by the enumerated tests. It emits `target/debug/build.json` binding source bytes,
upstream/toolchain/target, executable digest and every bundled license digest.
Local builds never install Rust automatically. For the existing task-local
installation, prefix commands with its independent `RUSTUP_HOME`, `CARGO_HOME`
and command-scoped `PATH`.

The test and package CI jobs now prepare isolated Rust dependency homes, install
1.99.1, prepare the fixed source and build the native component before use. The
test job retains its single-worker, 4 GiB Node heap budget and explicit suite.
Package targets are `aarch64-apple-darwin` and `x86_64-pc-windows-msvc`.
The Windows leg checks preinstalled MSVC x64 tools and requests a static CRT
with `+crt-static`;
it does not install system libraries. Upstream has a Windows-native CI leg.
The selected headless dependency graph has no GTK/Wayland/AVIF/dav1d dependency;
`blake3` does carry a `cc`/MSVC build dependency. Windows-specific resolved Rust
notices are included. Dependency inspection is not a successful Windows compile:
real Windows runner compilation, execution and release ZIP testing remain pending.

## Bridge and limits

The one-shot binary receives one private job directory containing protocol-1
`request.json` (`format: tiff | psd`) and `source.bin`. The explicit
`export-psd` operation instead receives the captured canvas dimensions, drawing
layer properties, `base.png`, numbered layer PNGs and the retained `source.bin`. It writes numbered PNGs
and `response.json`. A response binds the fixed upstream commit, dimensions,
layer properties, display-reference flag and compatibility warnings. No user
paths cross the bridge. Main validates all output PNGs and its version, serializes
native reads, and kills/reaps a timed-out process before returning. Failed jobs
are retained with an error naming their location; successful private jobs are
removed. Relative scratch files stay inside the job.

Limits: 128 MiB source; 8192px dimensions; 16 Mi aggregate admitted layer pixels;
64 source layers; 32 MiB PNG; 512 MiB PSD import estimate; 256 MiB flat decode;
60s process timeout; two compositor threads. These are admission and decode
bounds, not a total process RSS guarantee. Multipage/incomplete TIFF, damage,
missing display caches and unclassified loss warnings fail explicitly. Unequal
resolution is a nonfatal notice. Linked source files are not supplied to the
worker. No image data is sent over the network.

Basic RGB8 stacks require normal/multiply/screen, no masks/groups/effects or
unmodelled layer blocks, sRGB-equivalent color, and room for one drawing layer.
Other readable content becomes a protected display reference. RGB composites
are ICC-converted to sRGB; CMYK/Lab/gray go through PhotoCraft's model-aware
compositor; CMYK requires an embedded, usable bidirectional CMYK ICC and cannot
silently fall back to a generic coated profile. Custom ICC on other non-RGB
models is conservatively refused pending verified conversion coverage. PSD merged pixels and independently decoded TIFF composites are
checked against layers. When they disagree, the stored composite is explicitly
used as a protected display, and its original layers remain in retained bytes.

## Retention and editing

`LayerV1.sourceReference` contains `originalId`, `digest`, `format`,
`previewPixels` (RGBA SHA-256). It reuses the existing project ledger and first
snapshot at `.storyboard-flow/originals/<originalId>.tif`. The historical suffix
also contains PSD bytes; `format` records the actual signature. No new retention
copies, alternate external paths or cleanup policy are introduced.

Core editing refuses unlocking, visibility/name/opacity/blend changes, moving,
removing, copying as an ordinary layer, merging, transforming or replacing the
reference pixels. Normal new layers and their pixel tools remain editable.
Board membership/removal and complete project-folder copies retain originals.
Runtime open/Save/checkpoint/close validate the ledger, original format/hash,
canonical no-follow file reads and display RGBA. Refresh refuses a changed or
stripped reference instead of installing it as an ordinary external layer.

Save creates a **new Flow TIFF**, preserving the source as retained bytes. It
never overwrites the imported complex source. Confirmation and a persistent
workbench note state that the TIFF is not a round-trip of the complex source.
The separate PSD export supports only a bottom protected PSD reference with
new Flow paint layers above it, PSD version 1, RGB8, no extra alpha/spot channels
and an sRGB-equivalent ICC (untagged sources are assumed sRGB). Non-sRGB drawing
assets, unsupported source dependencies/depth/mode, inconsistent source-layer
composition, TIFF complex sources, presentation matte/dialogue and changed
retained bindings are refused before the destination picker. No source bytes or
user pixels are silently flattened to make this export pass.

The original PSD file model retains its original layer records, encoded channels,
unknown blocks and resources. New layers carry order, names, visibility, lock,
normal/multiply/screen and PSD-precision 8-bit opacity. Merged image and thumbnail
resources are regenerated and checked against the captured Flow image; retained
structures are rechecked after serialization. Main owns the file chooser and
publishes only to a new canonical PSD target using a synced sibling temporary
file and exclusive hard link. Existing targets are always refused; ambiguous
publication returns an explicit unknown result with retained evidence. Export
does not change the project, ordinary TIFF output or the first retained source.

Protection is stored in a v3 Flow TIFF envelope. Older codecs reject v3; older
checkpoint validators reject the new field. Existing projects without the field
still use v1/v2 behavior. No migration of user projects is performed. Presentation
matte/dialogue exports for references are currently refused explicitly.

`npm run prepare:package-resources` requires the matching built native binary,
source receipt and complete license inventory. Missing, stale, wrong-target or
changed components fail before replacing prepared resources. Both packaging
recipes verify native resources and the final ZIP validator checks actual Mach-O
arm64 / PE x64 headers, fixed receipt identity, executable and license digests.
macOS ad-hoc signing updates a separate packaged executable digest; the original
build digest remains recorded. Release publication retains its existing explicit
gate. No remote workflow or release was triggered for this candidate.

Local macOS package preparation, signing and ZIP validation are exercised.
Windows/native-runner behavior remains unverified; broad PSD support is not
certified by the package contract. PSD exclusive publication uses the existing
platform directory-sync contract: Windows skips unsupported directory fsync after
the file itself is flushed. This avoids a deterministic post-link error, but does
not claim directory-entry power-loss durability or replace actual NTFS testing.

## Verification

Use the explicitly enumerated `test/allowed-suite.json`, normal `npm run build`,
and `npm run check:preload`. The native fixture example generates only synthetic
sources. The isolated Electron smoke is:

```sh
node scripts/flow-photocraft-smoke.mjs [authorized-read-only-TIFF]
```

It uses a fresh temporary directory, distinct userData, stubs clipboard/Trash,
reads an optional authorized sample once into its private inputs, exercises the
real launcher/import confirmation, drawing, Save, normal close and reopen, and
checks source hashes. Independent PSD checks use `scripts/flow-psd-export-oracle.mjs` with an explicit
`FLOW_PSD_ORACLE_DIR` pointing to a separately installed psd-tools/Pillow oracle.
It compares original layer records/channels/unknown blocks, new-layer properties,
raw pixels, merged preview and independent recomposition. The real UI export
check is `node scripts/flow-psd-export-smoke.mjs` (synthetic sources only).

For an explicitly authorized macOS native check, with zero Photoshop documents
open, run `node scripts/flow-psd-photoshop-check.mjs <oracle-temp-root>`. It only
accepts the generated 4x2 oracle fixtures, creates fresh temporary outputs,
checks source hashes and closes only its own documents. It restores its temporary
dialog mode and never changes color settings or quits Photoshop.

Native Photoshop 27.6 was additionally exercised on six 4x2 synthetic exports:
normal/multiply/screen, a hidden layer, transparent source, and embedded sRGB.
Groups/new layers, visibility, opacity and blend modes loaded correctly; native
PNG renders differed from captured expected pixels by at most one channel level.
Photoshop-saved PSD copies reopened with their groups and layers. The check
started/ended with zero documents and changed no source files or color settings.
This evidence does not certify arbitrary real PSD effects, text, smart objects,
large documents, Windows or complex TIFF-to-PSD mapping. Same-codec round trips
alone do not establish Photoshop compatibility.

## Hosted engine (isolated Flow trial path)

`flow-photocraft-host` is a separate persistent binary. The existing reader/export
binary and normal Flow entry remain separate. The isolated native workspace
uses this host for editing and output; current integration evidence is in
`docs/CURRENT.md`. It admits one active document per host and the verified
RGB8 raster/group PNG/JPEG/TIFF/PSD paths
(up to 8 MiB source, 8192 px side, 16 Mi canvas pixels, 64 layers and 512 MiB
materialized native surface bytes). These are admission bounds, not a process RSS
limit or certification of arbitrary PSD/TIFF structures.

Before an explicit native build, apply the digest-bound fixed-upstream patch:

```sh
python3 native/photocraft/apply-host-patches.py
cargo test --locked --offline --manifest-path native/photocraft/Cargo.toml --all-targets
RAYON_NUM_THREADS=2 python3 native/photocraft/tests/host_process.py native/photocraft/target/debug/flow-photocraft-host
RAYON_NUM_THREADS=2 python3 native/photocraft/tests/host_bench.py native/photocraft/target/debug/flow-photocraft-host
```

Use the explicitly prepared 1.99.1 toolchain with task-local `RUSTUP_HOME`,
`CARGO_HOME` and command-only PATH. No setup or build installs dependencies.
The patch helper verifies four enumerated upstream files and their before/after
SHA-256 values; it refuses unrelated dependency changes. The host must not be
packaged until setup/build, binary receipts, full dependency notices and target
verification are integrated by the coordinator.

Wire framing is `u32le headerLength`, `u32le payloadLength`, UTF-8 JSON header,
then raw bytes; 64 KiB header / 64 MiB payload caps are checked before allocation.
The host first emits a `hello` with protocol 1, a numeric safe `workerEpoch` and
its object verification policy. Requests carry `requestId`, `sessionId`,
`incarnation`, `workerEpoch`, `operationId`, nullable `baseVersion`, and a typed
`body.kind`. Invalid framing terminates the channel; command failures are typed
responses. stderr is independent of framed stdout.

`new`/`open`, typed `edit`, or `strokeBegin` → ordered `strokeAppend` →
`strokeFinish` prepares an immutable candidate. `open` consumes only budgeted
retained bytes and `{digest,byteLength,formatHint}`; `digest` is SHA-256 and the
format hint is not a certification. It never receives an external source path.
The first sample has sequence 1; `fromSeq` must equal the next unaccepted sample,
`throughSeq` must match the exact finishing prefix. Appends are volatile preview
ACKs, not durable input receipts. Main must preserve input before sending it.

A `prepared` response is returned only after file-flushed native objects, the
object directory barrier, the immutable version manifest, and the operation
receipt are durable. Flow then checks its own project base and calls `accept` or
`discard`. Only one candidate/gesture is admitted at a time in this prototype.
Duplicate operation IDs bind to the original session/base/body fingerprint;
status queries expose durable prepared/accepted/failed/intent states. An
intent-only outcome is unknown and is not replayed. `abandon` explicitly retains
and retires recovered private evidence; it cannot undo an accepted operation.
`freeze` refuses unresolved operations/gestures; `close` requires freeze.

`load` opens a persisted version at startup; `install` restores a specified version
for host-owned Undo/Redo. Native History is only transaction scratch and is
cleared after acceptance. Document, target, tools and floating continuations are
captured before dispatch and restored on failure, including dispatch's floating
drop before admission. A restored floating continuation follows the new monotonic
native revision. The broader type/action/plugin/file command families are not
exposed by this prototype's allowlist.

Versions use SHA-256 identities over a wrapper containing the complete native
manifest, source binding and layer target. Compressed native tile/blob names use
PhotoCraft's BLAKE3 scheme. Objects/versions are exclusively published and never
repaired or garbage-collected. Strong stable file identity enables verified-object
reuse only on detected APFS; other filesystems retain full content verification.
Same-size writes with restored mtime invalidate the APFS cache via inode/ctime.
Operation records use file-flushed, checksummed append-only segments. Restart
retains torn tails, reads only complete validated prefixes and opens a new segment;
checksum damage refuses access instead of inventing success. An OS file lease
permits only one writable host for this store, and releases on process exit.

`--store PRIVATE_ROOT [--budget BYTES]` grants only an internal engine namespace.
The 8 GiB maximum is a native-store cap; the Main coordinator must allocate it
within the single workspace's combined source/recovery budget. A version receipt's
`logicalBytes` captures usage at version publication, not a later whole-project
accounting snapshot. Windows directory-entry power-loss durability and its full
runtime remain unverified; no APFS metadata shortcut is enabled there.

Frames contain numeric `workerEpoch` and document `epoch`, `documentId`,
`frameSeq`, nullable `baseFrameSeq`, accepted `imageVersionRef`, optional
`previewId`, `inputThrough`, canvas dimensions, encoding
`srgb-rgba8-straight`, and absolute replacement tile rectangles with byte ranges.
`frame.inputThrough` counts successfully processed samples cumulatively within its
document epoch; pen-up, accept and capture never reset it. Gesture `fromSeq` /
`throughSeq` and prepared stroke `inputThrough` remain local to that gesture.
Only an explicit new epoch resets the frame prefix. Capture emits a complete keyframe; consecutive live updates emit cumulative dirty
rectangles, including regions restored when a reversing pressure stroke removes
an earlier smoothing tail. Exact native live adoption promotes the existing visual baseline
without uploading a whole canvas on each pen-up. Undo/cancel/recovery creates an
explicit epoch/keyframe barrier. No PNG/base64 is used for frames, and no
Rust-to-Electron-to-screen zero-copy claim is made.

The dedicated Rust tests and actual subprocess script use synthetic temporary
stores, verify native preview/commit equality, persistence and old-version
installation, failure rollback, duplicate operations, corruption refusal,
SIGKILL/restart and unknown results. The subprocess script retains raw frame
headers and RGBA payloads. `host_bench.py` measures native subprocess round trips;
it excludes Electron, screen presentation, physical pen input and Windows.
`FLOW_IMAGE_ENGINE_TRACE=1` emits internal phase timings on stderr. Native
persistence latency is still a gate for wider integration; a fast preview number
does not establish continuous whole-application drawing performance.

The hello capability `recoveredCandidateAcceptAtInstalledVersion` explicitly permits
an explicit recovered accept when Main has already installed that exact prepared
version. A missing capability does not certify this recovery branch. Loading a
version alone never creates an accepted operation receipt.
Candidate recovery origin is pinned on the candidate itself. A failed load or
accepted-receipt append keeps that origin for a retry in the same worker; a retry
never promotes an old document merely by changing its version label.

Opt-in `strokePipelineV1` (hello capability; absent means unsupported) moves the
Store, native writer and journal into one exclusive IO thread. The input actor is
the sole writer of Session, tools, live gestures and display state. IO receives
immutable COW documents only. There is no shared mutable Document or disk mutex in
input handling, and no native project/history acceptance authority.

`pipelineStart {maxPendingStrokes,maxPendingPoints,maxRetainedPixelBytes}` requires
an accepted settled document. Host caps are 4 completed-or-active strokes, 65536
retained points and 256 MiB unique pixel allocations; callers can lower them.
`pipelineReady` returns `pipelineId`, fixed `anchorVersion`, `limits`, `documentId`
and new `epoch`. Input/capture envelopes retain that anchor until stop; explicit
accept requests use the actual accepted predecessor. Each pipeline `strokeBegin`
names `predecessorOperationId` (null for the first, then the last completed ID),
binding its pointer-down COW base. An accepted predecessor never installs over a
newer working document or changes an active gesture's base/revision.

Pipeline finish responds `queued {durable:false,candidateId,pipelineId,
predecessorOperationId,inputThrough,frameInputThrough,epoch,inputDigest,
queueDepth,availableSlots}`. It is volatile admission, and Main must already retain
all samples and the brush seed. Pipeline begin requires an explicit nonnegative
safe integer seed; native does not silently generate one in this mode. `pipelinePoll {pipelineId}` returns
`pipelineState {pipelineId,anchorVersion,acceptedVersion,events,blocked,active,
operations,queueDepth,pendingPoints,retainedPixelBytes,limits,availableSlots}`.
Events are `{operationId,result}` where prepared has the ordinary durable receipt
plus predecessor, captured epoch/frame prefix and input digest. `active` identifies
its preview, admitted throughSeq and canonical input digest; `operations` retains
bounded admission metadata even if IO fails. `inputThrough` in a stroke receipt is
local; frameInputThrough records that stroke's epoch-cumulative end prefix.

Main alone installs prepared candidates FIFO with its project CAS, then explicitly
calls `accept`. The immediate `acceptQueued {durable:false,...}` is not settlement;
only the later durable `accepted` result confirms the native receipt flush. Poll
never auto-accepts. Prepared snapshots save FIFO; explicit acceptance is prioritized
over not-yet-started descendant snapshots. Failed/unknown IO freezes descendants,
retains all admitted samples/snapshots and reports the obligation. It does not
rerender, rebase, reorder, discard or accept them. A queued-only ACK does not promise
crash recovery without Main's retained input. Main-CAS-installed/native-unsettled
versions use the explicit recovered-accept capability after restart.

The actor only try-sends work and try-receives completions. Ten work slots and
sixteen completion slots exceed the maximum four entries × prepare/accept pair;
only IO may wait for a consumer. Accepted entries release an admission slot after
their event is polled. A 64-result recent cache supports lost poll replies; older
queries require settled stop and durable status, never an invented absent result.
A pipeline retains at most 65536 operation identities; it refuses another begin
when exhausted. Whole invalid/over-limit batches reject before advancing the
prefix. If a new batch exceeds the pixel budget, its preview alone is rebuilt
from the unchanged base and earlier admitted prefix/seed; earlier samples remain.
Pixel accounting counts shared COW tiles once, not process RSS or renderer buffers.

Pipeline frames additionally contain `pipelineId` and ordered unique
`pendingOperationIds` (at most four). If nonempty, `workingHeadOperationId` equals
the last pending ID and identifies the unaccepted completed base; `previewId`
identifies an active stroke, or `working-<head>` for its queued-only display.
`imageVersionRef` still names only the accepted prefix. Empty pending metadata is
not a project-save acknowledgement. Start and settled stop advance document epoch,
clear the frame input prefix and force a keyframe; pipelineId is fixed per epoch.

Freeze seals new begin/append admission immediately, still allows finish/cancel of
already admitted input and explicit FIFO accepts, and refuses completion while
obligations remain. `pipelineStop {pipelineId}` requires no active/retained/unsettled
operation or undelivered event; it returns the exclusive Store to synchronous mode
and replies with `epoch`/`documentId`/`versionId`. Undo/Refresh/other edits use this
barrier. Close never cancels in-flight IO. Failed unresolved chains remain frozen
for Main reconciliation, including preservation of the original input journal.

Dedicated `host_continuous_bench.py`, `host_pipeline_process.py` and
`host_pipeline_failures.py` run real native processes against synthetic stores.
`FLOW_IMAGE_ENGINE_TEST_IO_DELAY_MS=0..1000` delays each actual object/version
publication and journal append, including initial hydration; writes and errors still
execute. The tests distinguish admitted input latency, pre-admission backpressure,
volatile queue ACKs, durable preparation and explicit acceptance. Forty 2K/4K
strokes include semi-transparent reversals and erasers; burst and paced modes are
separate. Their small dirty regions and uniform background do not certify arbitrary
brush sizes or large layered scenes. No metric is physical pen-to-screen latency.

`immutableVersionExportV1` adds `export {versionId,format:"psd"|"tiff",maxBytes}`.
It requires a settled frozen host with the pipeline stopped. The selected immutable
version must belong to the open document, but may precede its current accepted
version: export never installs that older version. The response is
`exported {versionId,documentId,format,sha256,byteLength,width,height,layerCount,
layered:true,opaqueBlockCount,warnings:[]}` plus raw file bytes. No output pathname,
user-file publication, project Save acknowledgement or history change is granted.
Main must independently bind the captured project/version and publish the bytes.

The new Module calls `photocraft_io::encode_with` on the loaded real Document. Its
Interface exposes only the immutable version and byte budget, hiding the bounded
PSD seek writer and preservation checks behind the host Seam. It does not use the
older append-only PSD/PNG Adapter. Options explicitly enable TIFF layers,
unassociated transparency and alpha preservation, and disable linked-file reads
and document paths. Any export/import loss warning rejects the entire output.
The digest-bound upstream patch adds `tiff_force_layer_data` (default false);
the host explicitly enables it so even one locked Background writes real TIFF
37724 layer data. Missing layer data still rejects output; names, locks and pixels
are not rewritten to evade this check.
Explicit PSD output refuses automatic PSB promotion. The maximum transport output
is 64 MiB: PSD checks encoded_len before allocating its output, then enforces that
bound on write/seek. Upstream TIFF encoding already materializes bytes before its
length can be checked. This is not a process-memory ceiling or a large-file stream.

A runtime native reimport checks layer identity/order and the multiplicity and
bytes of opaque resources, global blocks and layer blocks retained in Document.
This guard is separate from independent compatibility evidence. It does not retain
the original PSD record layout, channel compression or noncanonical padding.
Canonical opaque PSD payloads in the synthetic source tests survive a real worker
restart, native-version load and Document export. An odd 19-byte layer block that
the exporter normalizes to 20 bytes is refused. PSD unknown blocks that cannot be
converted to the TIFF encoder's little-endian order produce upstream warnings and
are refused, with no partial bytes or flattening fallback returned.

`settledResumeV1` adds `resume`: only a settled frozen host without a pipeline,
live/floating gesture, candidate or unresolved journal may reopen admission.
`resumed {versionId,documentId,epoch}` establishes a new epoch/keyframe barrier;
its in-worker reply supports the same operation's lost-ACK retry. That operation
cannot cross another freeze, base or epoch. A failed pipeline remains blocked. Resuming
native editing does not certify that Main published a file or completed Save.

Independent output evidence uses `tests/host_output_process.py` with an existing
isolated Python directory containing psdtags, tifffile, imagecodecs and numpy;
it installs nothing. PSD section parsing follows the
[Adobe PSD specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/).
The oracle separately checks actual layer records/channels (including opacity,
visibility and normal/multiply/screen), a numpy recomposition, PSD's white-matted
RGB composite plus alpha, and TIFF's straight RGBA composite and real tag 37724.
The new-engine LiveStroke -> durable version -> PSD/TIFF -> resume -> continued
stroke path is also real. These synthetic independent checks do not certify
Photoshop UI, arbitrary complex source fidelity, Windows or user-file publication.

`toolContextSummaryV1` adds `summary {maxBytes:1..49152}`. Its read-only response
contains the actual tree in top-to-bottom display order (canonical decimal-string native layer IDs,
name/kind/visibility/opacity/blend, local and inherited locks), active/selected IDs,
selection presence/content bounds/token, floating ownership/offset/prefix/outline,
context generation, and known typed tool availability. It contains no paths,
History records or pixel buffers. Oversized trees/names/depth/encoded JSON reject
as a whole; there is no partial tree. Availability is a current-context hint for
the host's typed operations, not proof that arbitrary parameters will execute.
`selection.token` is an opaque worker/document/context-generation fence, not a
mask-content digest. Read-only summary does not alter the generation. Mutation,
rollback or acceptance may advance it even when accepted content stays unchanged.

`contextLayerSelectionV1` adds
`selectLayerContext {layerId,expectedContextGeneration}`. It calls the upstream
context operation directly, advances only context generation, and returns
`contextUpdated {documentId,imageVersionRef,contextGeneration,activeLayerId,
selectedLayerIds}`. It creates no immutable version, durable operation record or
Flow Undo step. Paint, candidate, pipeline, frozen, floating or unresolved durable
obligations refuse selection without implicitly dropping them. Load/Install still
restore the target saved with that immutable version; a later real edit captures
the currently chosen target in its own version. The formerly writable
`edit.selectLayer` is intentionally retired and replies unsupported. Callers must
check capabilities and use the new context command; PNGs cannot supply layer IDs.

`floatingGestureV1` adds `floating {previewId,expectedContextGeneration,action}`:
`begin {dx,dy}` establishes prefix 1 and retains the full pre-begin engine
checkpoint; `move {fromSeq,dx,dy}` requires the next exact prefix and adds integer
pixel offsets; `cancel {throughSeq}` restores that original checkpoint without
Undo or a durable version; `drop {throughSeq}` prepares a durable candidate for
Main's explicit CAS/accept. Each coordinate and cumulative offset is limited to
±10000000 rather than silently clamping native input. Whole-prefix/identity/generation
mismatches reject without moving again. Lost transient ACKs require summary; never
blindly replay a move. `floatingPreview` replies are explicitly `durable:false`;
Capture frames carry the floating `previewId`. Cancel advances epoch and forces a
keyframe. A prepared drop refuses Capture until explicit settlement, as other
candidates do. Legacy `edit.float`/`edit.dropFloat` now refuse; they cannot silently
start or settle an unidentified floating gesture.

The native Document owns the selection mask and serializes it into immutable
versions. Version wrappers also save active/selected layer targets. Session owns
the transient floating cut/offset and tool state: it is not serialized. Normal
Accept keeps the exact working mask/target and retires floating ownership; recovered
Accept installs the durable candidate mask/target. Same-host Discard of a drop
restores the checkpoint immediately before drop, including its live floating
continuation, so it is different from Cancel. Recovered Discard requires the
original base installed and restores that base without claiming any recovered
floating gesture. Install refuses an active floating owner; Load starts with no
floating continuation. Cancel restores the pre-begin mask/target/tools/pixels;
failed move/drop restores its pre-command checkpoint and retains ownership. A
failed durable preparation may still require explicit operation reconciliation;
Cancel does not erase its journal evidence. A failed checkpoint restoration stays
blocked instead of presenting successful cancellation.

`src/host/context_tests.rs` compares real mask samples, targets, tools, native
History state and composite pixels across this matrix. `tests/host_context_process.py`
checks the actual framed subprocess, lost drop ACK + SIGKILL/reopen and persisted
layer/mask summaries. It also builds synthetic no-ICC/invalid-ICC CMYK TIFFs: the
current Open gate refuses all non-RGB8 content before Session/version acceptance.
This preserves refusal, not CMYK support or independent positive color validation.

Flow preset visual mapping (including pencil grain/dynamics), wider layer CRUD,
UI selection-mask rendering, Windows and physical input/display acceptance remain
outside this slice. Export currently requires the entire host frozen and the same
open document. It does not provide simultaneous drawing/output or multi-board
stable Save capture; a future pinned-version read-only output worker still needs
Main's publication transaction.

`decimalLayerIdsV1` is required together with the tool-context capabilities.
Every LayerId in summary/contextUpdated (tree IDs, active/selected IDs and floating
source ID) is a canonical decimal string; null stays null and absent selections
stay empty arrays. `selectLayerContext.layerId` accepts the same representation,
with the full u64 range. Numbers, signs, leading zeros and overflow reject without
coercion or changing the target. Clients must refuse the older numeric shape and
must never convert IDs through JavaScript Number. Internal native-version u64
serialization is unchanged. PSD's separate `psd_id` is u32, but runtime LayerId
and the shared allocator are u64 and have no JavaScript-safe bound. A real Node
subprocess test uses two adjacent IDs above 2^53 through JSON.parse, production
wire framing and the real Host/Session to verify exact round trips and rejection
of the rounded numeric neighbour, without adding a production fixture command.

`flowBrushPresetsV1` adapts the five current Flow presets to the same native
LiveStroke/renderer used by the host. Main forwards the complete captured
`FlowStroke.brush` as `flowBrush`; the native Adapter validates hardness, grain,
spacing, 32-bit seed and numeric pressure coefficients. Hard/soft/pencil tips use
the product's procedural coverage as a bounded sampled native tip (up to 256²),
and native Shape Dynamics / Transfer map each pressure coefficient to a linear
Pen Pressure control with `minimum = 1 - coefficient`. Implicit pressure switches
and smoothing are disabled; stroke flow stays full. Pencil retains grain and
native angle variation, rather than falling back to the hard brush. The person's
preset preferences and global pressure switch remain in the existing UI; mouse
or pressure-disabled samples still arrive as pressure 1.

The native sampler, dab layout and seeded random rotation differ from Canvas2D;
this is a style mapping, not a byte-identical legacy renderer. Fixed-input evidence
separates those differences from opacity/eraser/pressure regressions. Product startup
must explicitly require this capability; a binary without it refuses unsupported
presets. The old simple hard/no-pressure Adapter path remains only for existing
Stage-A callers, not as a replacement for the formal default pencil.

`tests/host_product_brush.py` exercises all five presets and ten pressure cases
against a real host, retains raw RGBA, and checks preview/commit equality,
single-stroke opacity bounds, cross-stroke accumulation and repeated erasing.
`tests/product_brush_canvas.cjs` runs the actual old `brushStroke.ts`/`brushTips.ts`
in an own hidden Electron with isolated userData and compares the same fixed input;
it has no clipboard, Trash, external-open or user-project operations. Its metrics
include alpha and premultiplied colour differences, since straight RGB at tiny
alpha magnifies Canvas quantisation. These checks are not tablet or physical
screen-latency acceptance.

The Node Adapter exposes `driver.resume()` only after `settledResumeV1` capability
and the returned version/document identity plus epoch are checked under the same
operation-generation token. Failure does not authorize Main to become active.
A settled empty host may resume with null version/document identities, without
inventing an image; this allows an empty project's later document creation.

## Product image intents and temporary selection

The persistent host additionally advertises `productImageEditsV1` and
`temporarySelectionContextV1`. `productEdit` accepts the shared product
`ImageEngineEdit` shape and an exact `expectedContextGeneration`. It produces the
existing durable `prepared` candidate. Only Main's single project CAS followed by
explicit `accept` chooses that version; layer controls, bucket fill, blur and
transform do not acquire a separate native Undo history. Every operation validates
all IDs/locks before mutation and rolls its complete hosted checkpoint back on
native failure or discard. Layer sets are unique and bounded to 64. The wire keeps
canonical decimal u64 IDs. Generic edit input contains the complete polygon,
matrix, colour, tolerance or layer-property changes for Main's journal replay.
Typed bucket colour is straight RGBA8 at full command coverage: the host maps
that coverage to the upstream percentage value 100, independently of the colour's
alpha. The native alpha regression covers opaque and half-alpha fill, discard
and accepted-version reopen.

`selectionContext` sets or clears one temporary polygon for the current raster
layer and exact context generation. It does not publish a version, write an
operation receipt, change source `Document.selection` or change any source layer
mask. A bounded summary returns its token, point count and bounds (no mask pixels
or full polygon). Its raster mask uses the pinned engine's lasso rasterizer in an
isolated COW scratch context and is bounded by the existing 16 Mi-pixel canvas
limit. Main/UI retain the complete temporary geometry. Pixel edits attach that
mask only while executing and restore the source intrinsic selection before the
version is saved. Whole-layer clear/bucket/blur without a polygon do not silently
use an unrelated source selection.

Selecting another layer and loading/installing versions invalidate this temporary
selection. Ordinary live paint keeps its context generation and temporary
outline; non-paint acceptance invalidates the outline and advances the generation.
Discard restores the previous outline and source document; source layer masks and
intrinsic selection survive preparation, acceptance, failure and reopening. Native
paint still honours an intrinsic imported `Document.selection`; this is separate
from Flow's temporary tool geometry and is not silently deleted. Source Background
transparency locks retain the native background-colour eraser behaviour exposed
by the context summary. This is not a claim of arbitrary Photoshop round-trip
fidelity.

Control replies supply the actual worker/display epoch and document ID. The Node
Adapter's typed summary projects the real layer tree, supported product blend
mapping, raw native blend name, locks and tool state, and provides the exact
`FrameIdentity`. It never guesses display epochs. `prepareEdit` refuses an image
that is not already installed, so applying a toolbar action cannot silently switch
the active document or stale its supplied context generation.

Focused verification entry points are `host::context_tests::product_*` and the
real Node `imageEngineProductEdit.test.ts`; the existing hosted context matrix is
also exercised. Native tests inspect both actual pixels and source mask/target
state, not only a PNG. Unaccepted ordinary candidates remain unavailable to
Capture; opacity/transform COW live preview is a separate subsequent capability.
Formal UI, physical pen behaviour and Windows execution require independent
acceptance; these tests do not provide that evidence.

`intrinsicSelectionPaintGuardV1` makes that source selection boundary explicit:
all product Adapter strokes carry `flowProduct:true` (also when their optional
preset is absent). Serial and pipeline begin refuse them with
`unsupported-source-selection`, effect `none`, before admitting any point. The
summary reports `paintScope: source-selection-refused` and a disabled paint tool.
Legacy raw native fixture commands retain their original mask semantics and are
not a formal workbench entry. Formal startup must require the guard capability;
`flowBrushPresetsV1` alone does not prove it. Known non-admission clears only that
Adapter preview marker, so cancellation never invents an unaccepted stroke.

## Volatile product edit preview

`productEditPreviewV1` adds `previewEdit` (first `fromSeq=1`, then consecutive
prefixes) for absolute multi-layer opacity sets and transforms. It binds one
preview ID to the accepted version, document, worker/display epoch and source
context generation. Each update derives a COW document from the fixed original
and restores the complete real engine checkpoint before returning a frame. A
repeated prefix is idempotent only with the same edit digest. Only one preview is
retained; source and result each stay within the 256 MiB retained-pixel admission
bound. No native version or Undo is created by pointer moves.

The reply supplies the shared `ImageEnginePreviewStamp`. `cancelEditPreview`
requires its exact final prefix and restores display of the untouched original
under an explicit epoch barrier. The same ownership handles opacity and transform;
source intrinsic selection and layer masks do not become preview scratch.
Selecting a layer, starting paint/pipeline, installing, freezing and closing cannot
implicitly drop this owner. Main/UI may coalesce not-yet-sent absolute updates but
must retain admitted identity and final changes across component unmount/failure.

A final `productEdit` can carry the stamp alongside the complete authoritative
edit. Exact source/digest/prefix matching adopts the already-previewed pixels into
the normal durable candidate. After that only Main accept/discard settles it;
preview cancel cannot retire a candidate. If persistence fails or is unknown, the
volatile owner remains bound to `pendingOperationId`; cancellation/update is
refused until explicit Main resolution. `summary.editPreview` exposes its stamp,
pending ID and blocked reason. Restart loses only volatile display state; Main's
retained full edit and native operation status govern recovery, never an old
worker's stamp or blind replay.

Verification: the `product_preview_*`/`product_transform_preview_*` native state
checks and real `imageEngineProductPreview.test.ts` compare fixed-source pixels,
matched adoption, cancel/discard, one persisted version, reopen, sequence failures
and retained IO-failure obligations. Frames are native output evidence, not formal
LayerPanel/Canvas or physical-input performance acceptance.

## Detached immutable jobs and explicit document activation

`detachedImageJobsV1` supplies independent creation/hydration candidates and
read-only version inspection. A persistent single Store owner now performs all
publication, journal records, validation and quota checks. The existing four-slot
stroke pipeline delegates to that same owner; it is not another writer or user
history. Foreground paint/accept work has a bounded high-priority queue; one
immutable CPU job, up to four settlement-control jobs and a bounded low-priority queue wait for an idle foreground
between non-preemptible phases. `detachedPoll` reports queued/checking, waiting for
idle CPU/IO, decoding, rendering and persistence phases. An admitted frame/sample
is never discarded to make room for background work. Settlement/status of a durable candidate does not acquire the CPU-job gate or
wait for an unrelated background decoder. A low-priority operation
already in progress has a bounded admission size, not a claim of zero latency.

`detachedPrepare` accepts an editable white canvas (one unlocked native raster
filled through the native engine; no PNG), duplication of an exact immutable version,
or bytes granted from Main's retained source object. It returns a volatile job
admission first; polling returns the durable prepared candidate plus bounded layer
summary and PNG thumbnail. It never selects, installs, accepts or changes the
active engine Document. One CPU job runs at a time; at most 64 independent
candidate/results remain in memory. Candidate receipt records remain in the
append-only native journal after an in-memory cache is evicted or the process
restarts. Terminal polling is repeatable and never consumes the only receipt.

Main grants `maxAdditionalBytes` only after reserving the same operation against
its workspace-wide 8 GiB actual-plus-reserved budget. Native enforces its own
8 GiB store cap and that per-operation allowance, accounting real retained bytes
at each IO step and reserving 8 KiB for preparation/settlement records. Native's
store cap is not a replacement for Main counting originals, project records and
other outstanding reservations. Exceeding a quota retains evidence and rejects
new spending; nothing is automatically cleaned up.

Several prepared new/duplicate candidates may coexist before Main's single batch
CAS. Only explicit `settleDetached(candidateId,versionId)` acknowledges that Main
choice. It writes a durable native receipt without changing current document or
project authority. Ordinary active-document Accept/Discard/Abandon refuse these
candidates. Recovery can query `detachedStatus` or enumerate bounded `listDetached`
pages with an exact journal snapshot token; a changed token requires restarting
pagination. An orphan's document ID or matching source digest is not permission
to guess its project image. Uncommitted candidates require explicit retirement;
no input is automatically replayed. Freeze/close refuse in-flight jobs or
unsettled durable records.

`inspectVersion` derives a layer summary and PNG from its exact immutable version
without activating it, creating a version or changing display epochs. The Node
Adapter verifies ref geometry, SHA-256, PNG header and bounds; its copied PNG cache
is capped at 16 entries. `activate` is a separate explicit navigation barrier:
a fresh hosted context is fully constructed before swapping the active context.
It clears temporary selection and advances actual context/display generations
even for the same ref. Its failure retains the old context. Main must use this
barrier for board changes and product Undo; paint's private same-ref install fast
path remains to avoid clearing context on every pen-down.

The typed Adapter methods are `prepareCreation`, `prepareRetained`,
`settleCreation`, `creationStatus`, `discardCreation`, `listCreations`,
`inspectVersion` and `activate`. Prepare returns the existing `PreparedImage`
shape with `baseVersion:null`. Inspection returns `{summary,thumbnail,bytes}`;
thumbnail is PNG with SHA-256 and dimensions, never a replacement original or an
active frame. Main must not hold the foreground append/pump/CAS gate while waiting
for an idle background job. New/copy project history and crash decisions still
require Main's batch input/decision ledger and independent end-to-end acceptance.

Source admission is intentionally still limited: 8 MiB granted bytes, PNG/TIFF/PSD
hint, RGB8 raster/group Document, no damaged/preview-only/warning result, canvas
edge <=8192 and <=16 Mi pixels, <=64 layers and <=512 MiB materialized native
pixels. The live pipeline retains <=256 MiB; a larger admitted reference is not
advertised as paintable. CMYK, 16-bit, unsupported structure, excessive metadata
and larger files are not silently flattened or admitted. Main must retain their
originals and use an explicit protected reference-display route. This is not
parity with the older protected `readPhotocraft` reader or a 32 Mi-pixel product
capacity claim. Source interpretation is bound separately from format hint:
`photocraft-v1` uses the ordinary native interpretation. The separate
`flowV1UpgradeInterpretationV1` capability permits `flow-v1-upgrade` only for a
Main-granted, SHA-256/length-bound ordinary Flow V1 classic TIFF. Hydration checks
the actual rasterVersion-2 portable envelope and native PSD layer IDs derived
from its logical IDs, complete full-canvas raster records, names, visibility,
blend, lock flags and rounded opacity. It restores the original float opacity
and V1 full-lock meaning in the detached Document before its immutable version
is saved; raster tile hashes and source bytes do not change. Unknown metadata,
protected sourceReference/rasterVersion-3 content, masks, blending ranges and
unknown structure are rejected. This is not a general external-TIFF repair
profile. Source Registry and Creation must grant the explicit interpretation;
formatHint never conveys this authority, and missing capability must not fall
back to ordinary interpretation. `imageEngineV1Interpretation.test.ts` uses the
existing independent strict Python TIFF writer, retained-byte grants and a real
host to test both interpretations, unchanged tile objects, rejection and reopen.

Native tests inspect the unchanged active pixels/mask/target and prepared states,
background input continuation, quotas and exact activation. The real Node tests
exercise retained bytes, new/duplicate candidates, PNG decoding, one synthetic
Main-surrogate batch, SIGKILL and status-driven reopen. These are native Module
self-tests; they do not certify the real Main batch ledger, formal workbench,
physical input, arbitrary source fidelity or Windows execution.

The primitive source gate above is not an independent merged-image oracle.
Product TIFF/PSD routing must use the guarded source Interface below; unlike the
primitive path, it compares the imported layer composition with the source's
embedded display (Main sharp for TIFF). Controlled/synthetic primitive Source
tests alone are not evidence to retire protected display. The existing real TIFF corpus must retain its original SHA
and reference-display meaning; mismatches require explicit reference display or
refusal. Larger canvas budgets and real Windows evidence are separate unfinished
gates.

## Readonly output metadata

`readonlyExportMetadataV1` adds `NativeProductDriver.exportVersion(ref, format,
envelope, maxBytes?)` on the existing fair wire owner. Main supplies the exact
`WorkspaceOutputMetadataEnvelope` v2 authority from `workspaceOutputContract.ts`;
the Adapter uses that shared validator, never reconstructs a V1 image/layer tree
inside metadata. The request puts only `metadata:{sha256,byteLength}` in its
bounded header and sends <=1 MiB UTF-8 envelope bytes as payload. Native validates
schema, fields, identities, safe revision, dialogue ownership/uniqueness, shape,
length and digest again. Unsupported capabilities, malformed data and excessive
budgets reject. `maxBytes` remains 1..64 MiB, without truncation.

Output requires a settled, frozen host after pipelineStop. An explicit
`documentId` plus immutable `versionId` permits reading another settled document
in the same private store without activation. The response's top-level
`documentId`/epoch always describe the actual display actor;
`exportedDocumentId` identifies the output version. The typed result returns the
pinned `documentId`, `versionId`, dimensions, layer count, output digest/length
and `metadataSha256`. No output command accepts a project version, writes a user
file, settles a project journal or claims Save succeeded. Legacy exports without
metadata retain their existing same-document behavior. Busy read-only export
has effect `none`; it never cancels the outstanding edit.

The loaded immutable Document is COW-cloned for output. Only the Flow namespace
`metadata` property is replaced with base64 of the v2 envelope. Unknown source
XMP properties, attributes, namespaces, packet wrappers and processing
instructions retain their original bytes. Element and RDF-attribute forms of the
single existing Flow property are supported. Ambiguous/duplicate properties,
DTD, malformed XML, unrecognized container shape and >2 MiB merged XMP reject.
Layer surfaces, source masks and retained original bytes are unchanged. Both
formats still use PhotoCraft Document encoding with layered TIFF, alpha
preservation and linked-file reads disabled; warnings and opaque-block loss
reject. PSD uses XMP only: existing `metadata.text` loss is still rejected, never
silently dropped. A native readback also requires exact XMP bytes.
The host explicitly enables `ExportOptions.tiff_force_layer_data` from the fixed
`patches/hosted-v1.json` IO patch. This writes a real tag 37724 layer record even
for a single transparency-locked Background, retaining its name and lock flags;
it does not relabel flattened bytes as layered output. The upstream option
default remains false. Missing layer data, warnings and opaque-block loss still
reject. `imageEngineSingleLayerOutput.test.ts` checks retained PNG/JPEG hydration,
background output and re-entry with independent exact merged/layer pixels,
lock flags, actual layer-record count and metadata.


`output_metadata` native tests exercise COW, unknown XML, schema and failure
bounds. `imageEngineOutputMetadata.test.ts` uses the real host and independent
`psdtags`/`tifffile`/`imagecodecs` readers for two-layer active and one-layer
nonactive immutable PSD/TIFF, verifying metadata, alpha-unbaked layer pixels and
merged pixels; original version bytes, active context and resume pixels remain
unchanged. `tests/output_metadata_oracle.py` also checks unknown-XMP artifacts.
These are module self-tests, not real Main publication, formal Save UI,
background-export latency, arbitrary source round-trip or Windows acceptance.

## Source display guard and protected reference base

`sourceDisplayGuardV1` + `protectedReferenceV1` add the Main-only
`prepareRetainedGuarded(operationId, retainedObject, 'tiff'|'psd', reservation,
{interpretationId?, displayTolerance?})` Interface. It returns either
`{kind:'editable', prepared, proof}` or
`{kind:'reference', prepared, proof, policy, reason}`. Both are durable detached
candidates, never an automatic install/project decision. Main must bind the
exact retained SourceRef and, for references, its `protectedSource` record before
explicit settlement/activation. Layer IDs and policy IDs remain decimal strings.
The older primitive `prepareRetained` is retained for PNG, controlled V1 upgrade
and native fixtures; ordinary product TIFF/PSD must use the guarded Interface.

Main verifies the granted retained object's no-follow identity and complete
SHA-256, then generates TIFF embedded display with installed sharp from those
actual bytes. No renderer PNG enters this path. A cheap actor admission waits
for an idle input boundary before this bounded non-preemptible decode begins;
the native input actor remains available while it runs. Original bytes (<=8 MiB)
and an untagged sRGB RGBA8 PNG (<=32 MiB) share one <=40 MiB request payload, with
separate length/hash and source-digest bindings. Native validates those bindings,
original color interpretation and the full independent reference. PSD uses raw
merged-image parsing separately from layer interpretation. Invalid RGB ICC and
CMYK/other models reject without assuming a default profile. The guarded decoder
uses the old reader's bounded 512 MiB PSD import estimate, in the existing idle
CPU job; this is not a total RSS guarantee or proof that all old formats work.

Native compares the complete source layer rendering with the embedded display,
ignoring RGB only when both alpha values are zero. Transparent reference RGB is
canonicalized to zero. The proof binds source, dimensions, both RGBA digests,
maximum difference and the actual tolerance. Guard default is 2; Storyboard Flow's
creative-capture policy explicitly passes **8 from Main**, and may give a brief
notice for small color differences. This is a product policy, not publication
color certification. Renderer cannot change it; the operation fingerprint binds
it, so the same operation cannot silently switch policy. Current protocol bounds
tolerance to integer 0..16. Unsupported layer interpretation and severe mismatch
produce a protected reference; pixels are never corrected to force a match.

A reference Document contains a locked visible bottom raster for the reliable
embedded display and an ordinary transparent `Drawing` layer above it. The full
original remains retained under its SHA-256/length/format; this is explicitly a
reference representation, not a full editable import of the original structure.
`Version.source.displayPolicy`, prepared receipt, active `sourceDisplayPolicy`
summary and immutable inspection carry the same policy:
`{kind:'protected-reference', baseLayerId, referenceRgbaSha256,
original:{digest,byteLength,format}}`. All later versions and duplicate documents
inherit it. Main's exact SourceRef remains the sole original locator; native
source digest or PSD IDs never authorize searching arbitrary paths.

Product edits/previews, live paint and floating reject a protected base or its
ancestor. Moving other layers below it and merging it indirectly also reject.
Ordinary upper-layer paint/edit and duplication remain valid. Native stores a
private `protectedBaseManifestSha256` covering the base's properties, immutable
pixel objects, bottom root position and canvas color/geometry. Save/load validate
this fingerprint using already computed snapshot object hashes, avoiding a full
reference render on each stroke. Source policy cannot be supplied to primitive
Open/Source commands. `versionSourcePolicy(ref)` reads the authenticated immutable
version JSON without an actor/thumbnail gate, so Main can check a prepared
pipeline version before CAS without deadlocking on idle input. Full object and
private-fingerprint validation stays in native save/load; this Main metadata
check does not independently decode pixels. Repeated accepted same-owner source prepare rechecks the
original durable fingerprint; restart recovery uses status and exact refs instead
of replaying input. The guarded result classification/proof survive settlement.

Protected versions require the explicit origin-bound output capability below.
No locked flat layer is allowed to masquerade as a complete saved complex
original. Older guard-only binaries refuse protected output.
32M capacity and broader source/CMYK coverage remain separate unfinished gates;
current 16 Mi-pixel/8192-edge/8 MiB source bounds reject explicitly without resize.

The explicit opt-in `imageEngineSourceGuardCorpus.test.ts` reads only
`FLOW_AUTHORIZED_TIFF_LIST`, records every original SHA before/after and compares
full native frames against independent sharp embedded pixels. The conservative
2-level run covered 30 authorized TIFFs: 24 layer candidates and 6 protected
references, all displayed within tolerance, originals unchanged. Saved baseline
RGBA established that three of those six have only 4/7/4-level sparse differences
and no pixels >8, while the three severe differences affect ~32% of opaque
pixels. Flow's explicit tolerance 8 therefore admits the former directly; a
synthetic focused test verifies the 2/8 policy branch and fingerprint conflict,
without another corpus pass solely for tiny color changes. These measurements
are module evidence, not final GUI/project/Save certification.

`imageEngineSourceGuard.test.ts` checks real candidates, bad ICC/unprofiled CMYK,
source preservation, direct/indirect base refusals, preview refusal, upper paint,
duplicate, exact undo/redo installs and SIGKILL/reopen. Native fingerprint tests
independently mutate pixels, lock/name, ancestor, bottom order and geometry and
verify rejection plus unchanged older immutable versions. Original and failed
verification evidence is retained in task directories, never the user directory.


## Origin-bound protected working-file output

`protectedReferenceOutputV1` extends the existing readonly metadata export with
an optional fifth `expectedSourcePolicy` argument. Main must first verify its
`ProjectImage.protectedSource` exact retained SourceRef/original identity against
`versionSourcePolicy(ref)`, then pass the complete actual policy. Native compares
that expectation with the loaded immutable version too. A protected version with
missing/wrong policy, or a policy supplied for an unprotected version, rejects
with effect `none`. Protected output requires the v2 Flow storyboard metadata;
the v2 envelope and ordinary output API behavior stay unchanged.

The output-only COW packet contains a separate `flow:sourceReference` property,
base64 UTF-8 JSON bounded to 16 KiB:
`{schema:'flow.protected-source-reference',version:1,
original:{digest,byteLength,format},referenceRgbaSha256,basePsdLayerId,width,height}`.
The PSD layer identity comes from the actual native base, independently of its
runtime u64 layer ID. This marker contains no NativeRef, user path, SourceRef
capability or project authorization. It never grants permission to locate an
original. The receipt and typed output additionally return
`sourceReferenceSha256`; the normal full output digest/length and metadata digest
are still checked. Unknown XMP properties remain, and both Flow properties
coexist. No persistent Document or source bytes are changed.

A new protected working TIFF/PSD imported through the ordinary source guard
without an authorized origin interpretation returns
`protected-source-origin-required`. This prevents silently reclassifying its
base as ordinary editable data. Opening the same project by its retained
NativeRef, history and Main protectedSource binding remains supported. Authorized
cross-project re-import remains unsupported. Same-project working-file Refresh
uses the explicit authorized-origin capability below; no XMP-directed path lookup
or implicit origin migration occurs.
Main publication and actual Save/close/reopen acceptance remain separate from
these native module tests.

`imageEngineProtectedOutput.test.ts` checks real protected base + upper stroke,
missing/wrong Main policy and raw-native bypass refusal, TIFF/PSD layers and
merged pixels, independently decoded base RGBA and stable PSD ID, source envelope
and v2 dialogue/presentation, unchanged version/original bytes and resume pixels.
It also checks the unbound-working-source refusal. The independent oracle uses
already-installed Python `numpy`, `tifffile`, `psdtags` and `imagecodecs`; no test
installs them. Synthetic guard/output tests allow `FLOW_SOURCE_GUARD_PYTHON` and
`FLOW_SOURCE_GUARD_PYTHONPATH` overrides. Defaults preserve the task's macOS
Python 3.14 and independent `/private/tmp/flow-image-engine-export-python` copy.
The opt-in user-corpus audit is not part of a generic all-tests run.


### Daily-workflow native capabilities

`retainedRgbJpegV1` reuses the upstream JPEG codec, normalizes `jpg` to `jpeg`,
and applies EXIF orientation. RGB with validated ICC or untagged RGB is admitted;
CMYK and malformed/incomplete ICC segments are refused rather than silently
assigned a profile. The source bytes remain unchanged.

`protectedWorkingRefreshV1` prepares a retained working TIFF against a
Main-authorized old version and exact source policy. Source marker, reference
pixels/properties and origin must match. The candidate persists the observed
working-file digest/length; Main still owns the single project decision and
settles the candidate afterwards. External upper-layer changes are allowed;
changing the protected base or inventing an origin is not.

`inactiveVersionExportV1` encodes an immutable pinned version without switching
the active drawing context or freezing foreground input. One bounded job/result
is retained and read in chunks of at most 1 MiB. `drainInactiveExports` reconciles
and releases an unknown job in its original worker generation; it does not
publish files or automatically start a new export. Main may explicitly retry the
same file intention only after that job is settled. Worker replacement never
queries a new worker as though it owned the old job.

Focused native coverage is in `imageEngineJpeg.test.ts`,
`imageEngineWorkingRefresh.test.ts`, `imageEngineInactiveExport.test.ts`, and
`imageEngineSingleLayerOutput.test.ts`. These are distinct from Main/GUI and
platform acceptance; the explicitly approved manifests enumerate them.

### Read-only failure scope

Detached thumbnail/summary and immutable encoding failures with `effect:none`
and code `limit`, `unsupported`, or `engine` remain local to that read-only job.
Storage, integrity, protocol and unknown outcomes retain the global stop/reconcile
behavior. This does not change acceptance, journal durability or source protection.
The real Session regression lives in `imageEngineDetached.test.ts`; the error
classification unit test is the library target `failure_scope_tests`.
