# Context Handoff

跨 session 接手页。稳定规则见 `AGENTS.md`，架构边界见 `decisions.md`，待办事项见 `todo.md`。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `bitmap-layer-refactor`
- Previous major handoff baseline: `3820ac9 交接存档：完善脚本面板、导入提醒和删除流程`
- Latest handoff commit before this file update: `d50fe78 docs: record shot card extraction`
- Current goal of this handoff: make the repo easy for another session or AI agent to continue from a clean, verified state.

## Current Product State

- Storyboard Workbench is a local Electron + React + TypeScript + Vite app.
- One local image folder is one scene.
- Main project data lives in `.storyboard-workbench/storyboard.project.json`.
- Editable bitmap layer pixels live in `.storyboard-workbench/layers/{shotId}/{layerId}.png`.
- Root working TIFFs remain the visible delivery files.
- `Save` is still the only boundary that synchronizes real file names and writes working TIFF pixels.
- `Import` ingests non-SWB root images, Photoshop layered TIFF raster layers, and explicit external `storyboard-script.md` edits.
- `Archive/` is only for preserving non-SWB originals during Import.
- User-deleted storyboard source files are moved to system Trash on Save, not Archive.
- `storyboard-script.md` is a human-editable mirror of JSON, not the primary data source.

## What This Session Finished

### Maintenance And Dogfood Closure

- Continued the maintenance/health pass from the earlier session.
- Kept changes small and behavior-preserving.
- Confirmed the branch is ready to pause maintenance work and move attention back to feature development or UI polish.

### SketchPad Extraction

- Extracted sketch rendering helpers into `src/renderer/sketchRendering.ts`.
- Extracted bitmap stage UI into `src/renderer/SketchPad.tsx`.
- `SketchPad` now owns drawing, erasing, Select transforms, Onion Skin overlay, live bitmap canvases, and Konva stage wiring.
- `App.tsx` still owns Save, Import, autosave, dirty shot tracking, project history, and global UI state.
- Relevant commits:
  - `da55b2b refactor: extract sketch rendering helpers`
  - `d14fd32 refactor: extract sketch pad component`
  - `45df50d docs: record sketch pad extraction`
  - `3c97e39 交接存档：完成 SketchPad 抽取和维护收口`

### Package Resources Audit

- Verified `npm run prepare:package-resources` prepares Photoshop TIFF Python deps under `dist-resources/python-deps/photoshop-tiff`.
- Verified package resource tests.
- Did not add electron-builder / forge / installer config because the project has not chosen a packager.
- Future packaged layout must place `python-deps/photoshop-tiff` at the packaged app resources root.
- Relevant commit: `ce00116 docs: audit package resources integration`.

### ShotCard Extraction

- Extracted per-card presentation from `App.tsx` into `src/renderer/ShotCard.tsx`.
- Added `src/renderer/storyboardDnd.ts` for shared shot/dialogue/drop-zone drag data types.
- `ShotCard.tsx` now owns:
  - storyboard card presentation
  - card-local deferred media placeholder
  - dialogue card UI
  - script back face textarea
  - per-card composition of `SketchPad` and `LayerPanel`
- `App.tsx` went from 2755 lines to 2418 lines after this extraction.
- Relevant commits:
  - `714316c refactor: extract shot card component`
  - `d50fe78 docs: record shot card extraction`

## Current Renderer Ownership Map

- `src/renderer/App.tsx`
  - Top-level project state
  - toolbar state
  - Save / Import / autosave wiring
  - global selection state
  - undo / redo project history
  - global keyboard shortcuts and menus
- `src/renderer/ShotCard.tsx`
  - one storyboard card's presentation
  - dialogue cards
  - script back face
  - lazy card media placeholder
  - card-local `SketchPad` / `LayerPanel` composition
- `src/renderer/SketchPad.tsx`
  - bitmap drawing and erasing UI
  - Select lasso / rectangle transforms
  - Onion Skin overlay
  - Konva stage wiring
- `src/renderer/LayerPanel.tsx`
  - per-shot layer drawer UI
  - layer row gestures
  - visibility sweep
  - opacity / blend mode / reorder controls

## Verification

Fresh verification for this handoff:

```bash
npm run test
# passed: 24 test files, 170 tests

npm run typecheck
# passed

npm run build
# passed
# Vite still reports the existing chunk-size warning:
# dist/assets/index-Bb0X8jov.js 649.86 kB, gzip 200.26 kB
```

Verification from the ShotCard extraction commit:

```bash
npm run smoke:bitmap
# passed
# Expected Save conflict protection log appeared:
# Temporary rename file already exists
```

The Vite chunk-size warning is an existing, documented non-blocking warning. The latest audit recommendation remains: do not add manual chunks or raise the warning limit without measured startup pain, a clear optional UI boundary, or substantial renderer bundle growth.

## Current Git State Before This Handoff Update

`git diff --stat` and `git diff --name-status` were empty before rewriting this handoff, because the latest code and documentation work had already been committed.

Latest commits before this handoff update:

```text
d50fe78 docs: record shot card extraction
714316c refactor: extract shot card component
3c97e39 交接存档：完成 SketchPad 抽取和维护收口
ce00116 docs: audit package resources integration
45df50d docs: record sketch pad extraction
d14fd32 refactor: extract sketch pad component
da55b2b refactor: extract sketch rendering helpers
e582bce docs: refresh handoff and sketchpad plan
```

## Next Recommended Work

Maintenance refactor work can pause here. The branch is cleanly organized enough for the next session to return to product work.

Good next targets:

1. Feature development or UI polish based on real user workflow pain.
2. If continuing UI polish, keep it focused and avoid changing Save / Import / autosave boundaries.
3. If changing card UI, start in `src/renderer/ShotCard.tsx`.
4. If changing drawing, Select, Onion Skin, or canvas behavior, start in `src/renderer/SketchPad.tsx`.
5. If changing filesystem, Save, Import, Archive, TIFF metadata, or working TIFF pixels, treat it as high risk and verify with `npm run build` then `npm run smoke:bitmap`.

Deferred larger choices:

- Full installer/electron packager integration: choose packager first, then include prepared `dist-resources` at the packaged app resources root.
- PSD-first workflow: still needs a separate spike and compatibility matrix.
- Renderer code splitting: only revisit with measured startup pain or a clear optional UI boundary.

## Known Remaining Work

- No active P1 items.
- Current P2 items are in `todo.md`.
- Full installer/electron packager integration is not implemented.
- PSD-first import/export is not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the documented Vite chunk-size warning.
