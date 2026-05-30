# Context Handoff

跨 session 交接文档。稳定规则见 `AGENTS.md` 和 `decisions.md`，待办事项见 `todo.md`。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `bitmap-layer-refactor`
- Latest implementation commit before this handoff update: `d1fb9ce feat: optimize tiff save and enforce layer locks`
- Continue in this bitmap worktree unless explicitly asked to merge or switch.

## Current Product State

- Storyboard Workbench is a local Electron + React + TypeScript + Vite app.
- One local image folder is one scene; metadata autosaves to `.storyboard-workbench/storyboard.project.json`.
- Drawing is bitmap-layer based:
  - JSON stores `shots[].layers` and `activeLayerId`.
  - Editable pixels live in `.storyboard-workbench/layers/{shotId}/{layerId}.png`.
  - Legacy `sketchLayers` and `imageLayerEdits` are migration inputs only.
- `Save` remains the write boundary for real delivery files:
  - It performs filename sync.
  - It writes single-layer shots as ordinary TIFFs.
  - It writes multi bitmap layer shots as Photoshop-readable layered TIFFs.
- `Import` ingests Photoshop layered TIFF raster layers into SWB-owned bitmap layer PNG assets and archives the source TIFF under `Archive/YYYYMMDDTHHMMSS/`.
- The main UI hides `Export TIFF`; the underlying export API remains for smoke and developer debugging.

## Completed In This Session

### Save Performance

- Layered TIFF Save no longer writes each Photoshop TIFF twice.
- Electron now passes SWB metadata into the Photoshop TIFF manifest before the final write.
- `scripts/photoshop-layered-tiff-export.py` now:
  - Builds the final white-composited TIFF image.
  - Computes the SWB `baseFingerprint` from that final composite.
  - Embeds SWB XMP into TIFF tag `700`.
  - Preserves Photoshop layer records in tag `37724`.
- Existing rollback-safe temp/backup replacement remains unchanged.

### Photoshop TIFF Python Dependencies

- Added `electron/main/photoshopTiffDeps.ts`.
- Photoshop TIFF helpers now resolve Python deps in this order:
  1. `SWB_PYTHON_DEPS_DIR`
  2. Packaged resources: `python-deps/photoshop-tiff`
  3. Local dev vendor path: `vendor/python/photoshop-tiff`
  4. Legacy fallback: `/private/tmp/psdtags-spike-deps`
- Added `vendor/python/photoshop-tiff/requirements.txt`.
- Added `npm run setup:photoshop-tiff-deps`.
- `.gitignore` ignores installed vendor packages while keeping `requirements.txt`.

### Bitmap Layer Lock

- Layer Lock is now enforced for bitmap edits.
- Locked layers can still be selected and shown/hidden.
- Locked layers cannot be drawn on, erased, Select-transformed, cleared, deleted, renamed, reordered, or have opacity/blend mode changed.
- Layer panel now has a lock/unlock control per row.
- Locked layer row editing controls are disabled in the UI.
- Smoke verifies that locking a layer blocks opacity edits and disables blend/delete controls.

### Docs

- Updated `README.md` with Layer Lock behavior and Photoshop TIFF dependency resolution.
- Updated `todo.md` to mark completed work and replace old dependency/performance/lock TODOs with the next packaging task.
- Updated `decisions.md` with new decisions for single-write layered TIFF Save, dependency resolution order, and Layer Lock behavior.

## Verification Run For Handoff

Commands run in `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`:

```bash
npm run test
# passed: 14 test files, 138 tests

npm run typecheck
# passed

npm run build
# passed; Vite reported the existing chunk-size warning only
```

Additional verification from implementation before this handoff:

```bash
npm run smoke:bitmap
# passed; launches Electron via local CDP and verifies Photoshop TIFF export/import,
# Save/Import progress, layer drawer wheel behavior, visibility drag,
# layer lock blocking, Save safety, reopen, and legacy migration.
```

The smoke intentionally triggers a Save temporary rename conflict and logs `Temporary rename file already exists`; this is expected when the command exits `0`.

## Git Diff Summary For This Session

Compared with `697ed36 docs: refresh layered tiff handoff`:

```text
17 files changed, 465 insertions(+), 51 deletions(-)
```

Files changed:

```text
M  .gitignore
M  README.md
M  context-handoff.md
M  electron/main/main.ts
A  electron/main/photoshopTiffDeps.test.ts
A  electron/main/photoshopTiffDeps.ts
M  electron/main/photoshopTiffExport.test.ts
M  electron/main/photoshopTiffExport.ts
M  package.json
M  scripts/electron-bitmap-smoke.mjs
M  scripts/photoshop-layered-tiff-export.py
M  src/renderer/App.tsx
M  src/renderer/styles.css
M  src/shared/projectOps.test.ts
M  src/shared/projectOps.ts
M  todo.md
A  vendor/python/photoshop-tiff/requirements.txt
```

## Current Git State

- Implementation commit already exists: `d1fb9ce feat: optimize tiff save and enforce layer locks`.
- This handoff/doc update is pending commit until step 4 is complete.

## Next Handoff Target

Recommended next steps:

1. Manually dogfood Save speed on a real multi-shot, multi-layer storyboard folder.
2. Manually dogfood Layer Lock in the app, especially lock/unlock, visibility toggles, delete disabled state, and drawing prevention.
3. Add installer packaging that copies populated `python-deps/photoshop-tiff` resources into the packaged app.
4. Manually verify bitmap Select lasso/rectangle scaling on real high-resolution storyboard images.
5. Manually review mixed-aspect animation mode and multi-select shot dragging.
6. PSD-first Photoshop interoperability remains a future spike.

## Known Remaining Work

- Manual dogfood remains needed for shortcut editing, bitmap Select hand feel, mixed-aspect animation matte, multi-select shot dragging, double-click dialogue editing, Save speed, and Layer Lock feel.
- Photoshop TIFF Python deps can now resolve from env/resources/vendor/fallback, but installer packaging still needs to copy populated deps into app resources.
- Photoshop layered TIFF import supports raster layer ingestion for V1; full Photoshop feature round-trip is not implemented.
- PSD-first spike and compatibility matrix are not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the Vite chunk-size warning.
