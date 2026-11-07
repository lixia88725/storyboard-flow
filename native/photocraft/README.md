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

## Experimental hosted engine (stage A, not wired into Flow)

`flow-photocraft-host` is a separate persistent binary. The existing reader/export
binary and normal Flow entry remain separate. This prototype admits one document
per native host and synthetic/simple RGB8 raster/group PNG/TIFF/PSD inputs only
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
and document paths. Any export/import loss warning rejects the entire output;
a single locked Background that would take the flat TIFF branch is also refused.
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
contains the actual tree in top-to-bottom display order (numeric native layer IDs,
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
