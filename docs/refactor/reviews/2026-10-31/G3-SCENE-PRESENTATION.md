# Independent scene presentation — 2026-10-31

Candidate: `de85bad5ae0cfc21217da4af655e7a2a523b0f80`, original main. User explicitly chose independent matte settings,
no drawing in expanded matte padding, unchanged original canvas, and derived TIFF layers.
This supersedes the old expanded-matte pixel-resize/crop policy only in the isolated editor.
Default App, launcher, old projects and retained worktrees are unchanged. No push.

## Behavior and ownership

Project presentation is the active scene default; each shot stores its current setting.
One Board command updates all active shots as one history/checkpoint operation, leaving
PNG assets and image dimensions byte-identical. Pending keeps its own setting; restoration
and newly inserted shots inherit the scene default. Turning presentation off removes only
settings. Undo restores settings, including dialogue visibility, without cropping content.
Grid/Japanese drawing surfaces and Pending static previews consume read-only settings.
Expanded mode adds 75 image-pixels above/below the original viewport; embedded mode covers
75 pixels at each edge. Black bars intercept drawing; single-line dialogue text is derived
from ordered nonempty dialogue records, escaped for SVG output, never another text source.

Explicit Save derives padded content PNGs (expanded only) plus locked Matte Overlay and
optional Dialogue Overlay layers inside the bounded codec preparation. Ordinary assets
and TIFF Save baselines remain in original coordinates. Output content identity includes
presentation. No source TIFF changes during toggles/checkpoints; output still uses the
existing preflight, originals, journal and publication path. Pixel/PNG/layer limits are
checked before derived allocation. Missing/invalid assets refuse before publication.

Portable TIFF metadata records source height, original layer IDs, settings and RGBA hashes
of generated layers. Import/Refresh normalize only when generated layer identity/order,
properties and pixels match, and expanded padding remains transparent. This avoids double
bars on roundtrip. Changed generated layers, padding or unprovable ownership retain the
complete external raster/layers with unverified identity; Refresh keeps it in Pending.
Malformed metadata may be refused by the strict underlying codec; it is never discarded
from the source file. Project text stays authoritative during Refresh.

## Review

Independent read-only review found the codec wrapper initially dropped unknown top-level
fields when rebuilding its input. Both encode branches now reject unknown/missing fields
before asset reads/encoding, with a regression asserting neither port runs. Follow-up
review found the scoped fix complete. Generated-layer name/kind/properties and sparse
receipt arrays are also checked. Reviewer ran no tests and did not accept GUI/platforms.

## Verification

Development focused checks: 122 tests / 5 files passed in `/tmp/flow-presentation-focused-final.log`.
They include real TIFF encode/decode, original-size reimport and second Save, external
content refresh under derived matte, external overlay conflict preservation, no-pixel
scene operations, Pending restoration and new-shot inheritance.
Final build: `.hermes/evidence/20261031T121211.425126Z-build/`, exit 0.
Final complete suite: `.hermes/evidence/20261031T121342.319176Z-full/`, exit 0;
392 files / 3003 tests passed, 1274.846 seconds. Both gate receipts record the same
implementation HEAD and clean status before/after.

| GUI check | Cases | Evidence |
| --- | --- | --- |
| presentation | 19 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-presentation-smoke-r3iqZd/receipt.json` |
| presentation-japanese | 19 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-presentation-smoke-RYAnWg/receipt.json` |
| selection | 23 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-selection-smoke-vA0BA7/receipt.json` |
| selection-japanese | 23 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-selection-smoke-uEHpBD/receipt.json` |
| blur | 17 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-blur-smoke-OZ1AGu/receipt.json` |
| opacity | 26 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-opacity-smoke-izHqFZ/receipt.json` |
| import | 13 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-import-smoke-R0u5bJ/receipt.json` |
| editor | 42 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-rPWbOx/receipt.json` |
| switch | 9 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-switch-smoke-fDJHci/receipt.json` |
| trash | 10 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-trash-smoke-gxWiZ1/receipt.json` |
| refresh | 13 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-refresh-smoke-UzzkuQ/receipt.json` |

All 214 connected cases passed on the clean candidate. Picker choices are scripted;
real pointer input, Canvas, Session, codec and filesystem remain connected. Only the Trash
regression sends one identity-checked run-owned synthetic TIFF to system Trash; personal
Trash is never enumerated. Synthetic evidence remains retained.

## Limits

This covers the isolated route; no default routing or old-format migration. Dialogue output
is rasterized using local sans-serif fonts; cross-machine font metrics and Windows are not
certified. Mixed-setting TIFF folders preserve per-shot values, but mixed-state toolbar UX is not certified. Native picker choices are scripted. Large-project raster throughput, installers,
real Photoshop metadata preservation, full independent application acceptance and default
shell parity remain open. Playback/onion skin are the next bounded gate. Evidence is retained.

Additional Pending GUI driver: `/tmp/flow-presentation-pending-smoke.mjs`, log `/tmp/flow-presentation-pending.log`, receipt `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-presentation-smoke-LgOuyo/receipt.json`. It repeats the 19 presentation cases plus a retained-settings/static-preview/restore check without editing the frozen source.
