# AGENTS.md

## Project

Storyboard Workbench MVP is a local-first Electron desktop app for arranging storyboard images, moving dialogue between shots, drawing edits, and managing lightweight storyboard layers.

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
- Keep Electron filesystem work in `electron/main/main.ts`.
- Expose renderer-safe APIs through `electron/preload/preload.ts` and keep `electron/preload/preload.cjs` in sync.
- Keep top-level renderer UI state, Save/Import/autosave wiring, and project history in `src/renderer/App.tsx`.

## Development Map

- Project data behavior: start in `src/shared/projectOps.ts`, then update `src/shared/projectOps.test.ts`.
- Renderer pure behavior: use focused helpers in `src/renderer/sketchGeometry.ts`, `src/renderer/sketchRendering.ts`, `src/renderer/activeTargets.ts`, `src/renderer/keyboardShortcuts.ts`, `src/renderer/animationViewport.ts`, or `src/renderer/onionSkin.ts` before wiring behavior into UI components.
- Renderer UI wiring: `src/renderer/App.tsx` is the current integration point for toolbar state, shortcuts, animation, Save, Import, autosave, selection state, and project history. `src/renderer/ShotCard.tsx` owns per-card presentation, dialogue cards, script back faces, lazy media placeholders, and the card-local composition of `SketchPad` and `LayerPanel`. `src/renderer/SketchPad.tsx` owns bitmap drawing, erasing, Select transforms, Onion Skin overlay, live bitmap canvases, and Konva stage wiring. Keep edits narrow because these files are collaboration hotspots.
- Electron Save/Import/filesystem behavior: start in `electron/main/main.ts`, but avoid changing `saveWorkspace` ordering unless the task explicitly targets Save.
- Electron bitmap layer ordering/defaulting: use `electron/main/bitmapLayerOrdering.ts` so Save and Photoshop export stay aligned.
- Storyboard script Markdown behavior: use `electron/main/storyboardScript.ts` and its tests so the production parser/serializer/import planner stays covered.
- Safe file rename and temp replacement behavior: use `electron/main/fileRenames.ts` and its tests.
- Photoshop layered TIFF exchange: use `electron/main/photoshopTiffExport.ts`, `electron/main/photoshopTiffImport.ts`, and the Python scripts in `scripts/`.
- Renderer-safe API surface: update both `electron/preload/preload.ts` and `electron/preload/preload.cjs`, then run `npm run check:preload`.
- End-to-end coverage: add to `scripts/electron-bitmap-smoke.mjs` when behavior crosses renderer + Electron + filesystem boundaries.

## Change Routing

- Changing storyboard ordering, dialogue movement, rename plans, bitmap layer metadata, lock rules, or SWB import status: update `src/shared/projectOps.ts` first.
- Changing drawing, erasing, Select transform, Onion Skin overlay, or live preview behavior: prefer a renderer helper test first, then wire through `src/renderer/SketchPad.tsx`.
- Changing Save, Import, Archive, TIFF metadata, or working TIFF pixels: treat it as high risk, keep the patch small, and run `npm run build` before `npm run smoke:bitmap`.
- Changing preload APIs: update TypeScript and CommonJS preload files together and run `npm run check:preload`.
- Changing visual styling only: keep the change in `src/renderer/styles.css`; do not modify project data or Electron code.
- Changing smoke coverage: preserve existing scenarios and only add focused helpers or assertions for the new behavior.

## Code Standards

- Prefer small pure functions for ordering, dialogue, layer, sketch, SWB format, and rename behavior.
- Preserve user files unless an explicit user action requires changing them.
- Use two-stage renaming when changing image filenames in a folder.
- Keep V1 data structures understandable and local-first: `Project`, `Shot`, `Dialogue`, `BitmapLayer`, legacy migration stroke fields, SWB metadata, and naming metadata.
- Avoid adding AI, export, database, cloud, Photoshop layer round-trip, or file watching code unless specifically requested.
- Treat `Save` as the only operation that may synchronize real image filenames or write working TIFF pixels.
- Treat storyboard deletion as pending app state until `Save`; deleted root image files move to the system Trash, not `Archive`.

## Prohibited Actions

- Do not modify business code when the user asks only for documentation.
- Do not auto-rename image files during autosave.
- Do not treat `.storyboard-workbench/` cache files as user image shots.
- Do not add SQLite, AI prompt fields, PDF export, cloud sync, or Photoshop integration to V1 without a new explicit plan.
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

For UI interaction changes, also perform a manual or automated app smoke test when feasible. The canonical smoke areas for this app are Save rename safety, Save TIFF baking, Image layer drawing/erasing/delete/reorder, storyboard Delete-to-Trash, layer panel operations, script card editing and Markdown Import, external root image Import warning, bitmap Select move/scale, live eraser preview, layer thumbnails, layer row opacity/reorder gestures, configurable keyboard shortcuts, multi-select shot dragging, double-click dialogue editing, zoomed sketch drawing, Add Shot aspect presets, timeline navigation when animation mode is active, mixed-aspect animation centering, Onion Skin, and tool shortcuts.

Mark any untested GUI behavior as `TODO: verify`, especially dnd-kit drag behavior that automated tooling cannot fully prove.
