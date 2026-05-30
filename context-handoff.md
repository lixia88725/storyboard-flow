# Context Handoff

跨 session 交接文档。稳定规则见 `AGENTS.md` 和 `decisions.md`，待办事项见 `todo.md`。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `bitmap-layer-refactor`
- Latest implementation commit before this handoff update: `59ecfea chore: audit cleanup and renderer extraction`
- Continue in this bitmap worktree unless explicitly asked to merge or switch.

## Current Product State

- Storyboard Workbench is a local Electron + React + TypeScript + Vite app.
- One local image folder is one scene; metadata autosaves to `.storyboard-workbench/storyboard.project.json`.
- Current drawing data is bitmap-layer based:
  - JSON stores `shots[].layers` and `activeLayerId`.
  - Editable pixels live in `.storyboard-workbench/layers/{shotId}/{layerId}.png`.
  - Legacy `sketchLayers` and `imageLayerEdits` are migration inputs only.
- `Save` remains the only real write boundary for delivery files:
  - It performs filename sync.
  - It writes single-layer shots as ordinary TIFFs.
  - It writes multi bitmap layer shots as Photoshop-readable layered TIFFs.
- `Import` ingests Photoshop layered TIFF raster layers into SWB-owned bitmap layer PNG assets and archives the source TIFF under `Archive/YYYYMMDDTHHMMSS/`.
- The main UI hides `Export TIFF`; the underlying export API remains for smoke and developer debugging.

## Completed In This Session

### Audit And Cleanup

- Added `docs/audit-2026-05-30.md` as the current codebase audit snapshot.
- Added `docs/superpowers/plans/2026-05-30-audit-cleanup.md` as the executed cleanup plan.
- Consolidated development guidance into `README.md` and `AGENTS.md`.
- Added a developer map, change routing, and verification guidance for preload/build/smoke changes.

### Electron Maintainability

- Added `electron/main/bitmapLayerOrdering.ts`.
- Save and Photoshop TIFF export now share bitmap layer filtering/sorting/defaulting rules.
- Added unit coverage for the shared ordering helper.
- No Save boundary semantics were changed.

### Preload Contract Check

- Added `electron/preload/preloadSync.test.ts`.
- Added `scripts/check-preload-sync.mjs`.
- Added `npm run check:preload`.
- The check verifies that `electron/preload/preload.cjs` exposes the expected API surface from `electron/preload/preload.ts`.

### Renderer Extraction

- Extracted low-risk stateless pieces from `src/renderer/App.tsx`:
  - `src/renderer/icons.tsx`
  - `src/renderer/Timeline.tsx`
  - `src/renderer/BitmapLayerThumbnail.tsx`
  - `src/renderer/DragPreviews.tsx`
  - `src/renderer/SelectionMarquee.tsx`
  - `src/renderer/SketchSettingsControls.tsx`
- Left higher-risk pieces in `App.tsx`: `LayerPanel`, `SketchPad`, bitmap selection overlay, shot cards, and dialogue cards.
- Recommendation: do any further extraction in focused passes with verification; start with `LayerPanel`, not `SketchPad`.

### Documentation Maintenance

- Rewrote this handoff to reflect the current cleanup baseline.
- Trimmed `todo.md` completed history into grouped milestones so new sessions can scan it faster.
- Added one decision to `decisions.md`: Electron Save/export paths must share bitmap layer ordering rules.

## Verification Run For Handoff

Commands run in `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers` on 2026-05-30:

```bash
npm run test
# passed: 15 test files, 140 tests

npm run typecheck
# passed

npm run build
# passed; Vite reported the existing chunk-size warning only
```

Additional verification already run after the implementation work in this session:

```bash
npm run check:preload
# passed

npm run smoke:bitmap
# passed; includes Photoshop TIFF export/import, Save/Import progress,
# layer drawer behavior, layer lock blocking, Save safety, reopen,
# selection/eraser/shortcut checks, and legacy migration.
```

The smoke intentionally triggers a Save temporary rename conflict and logs `Temporary rename file already exists`; this is expected when the command exits `0`.

## Git Diff Summary For This Session

Current working tree was clean before this handoff-doc update. The implementation commit for this session is:

```text
59ecfea chore: audit cleanup and renderer extraction
```

Compared with prior handoff baseline `f8d18ed 交接存档：记录Save优化、依赖路径和图层锁定`, the implementation changed:

```text
22 files changed, 693 insertions(+), 361 deletions(-)
```

Files changed in the implementation commit:

```text
M  AGENTS.md
M  README.md
M  context-handoff.md
A  docs/audit-2026-05-30.md
A  docs/superpowers/plans/2026-05-30-audit-cleanup.md
A  electron/main/bitmapLayerOrdering.ts
M  electron/main/bitmapLayers.test.ts
M  electron/main/main.ts
M  electron/main/photoshopTiffExport.ts
A  electron/preload/preloadSync.test.ts
M  package.json
A  scripts/check-preload-sync.mjs
M  scripts/electron-bitmap-smoke.mjs
M  src/renderer/App.tsx
A  src/renderer/BitmapLayerThumbnail.tsx
A  src/renderer/DragPreviews.tsx
A  src/renderer/SelectionMarquee.tsx
A  src/renderer/SketchSettingsControls.tsx
A  src/renderer/Timeline.tsx
A  src/renderer/icons.tsx
M  src/renderer/styles.css
M  todo.md
```

## Next Handoff Target

Recommended next steps:

1. Start a real dogfood session on a real multi-shot, multi-layer storyboard folder.
2. Manually verify Save speed, Layer Lock feel, bitmap Select lasso/rectangle scaling, mixed-aspect animation mode, multi-select shot dragging, and double-click dialogue editing.
3. If continuing maintainability work, extract `LayerPanel` from `App.tsx` in its own planned pass with smoke verification.
4. Do not extract `SketchPad` casually; it owns drawing, selection, pointer handling, and layer PNG writes.
5. Add installer packaging that copies populated `python-deps/photoshop-tiff` resources into packaged app resources.
6. Keep PSD-first Photoshop interoperability as a future spike.

## Known Remaining Work

- Manual dogfood remains needed for shortcut editing, bitmap Select hand feel, mixed-aspect animation matte, multi-select shot dragging, double-click dialogue editing, Save speed, and Layer Lock feel.
- Photoshop TIFF Python deps can resolve from env/resources/vendor/fallback, but installer packaging still needs to copy populated deps into app resources.
- Photoshop layered TIFF import supports raster layer ingestion for V1; full Photoshop feature round-trip is not implemented.
- PSD-first spike and compatibility matrix are not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the Vite chunk-size warning.
- `App.tsx` is smaller after low-risk extraction, but `LayerPanel` and `SketchPad` remain intentionally unextracted until separate planned passes.
