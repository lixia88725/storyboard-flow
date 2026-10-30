# Batch 3 TIFF formats delivery — 2026-10-30

Status: **COMPLETE for the bounded implementation and self-test slice**.
Independent acceptance, coordinator integration and publication are not complete.

- Worktree: `/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers`
- Branch: `codex/batch3-tiff`
- Shared base / task briefing: `9f45067e142040d84fa70ade8ce92d361d91a21a`
- Tested implementation SHA: `9040704473ebb438046576aff2c64f5853bc82c0`
- Implementation commit to integrate: `9040704473ebb438046576aff2c64f5853bc82c0` (no setup/briefing commits)
- Report HEAD: the report-only commit containing this file; its exact SHA is recorded
  after commit in `/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/.hermes/evidence/tiff-report-receipt.json` and in the final handoff.

## Result

Added an isolated raster TIFF conversion Interface, real Python worker, synthetic fixture
producer and public-interface regression tests under `electron/core/formats/`, plus
`TIFF-QUESTIONS.md`. No existing source file, shared contract, manifest/configuration,
preload, main entry, UI host or launcher changed. The production app is not connected.

Actual callers are the synthetic tests; the public Interface is `createTiffCodec` and
`admitTiffCandidate`. TIFF success means encoded bytes, not a Save/Close/backup receipt.

## Verification

All final checks ran on the exact clean implementation SHA above. No implementation
changed after freezing. Report-only documentation follows those checks.

| Command | Exit | Counts / duration | Raw log / receipt |
|---|---|---|---|
| `npm run test -- electron/core/formats` | 0 | 1 file / 17 tests; 15.452 s | [log](/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/.hermes/evidence/tiff-final-focused/output.log), [receipt](/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/.hermes/evidence/tiff-final-focused/receipt.json) |
| `python3 scripts/wave2-verify.py full --lane assets` (first, unprepared environment) | 1 | 377 passed / 3 failed files; 2826 passed / 24 failed tests; 1365.160 s | [log](/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/.hermes/evidence/20261030T082909.074716Z-full/output.log), [receipt](/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/.hermes/evidence/20261030T082909.074716Z-full/receipt.json) |
| `python3 scripts/wave2-verify.py build --lane assets` | 0 | Complete renderer + Electron typechecks, Vite and Electron compilation; 10.375 s | [log](/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/.hermes/evidence/20261030T091423.654877Z-build/output.log), [receipt](/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/.hermes/evidence/20261030T091423.654877Z-build/receipt.json) |
| `python3 scripts/wave2-verify.py full --lane assets` (prepared environment) | 0 | **380 files / 2850 tests passed**, no skips; 1348.805 s | [log](/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/.hermes/evidence/20261030T091434.145085Z-full/output.log), [receipt](/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/.hermes/evidence/20261030T091434.145085Z-full/receipt.json) |
| `git diff --check`, clean-status and known-owned-worker-residue checks | 0 | Clean unchanged implementation, no TIFF worker directory remains in the known runner roots | [checks](/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/.hermes/evidence/tiff-final-checks.json) |

The only build warning is the existing large renderer chunk warning; it is not suppressed.
Preload/resource-preparation checks are not required because those paths did not change.
GUI, actual Photoshop, Windows, installed packaging, production Save/first backup/output
replacement/external changes/multi-project lifecycle are outside this slice and NOT_RUN.
No independent acceptance or publication is claimed.

## Interface and supported subset

`createTiffCodec({scriptPath,depsDir,pythonPath?,limits?})` returns `decode(tiffBytes)`
and `encode({image:ImageDocumentV1,text:TiffText|null},readImmutableAsset)`.
Neither accepts source/replacement output paths. Private workers write only their
owned temporary directory; the adapter waits for its child to settle even on timeout,
cleans that exact directory, then returns. Cleanup failure is a failure, never ACK.
One operation per codec is admitted, concurrent calls return busy. No global queue,
production IPC or new writable project owner was added.

Supported editable raster subset:

- Single-page contiguous 8-bit RGB/RGBA TIFF, top-left orientation, unassociated
  alpha, unprofiled or exact installed standard sRGB profile. Plain input explicitly
  returns `kind: plain` and one image-layer PNG candidate. Encode always creates
  layered raster TIFF, including one-layer output, to retain identity/transparency.
- Photoshop ImageSourceData with raster RGB or RGBA channels, RAW/ZIP/ZIP-predicted/
  RLE compression, normal/multiply/screen, layer order bottom-to-top, names (including
  CJK/emoji/whitespace/empty names), visibility, transparency locks and opacity.
  Transparent, hidden, all-hidden and zero-area empty layers remain present. In-bounds
  cropped raster rectangles are padded to canvas; off-canvas data is refused.
- Source pixels stay separate from opacity. The actual RGBA composite uses straight
  alpha source-over and separable normal/multiply/screen, excluding hidden layers.
  All-hidden output is transparent. Photoshop opacity records are 8-bit; own Flow XMP
  retains the exact ProjectV1 opacity, checked against quantized TIFF record on decode.
  Generic files use the original record's value /255.
