# AGENTS.md

## Project

Storyboard Flow is a local-first Electron desktop app for arranging storyboard images, moving dialogue between shots, drawing edits, and managing lightweight storyboard layers.

## Naming Boundary

- The product name is `Storyboard Flow`. Use this name in UI copy, README/product docs, GitHub-facing text, window titles, and new user-visible messages.
- `Storyboard Workbench` is a legacy name. Do not use it for new product-facing text.
- `.storyboard-workbench`, `SWB`, `swb-*`, and `storyboard-workbench.local` are legacy/internal compatibility names for the current disk format, metadata namespace, tests, and environment variables. Keep them unless a separate format-migration plan explicitly changes them.
- New TIFF metadata should write `app: "Storyboard Flow"`, but readers must continue accepting old `app: "Storyboard Workbench"` metadata so existing projects keep opening.

## Context

新 session 开始时请先阅读以下文档：

- `decisions.md` — 架构决策与设计理由。
- `context-handoff.md` — 上次 session 的进度与当前状态。
- `todo.md` — 待办事项、已知问题与未来规划。

## Tech Stack

- Electron main/preload process.
- React + TypeScript + Vite renderer.
- `dnd-kit` for shot and dialogue drag behavior.
- Canvas / `react-konva` renderer code for bitmap drawing, live brush/eraser preview, and legacy sketch migration paths.
- `sharp` in the Electron main process for TIFF preview generation, blank TIFF creation, bitmap layer initialization, metadata writing, and Save-time TIFF baking.
- Vitest for pure logic tests.

Current drawing data is bitmap-layer based. Layer metadata lives in `shots[].layers`; editable layer pixels live under `.storyboard-workbench/layers/{shotId}/{layerId}.png`. Brush, eraser, Select transform, and layer operations should write bitmap layer assets/metadata, not legacy stroke state. Legacy `sketchLayers` and `imageLayerEdits` are migration inputs only; do not add new drawing behavior that depends on them as primary data.

## Commands

```bash
npm install
npm run dev
npm run test
npm run typecheck
npm run build
npm run check:preload
npm run smoke:bitmap
```

## Code Organization

- Keep cross-cutting data operations in `src/shared/projectOps.ts`.
- Add or update Vitest coverage in `src/shared/projectOps.test.ts` when changing project data behavior.
- Keep Electron Save / Import / TIFF orchestration in `electron/main/main.ts`, but put isolated read-side filesystem helpers in focused `electron/main/*Service.ts` files with tests.
- Expose renderer-safe APIs through `electron/preload/preload.ts` and keep `electron/preload/preload.cjs` in sync.
- Keep top-level renderer UI state, Save/Import/autosave wiring, external change refresh, delete target, parking orchestration, and project history in `src/renderer/App.tsx`; keep per-card presentation in `src/renderer/ShotCard.tsx`.

## Development Map

- Project data behavior: start in `src/shared/projectOps.ts`, then update `src/shared/projectOps.test.ts`.
- Renderer pure behavior: use focused helpers in `src/renderer/sketchGeometry.ts`, `src/renderer/sketchRendering.ts`, `src/renderer/activeTargets.ts`, `src/renderer/keyboardShortcuts.ts`, `src/renderer/animationViewport.ts`, `src/renderer/onionSkin.ts`, `src/renderer/deleteTarget.ts`, `src/renderer/bitmapLayerWriteQueue.ts`, or `src/renderer/storyboardDnd.ts` before wiring behavior into UI components.
- Renderer UI wiring: `src/renderer/App.tsx` is the current integration point for toolbar state, shortcuts, animation, Save, Import, autosave, external change refresh, delete target, parking orchestration, AI panel orchestration, selection state, and project history. `src/renderer/ai/AiDraftPanel.tsx` owns AI Draft side panel presentation, provider settings UI, candidate controls, and AI resource assignment UI. `src/renderer/ShotCard.tsx` owns per-card presentation, dialogue cards, script back faces, lazy media placeholders, and the card-local composition of `SketchPad` and `LayerPanel`. `src/renderer/SketchPad.tsx` owns bitmap drawing, erasing, lasso Select transforms, Onion Skin overlay, live bitmap canvases, and Konva stage wiring. `src/renderer/LayerPanel.tsx` owns layer selection, visibility sweep, opacity/reorder gestures, Merge controls, and row UI. `src/renderer/ParkingShelf.tsx` owns the right pending shelf UI. Keep edits narrow because these files are collaboration hotspots.
- Electron Save/Import/filesystem behavior: start in `electron/main/main.ts`, but prefer existing focused helpers such as `blankShotService.ts`, `folderScanService.ts`, `imageRecordsService.ts`, `knownImageChangesService.ts`, `projectMetadataService.ts`, `externalChanges.ts`, `saveProgress.ts`, `closePrompt.ts`, `previewCache.ts`, `storyboardScriptProject.ts`, and `workspaceTemporaryPaths.ts` when the task is isolated. Avoid changing `saveWorkspace` ordering unless the task explicitly targets Save.
- AI behavior: keep provider adapters, settings, prompt/request preview logic, candidate generation, batch generation, and ComfyUI workflow handling under `electron/main/ai/*`; keep renderer AI panel presentation under `src/renderer/ai/*`. AI output must remain candidate-first and additive unless a separate product decision changes it.
- Electron bitmap layer ordering/defaulting: use `electron/main/bitmapLayerOrdering.ts` so Save and Photoshop export stay aligned.
- Storyboard script Markdown behavior: use `electron/main/storyboardScript.ts` and its tests so the production parser/serializer/import planner stays covered.
- Markdown project bootstrap behavior: use `electron/main/storyboardScriptProject.ts` and its tests.
- External change behavior: use `electron/main/externalChanges.ts` and its tests; compatible TIFF auto-import must not treat stale TIFF XMP as newer than JSON baseline.
- Safe file rename and temp replacement behavior: use `electron/main/fileRenames.ts` and its tests.
- Photoshop layered TIFF exchange: use `electron/main/photoshopTiffExport.ts`, `electron/main/photoshopTiffImport.ts`, and the Python scripts in `scripts/`.
- Renderer-safe API surface: update both `electron/preload/preload.ts` and `electron/preload/preload.cjs`, then run `npm run check:preload`.
- End-to-end coverage: add to `scripts/electron-bitmap-smoke.mjs` when behavior crosses renderer + Electron + filesystem boundaries.

