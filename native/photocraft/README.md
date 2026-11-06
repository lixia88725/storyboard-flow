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