- `flow:metadata` namespace and `app: Storyboard Flow`, `format: flow-tiff`, local
  `rasterVersion:1` retain image ID/revision, layer IDs/kind/exact opacity, project
  ID/name, shot ID/name/script text and that shot's ordered DialogueV1 records.
  Names/visibility/lock/blend come from actual TIFF records. No asset ID in XMP is
  trusted: decoded PNGs are candidates until `admitTiffCandidate` gets real depot
  receipts. The helper snapshots candidates before awaits and publishes no checkpoint.
- Unknown/malformed metadata or layered structures fail explicitly. Groups, masks,
  clipping, blending ranges, adjustments/effects/text/vector/unknown layer tags,
  extra/missing/duplicate channels, off-canvas pixels, unsupported blend modes,
  document extras/Photoshop resource tags, unknown XMP/ICC, high-depth/non-RGB,
  associated alpha/non-default orientation and multipage input are refused.
  NUL names are refused because the installed string reader strips terminating NUL.
  Old production Flow TIFF metadata is refused, never treated as this new format.

Hard default caps, which callers may only reduce: 128 MiB TIFF, 32 MiB per PNG,
16,777,216 aggregate canvas pixels across all layers, 64 layers, 8192 px per dimension,
1 MiB metadata and 60 s worker timeout. Layer descriptors and compression expansion
are checked before the existing library eagerly decompresses channels. RAW lengths,
ZIP expanded lengths/eof and RLE row expansion must match bounded declared dimensions.
These limits bound admitted data/work; they are not a measured process RAM ceiling or
a universal native-parser security guarantee. No scale/performance claim is made.

The installed psdtags Unicode writer counts code points rather than UTF-16 units.
The worker has a narrow local PsdString subclass that writes the correct unit count;
shared vendor dependencies are untouched. Legacy importer/exporter modules are untouched.

## Evidence

Final focused: `npm run test -- electron/core/formats`, exit 0, 1 file / 17 tests.
Final focused receipt records clean, unchanged implementation SHA before/after.
Actual Python codecs and sharp outputs are exercised; success is not mocked.

Cases: layered decode/edit/admit/checkpoint/load/encode/redecode with exact pixels,
Unicode text/names and all layer properties; plain TIFF roundtrip; real normal/multiply/
screen composites with independently calculated values; all-hidden transparency;
generic and zero-area layers; RAW/ZIP/RLE decode; deterministic unsupported/malformed
refusal; byte/pixel/layer/PNG/metadata limits; missing/hash-invalid/corrupt/16-bit/wrong-
dimension PNGs; caller mutation during encode/decode/admission awaits; concurrent busy;
startup/timeout failure and subsequent retry; read-only source files unchanged; unknown
image/text fields rejected before assets are read; failed admission publishes no head.

Development failures remain in `.hermes/evidence/tiff-development/`: initial Vite
cache write failed through whole-node_modules symlink; private per-package symlinks
keep caches local. Initial missing Python dependency path was corrected through an
explicit existing main vendor path, then actual worker-constructor and UTF-16 bugs
were corrected. A Buffer-vs-Uint8Array test assertion was corrected to compare bytes.
No assertions or required cases were removed. Test helper retains failed synthetic
fixtures outside the checkout; exact paths are in raw logs. Successful helper fixtures
and every worker temporary directory were cleaned by their owners. No personal media,
userData, clipboard, Trash, dependencies/global config or other checkout was modified.

## Integration example

The first test in `electron/core/formats/tiff.test.ts` is an executable synthetic
integration example. Decode to candidates; caller edits candidate pixels/properties;
open a real new-root depot; admit each candidate with a distinct operation ID; install
returned image in one ProjectV1; checkpoint via the depot's verified reader; reload;
encode using the loaded checkpoint's immutable reader; decode and assert exact content.
For application wiring use Session ownership/commands rather than installing a second
project directly. Imported IDs/text are portable data, never filesystem authority.

See `TIFF-QUESTIONS.md` for ProjectV1 schema gaps, packaging/identity decisions and
recommended explicit Save/first-backup/output-transaction contract. No unresolved schema
change blocks this bounded raster module; legacy/full-fidelity inputs remain refused.

## First full run and environment correction

The first frozen full run ended exit 1 on unchanged clean `9040704`:
380 files, 377 passed / 3 failed; 2850 tests, 2826 passed / 24 failed;
1365.160 s runner duration. Its new TIFF file passed all 17 tests.
Failures are confined to existing `historyAssetOperation.native.test.ts` (9:
missing locally compiled `dist-electron/main/preparedWorkspaceSave.js`),
`photoshopTiffExport.test.ts` (7) and `tiffSavePreparation.test.ts` (8), whose
helpers hard-code the worktree-local vendor path with no installed packages.
The runner's environment override cannot supersede those test-local paths.