## Change Routing

- Changing storyboard ordering, dialogue movement, rename plans, bitmap layer metadata, lock rules, or SWB import status: update `src/shared/projectOps.ts` first.
- Changing drawing, erasing, Select transform, Onion Skin overlay, or live preview behavior: prefer a renderer helper test first, then wire through `src/renderer/SketchPad.tsx`.
- Changing layer multi-select, Merge, visibility sweep, row drag, or opacity gestures: start in `src/shared/projectOps.ts` for project state and `src/renderer/LayerPanel.tsx` for UI.
- Option/Alt drag copy is retired. Do not reintroduce storyboard, layer, or dialogue copy-on-drag without an explicit product decision; normal drag remains move/sort.
- Changing parked shot behavior: preserve the rule that parked shots remain in JSON but do not participate in Save output, filename sync, Timeline, or `storyboard-script.md`.
- Changing Save, Import, Archive, TIFF metadata, or working TIFF pixels: treat it as high risk, keep the patch small, and run `npm run build` before `npm run smoke:bitmap`.
- Changing preload APIs: update TypeScript and CommonJS preload files together and run `npm run check:preload`.
- Changing visual styling only: keep the change in `src/renderer/styles.css`; do not modify project data or Electron code.
- Changing AI provider/settings/generation behavior: keep project files free of API keys, preserve candidate-first Apply, and avoid changing Save / Import / TIFF / `.storyboard-workbench` format boundaries unless explicitly requested.
- Changing smoke coverage: preserve existing scenarios and only add focused helpers or assertions for the new behavior.

## Code Standards

- Prefer small pure functions for ordering, dialogue, layer, sketch, SWB format, and rename behavior.
- Preserve user files unless an explicit user action requires changing them.
- Use two-stage renaming when changing image filenames in a folder.
- Keep V1 data structures understandable and local-first: `Project`, `Shot`, `Dialogue`, `BitmapLayer`, legacy migration stroke fields, SWB metadata, and naming metadata.
- Avoid adding export, database, cloud, Photoshop layer round-trip, or file watching code unless specifically requested.
- AI provider or AI UI work must stay inside the existing internal AI module boundaries unless the user explicitly approves a larger architecture change.
- Treat `Save` as the only operation that may synchronize real image filenames or write working TIFF pixels.
- Treat storyboard deletion as pending app state until `Save`; deleted root image files move to the system Trash, not `Archive`.

## Prohibited Actions

- Do not modify business code when the user asks only for documentation.
- Do not auto-rename image files during autosave.
- Do not treat `.storyboard-workbench/` cache files as user image shots.
- Do not add SQLite, PDF export, cloud sync, or Photoshop integration to V1 without a new explicit plan.
- Do not attempt Photoshop layer round-trip or Photoshop-compatible multi-layer TIFF writing without a separate explicit plan.
- Do not use destructive file commands without explicit approval.

## Completion Standard

Before claiming a change is complete, run:

```bash
npm run test
npm run typecheck
npm run build
```

Run `npm run check:preload` whenever preload files change.

Run `npm run prepare:package-resources` whenever packaging resources change. It requires populated `vendor/python/photoshop-tiff` from `npm run setup:photoshop-tiff-deps`.

For renderer or Electron changes that affect built output, run `npm run build` before `npm run smoke:bitmap`; the smoke uses `dist` and `dist-electron`.

For UI interaction changes, also perform a manual or automated app smoke test when feasible. The canonical smoke areas for this app are Save rename safety, Save TIFF baking, Image layer drawing/erasing/delete/reorder, storyboard Delete-to-Trash, layer panel operations, script card editing and Markdown Import, external root image Import warning, bitmap Select move/scale, live eraser preview, layer thumbnails, layer row opacity/reorder gestures, fixed keyboard shortcut list, multi-select shot dragging, double-click dialogue editing, zoomed sketch drawing, Add Shot aspect presets, timeline navigation when animation mode is active, mixed-aspect animation centering, Onion Skin, and tool shortcuts.

Mark any untested GUI behavior as `TODO: verify`, especially dnd-kit drag behavior that automated tooling cannot fully prove.
