# Bitmap Layer Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stroke/vector drawing source of truth with editable bitmap layer PNG assets under `.storyboard-workbench/layers/`, while keeping real filename sync and TIFF pixel writes behind `Save`.

**Architecture:** JSON stores layer metadata and relative bitmap paths; PNG files store editable layer pixels. Renderer drawing edits bitmap layer pixels, Electron owns filesystem reads/writes and Save-time layer compositing, and shared pure functions own layer metadata operations and migration decisions.

**Tech Stack:** Electron main/preload, React + TypeScript + Vite renderer, Vitest, Konva/react-konva where still needed, sharp for PNG/TIFF read/write/composite.

---

## Non-Goals And Invariants

- Do not add AI features.
- Do not add export features.
- Do not add SQLite.
- Do not add cloud sync.
- Do not add Photoshop layer round-trip or Photoshop-compatible multi-layer TIFF writing.
- Autosave and drawing may write only `.storyboard-workbench/` internal data.
- `Save` remains the only action that may change real image filenames or write working TIFF pixels.
- Archive originals must not be modified by drawing, autosave, layer operations, or ordinary project open.

## Highest Risk Points

1. Renderer state coupling is the highest risk: current `App.tsx` interleaves stroke drawing, Image layer behavior, layer panel actions, undo/redo, onion skin, and animation mode.
2. Save boundary regressions are high risk: new layer PNG autosave must not accidentally write real TIFF pixels outside `Save`.
3. Migration is high risk: old `sketchLayers` and `imageLayerEdits` projects must open with equivalent visible results and then stop depending on stroke data.
4. Memory usage is high risk: command-level undo snapshots for bitmap layers can grow quickly, so undo history needs a small cap.

## Task 1: Bitmap Layer Types And Pure Operations

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/projectOps.ts`
- Modify: `src/shared/projectOps.test.ts`

- [ ] Add failing tests in `src/shared/projectOps.test.ts` for creating a shot with one `kind: "image"` bitmap layer, adding a `kind: "paint"` layer, selecting layers, updating visibility/opacity/blend mode, reordering layers, and deleting/clearing layers without touching save naming behavior.
- [ ] Run `npm run test -- src/shared/projectOps.test.ts` and confirm the new tests fail because bitmap layer helpers/types are missing.
- [ ] Add `BitmapLayer`, `BitmapBlendMode`, and bitmap layer fields to `Shot` in `src/shared/types.ts`, keeping legacy stroke fields optional for migration.
- [ ] Implement minimal pure helpers in `src/shared/projectOps.ts`: bitmap path construction, layer order normalization, add/select/update/reorder/delete/clear operations, and initial Image layer metadata creation.
- [ ] Run `npm run test -- src/shared/projectOps.test.ts` and confirm the file passes.
- [ ] Run `npm run test` and confirm all tests still pass.

## Task 2: Layer Asset API And Folder Initialization

**Files:**
- Modify: `electron/main/main.ts`
- Modify: `electron/preload/preload.ts`
- Modify: `electron/preload/preload.cjs`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/projectOps.test.ts`

- [ ] Add failing tests for ordinary scanned images receiving Image bitmap layer metadata with `.storyboard-workbench/layers/{shotId}/{layerId}.png` relative paths.
- [ ] Add Electron main helpers to create layer directories, write PNG buffers, read PNG data URLs, delete layer files, and initialize Image layer PNGs from source images.
- [ ] Expose renderer-safe preload APIs for layer asset write/read/delete.
- [ ] Ensure open-folder initialization creates internal layer assets for PNG/JPG/TIFF shots without requiring Import.
- [ ] Run targeted tests, then `npm run test`.

## Task 3: Renderer Bitmap Drawing Path

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `src/shared/projectOps.ts`
- Modify: `src/shared/projectOps.test.ts`

- [ ] Add failing shared tests for command-level layer snapshot bookkeeping where pure logic applies.
- [ ] Replace active drawing target selection with `shot.activeLayerId` from bitmap layers.
- [ ] Draw brush pixels into the active bitmap layer canvas.
- [ ] Erase by clearing alpha from the active bitmap layer canvas.
- [ ] Save active layer PNG to `.storyboard-workbench/` after stroke completion through preload API.
- [ ] Keep real TIFF writes out of the drawing path.
- [ ] Preserve `B` / `E` shortcuts.
- [ ] Run `npm run test` and `npm run typecheck`.

## Task 4: Save-Time Bitmap Layer Composite

**Files:**
- Modify: `electron/main/main.ts`
- Modify: `src/shared/projectOps.ts`
- Modify: `src/shared/projectOps.test.ts`

- [ ] Add failing tests proving Save rename preflight remains unchanged while bitmap layer metadata is present.
- [ ] Replace Save-time stroke overlay baking with sharp compositing of visible bitmap layer PNGs in order.
- [ ] Apply opacity and supported blend modes: `normal`, `multiply`, `screen`.
- [ ] Keep hidden layers out of the composite.
- [ ] Keep `Save` as the only path that writes working TIFF pixels.
- [ ] Run `npm run test`, `npm run typecheck`.

## Task 5: Legacy Stroke Migration

**Files:**
- Modify: `electron/main/main.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/projectOps.ts`
- Modify: `src/shared/projectOps.test.ts`

- [ ] Add failing tests for detecting legacy shots with `sketchLayers`, `imageLayerEdits`, `baseVisible`, or `activeLayerTarget`.
- [ ] Implement migration metadata helpers that create bitmap layer records preserving order, names, visibility, opacity, locked state, and blend mode.
- [ ] Rasterize the old Image layer and each old sketch layer to PNG assets during project open.
- [ ] Save migrated JSON so subsequent opens use bitmap layers.
- [ ] Keep legacy fields optional only for migration input, not active renderer flow.
- [ ] Run `npm run test`, `npm run typecheck`.

## Task 6: Onion Skin, Timeline, Undo/Redo, Layer Panel

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/onionSkin.ts`
- Modify: `src/renderer/onionSkin.test.ts`
- Modify: `src/renderer/styles.css`

- [ ] Update onion skin rendering to use neighboring shots' bitmap layer composite preview instead of strokes.
- [ ] Keep onion skin preview-only: no JSON, PNG, TIFF, or Save output changes.
- [ ] Update layer panel to operate on bitmap layers uniformly, including Image layer clear behavior.
- [ ] Cap undo/redo history and include bitmap layer snapshots for stroke, clear, delete, and layer operations.
- [ ] Run `npm run test`, `npm run typecheck`.

## Task 7: Full Verification And Documentation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `decisions.md`
- Modify: `context-handoff.md`
- Modify: `todo.md`

- [ ] Update docs only after implementation reflects bitmap layer behavior.
- [ ] Run `npm run test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Perform minimal Electron smoke when feasible: open folder, draw on Image, add paint layer, switch layer, erase, Save, reopen.
- [ ] Mark any GUI behavior that was not smoke-tested as `TODO: verify` in `context-handoff.md` or `todo.md`.
