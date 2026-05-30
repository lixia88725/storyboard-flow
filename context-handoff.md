# Context Handoff

跨 session 交接文档。稳定规则见 `AGENTS.md` 和 `decisions.md`，待办事项见 `todo.md`。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `bitmap-layer-refactor`
- Latest implementation commit before this handoff update: `f8d18ed 交接存档：记录Save优化、依赖路径和图层锁定`
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

### Audit And Cleanup Docs

- Added `docs/audit-2026-05-30.md` as the current codebase audit snapshot.
- Added `docs/superpowers/plans/2026-05-30-audit-cleanup.md` as the executed cleanup plan.
- Consolidated development guidance into `README.md` and `AGENTS.md` instead of keeping a separate `DEVELOPMENT.md`.
- `README.md` now includes a developer map and the `check:preload` script.
- `AGENTS.md` now includes the development map, change routing, and the verification rules for preload/build/smoke changes.

### Electron Save/Export Cleanup

- Added `electron/main/bitmapLayerOrdering.ts`.
- Electron Save and Photoshop TIFF export now share the same bitmap layer filtering and sorting helper.
- Added unit coverage for the shared bitmap layer ordering behavior.
- This is a small drift-reduction refactor only; it does not change Save semantics or move work outside the Save boundary.

### Preload Contract Check

- Added `electron/preload/preloadSync.test.ts`.
- Added `scripts/check-preload-sync.mjs`.
- Added `npm run check:preload`.
- The check verifies that the CommonJS preload bridge still exposes the expected API surface from the TypeScript preload source.

### Renderer Extraction

- Extracted low-risk stateless renderer pieces from `src/renderer/App.tsx`:
  - `src/renderer/icons.tsx`
  - `src/renderer/Timeline.tsx`
  - `src/renderer/BitmapLayerThumbnail.tsx`
  - `src/renderer/DragPreviews.tsx`
  - `src/renderer/SelectionMarquee.tsx`
  - `src/renderer/SketchSettingsControls.tsx`
- Kept higher-risk pieces in `App.tsx`, including `LayerPanel`, `SketchPad`, bitmap selection overlay, and shot/dialogue cards.
- Recommendation: continue extraction only in separate planned passes with smoke coverage, starting with `LayerPanel` before considering `SketchPad`.

### Minor Maintainability Notes

- Added section comments in `scripts/electron-bitmap-smoke.mjs` so future smoke edits are easier to place.
- Clarified the dark theme override comment in `src/renderer/styles.css`.

## Verification Run For Handoff

Commands run in `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`:

```bash
npm run test
# passed: 15 test files, 140 tests

npm run typecheck
# passed

npm run build
# passed; Vite reported the existing chunk-size warning only

npm run check:preload
# passed

npm run smoke:bitmap
# passed; includes Photoshop TIFF export/import, Save/Import progress,
# layer drawer behavior, layer lock blocking, Save safety, reopen,
# selection/eraser/shortcut checks, and legacy migration.
```

The smoke intentionally triggers a Save temporary rename conflict and logs `Temporary rename file already exists`; this is expected when the command exits `0`.

## Git Diff Summary For This Session

Compared with `f8d18ed 交接存档：记录Save优化、依赖路径和图层锁定` before this handoff/doc update:

```text
Pending commit includes audit docs, README/AGENTS cleanup, Electron helper/test changes,
preload sync checking, smoke comments, and renderer component extraction.
```

Files changed:

```text
M  AGENTS.md
M  README.md
M  electron/main/bitmapLayers.test.ts
M  context-handoff.md
M  electron/main/main.ts
M  electron/main/photoshopTiffExport.ts
M  package.json
M  scripts/electron-bitmap-smoke.mjs
M  src/renderer/App.tsx
M  src/renderer/styles.css
M  todo.md
A  docs/audit-2026-05-30.md
A  docs/superpowers/plans/2026-05-30-audit-cleanup.md
A  electron/main/bitmapLayerOrdering.ts
A  electron/preload/preloadSync.test.ts
A  scripts/check-preload-sync.mjs
A  src/renderer/BitmapLayerThumbnail.tsx
A  src/renderer/DragPreviews.tsx
A  src/renderer/SelectionMarquee.tsx
A  src/renderer/SketchSettingsControls.tsx
A  src/renderer/Timeline.tsx
A  src/renderer/icons.tsx
```

## Current Git State

- Implementation/handoff baseline before this pass: `f8d18ed 交接存档：记录Save优化、依赖路径和图层锁定`.
- This audit/cleanup/refactor pass is pending commit until the current handoff update is committed.

## Next Handoff Target

Recommended next steps:

1. Manually dogfood Save speed on a real multi-shot, multi-layer storyboard folder.
2. Manually dogfood Layer Lock in the app, especially lock/unlock, visibility toggles, delete disabled state, and drawing prevention.
3. Treat the current cleanup as the baseline for future feature work.
4. If continuing `App.tsx` extraction, do `LayerPanel` as its own planned pass with smoke verification.
5. Extract `SketchPad` only under a dedicated plan because it owns drawing, selection, pointer handling, and layer PNG writes.
6. Add installer packaging that copies populated `python-deps/photoshop-tiff` resources into the packaged app.
7. Manually verify bitmap Select lasso/rectangle scaling on real high-resolution storyboard images.
8. Manually review mixed-aspect animation mode and multi-select shot dragging.
9. PSD-first Photoshop interoperability remains a future spike.

## Known Remaining Work

- Manual dogfood remains needed for shortcut editing, bitmap Select hand feel, mixed-aspect animation matte, multi-select shot dragging, double-click dialogue editing, Save speed, and Layer Lock feel.
- Photoshop TIFF Python deps can now resolve from env/resources/vendor/fallback, but installer packaging still needs to copy populated deps into app resources.
- Photoshop layered TIFF import supports raster layer ingestion for V1; full Photoshop feature round-trip is not implemented.
- PSD-first spike and compatibility matrix are not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the Vite chunk-size warning.
- `App.tsx` is smaller after low-risk extraction, but `LayerPanel` and `SketchPad` remain intentionally unextracted until separate planned passes.