That run settled before any environment changes. The first full raw log/receipt
are retained under `.hermes/evidence/20261030T082909.074716Z-full/`, with owned
synthetic residue under its receipt's `tempRoot`. Existing installed Python
packages were then linked into this worktree's ignored vendor tree; no package
was installed and the tracked `requirements.txt` digest was identical before/after.
`.hermes/evidence/tiff-environment.json` lists every created link and that digest.
The next build/full run sets `PYTHONDONTWRITEBYTECODE=1` so shared vendor packages
stay read-only. Complete build is required before the repeated full run because
those existing cold-reader tests import its output. No source or assertions changed.

## Acceptance matrix

Every row uses actual generated TIFF/PNG bytes and installed codecs. The focused
raw log and receipt are under this worktree's `.hermes/evidence/tiff-final-focused/`.
All successful results below are self-tests, not independent/Photoshop acceptance.

| Required case | Public scenario in `electron/core/formats/tiff.test.ts` | Result |
|---|---|---|
| Supported layered decode/edit/encode/redecode | First test edits actual candidate PNG/name/visibility, admits real depot assets, checkpoints, reloads, encodes from loaded immutable reader and redecodes | PASS |
| Plain TIFF editable one-image result | Plain unassociated-alpha RGB(A) fixture → one candidate → layered output → exact pixels | PASS |
| Layer order, names, kind, lock, identities, canvas | Exact descriptor/pixel comparisons for every layer; Unicode/emoji/empty names and image revision | PASS |
| Storyboard Flow Unicode text/identity metadata | Exact project/shot names, IDs, script/newlines/spaces and ordered dialogue data through XMP and checkpoint chain | PASS |
| Hidden, empty and transparent layers | Hidden raster retained, all-hidden composite alpha=0, fully transparent layer retained, zero-area source normalized without removing membership | PASS |
| Opacity and blends | Three real normal/multiply/screen composites compared with independent formula; exact source PNG pixels and own opacity retained | PASS |
| Bad or missing pixels | Missing reader, digest mismatch, corrupt PNG, uint16 PNG, wrong PNG dimensions and missing TIFF RGB channel refused | PASS |
| Malformed/unsupported inputs | Truncated/non-TIFF, 16-bit, grayscale, multipage, orientation, unknown XMP; masks/groups/off-canvas/unknown blends/metadata fields/version; opacity record conflict | PASS |
| Resource limits | Encoded TIFF/PNG bytes, aggregate layer pixels, count/dimensions, metadata and invalid limits; excessive layer rectangles rejected before decompress | PASS |
| Compression expansion | RAW/ZIP/RLE readback preserved; ZIP/RLE payload expanding beyond declared shape rejected before eager codec decode | PASS |
| Caller mutation during awaits | Encode image/text/ordering and source TIFF bytes snapshot; admission candidate pixels/properties snapshot; concurrent conversion returns busy | PASS |
| Explicit worker failure | Missing interpreter and 1 ms timeout return failure; worker is settled before cleanup/retry | PASS |
| Deterministic failure / source preservation | Each unsupported layered fixture refused identically twice, source byte digests unchanged; read-only TIFF files remain byte-identical on success/failure | PASS |
| Depot/checkpoint integration | First test real admission/save/load/encode chain; invalid admission leaves no published checkpoint and preserves previously admitted bytes | PASS |

No compatibility, migration, production Save, first-backup/replacement, external-change
coordination, multi-project lifecycle, GUI/Photoshop, Windows or installer case is claimed.
Those are outside this slice; see TIFF-QUESTIONS.md for the next contract/gates.


## Integration and cleanup handoff

See [TIFF-QUESTIONS.md](/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/docs/refactor/batch3/TIFF-QUESTIONS.md) for exact
schema gaps, packaged-worker/identity decisions and recommended next Save/backup contract.
The coordinator still owns actual import/Session wiring, output transaction/first backup,
source binding/native restrictions, external edits, Save-during-edits and lifecycle gates.

All owned conversion children settled before their callbacks/cleanup completed. The
final full runner and its npm child settled with exit 0. Known full/build temporary
roots contain no `flow-tiff-*` worker directory. Test-helper success fixtures were
cleaned by their own helper; failed fixtures and runner temp roots are retained as
evidence and were not globally scanned or removed. No unrelated process or lock was
terminated/cleared. Shared heavy checks were serialized; initial exit 75 and both waits
are recorded in [queue note](/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/.hermes/evidence/tiff-queue-note.txt).

Installed Node/Python packages are reused through ignored worktree-local links; Node
cache directories and build outputs stay local. No package installation or dependency-source edit was performed; `PYTHONDONTWRITEBYTECODE=1` was used for the prepared gates.
Tracked requirements remained byte-identical, recorded in
[environment receipt](/Users/xiali/.codex/worktrees/a22b/appshot-bitmap-layers/.hermes/evidence/tiff-environment.json). Ignored links,
build outputs and raw evidence are deliberately retained for coordinator reproduction.

Implementation/self-test complete; independent acceptance NOT_RUN; production integration
NOT_RUN; published NO. No push/merge/default routing or old-code deletion occurred.
This finite lane stops at this delivery.
