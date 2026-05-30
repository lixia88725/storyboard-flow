# LayerPanel Extraction Audit

Date: 2026-05-30

## Goal

Prepare a small, behavior-preserving extraction of `LayerPanel` out of `src/renderer/App.tsx`.

This audit is intentionally read-only. It identifies the current boundary and the minimum safe extraction path. It does not propose changes to drawing, selection, Save, Import, or `SketchPad`.

## Current State

- `src/renderer/App.tsx` is 4159 lines.
- `LayerPanel` already exists as an internal component in `App.tsx` around the layer drawer UI.
- `ShotCard` owns the drawer mount/close animation state through `isLayerPanelRendered`.
- Top-level `App` owns which shot's layer panel is open through `isLayerPanelOpen`.
- Layer data changes still route through top-level project operations and history-aware handlers.

## Existing Boundary

`LayerPanel` currently receives these inputs:

- `shot?: Shot`
- `folderPath?: string`
- `thumbnailRevision: number`
- `isOpen: boolean`
- `isRendered: boolean`

It emits these events:

- `onToggle()`
- `onAddLayer(shotId)`
- `onRemoveLayer(shotId, layerId)`
- `onClearLayer(shotId, layerId)`
- `onSelectLayer(shotId, layerId)`
- `onUpdateLayer(shotId, layerId, patch)`
- `onMoveLayer(shotId, layerId, targetLayerId, placement)`

The component depends on:

- `BitmapLayerThumbnail`
- `bitmapLayersForShot`
- `activeVisibleBitmapLayerForShot`
- `sketchBlendModes`
- `blendMenuDirectionFromRects`
- `layerDropPlacementFromClientY`
- `layerOpacityFromClientX`
- `layerRowDragIntentFromDelta`
- `BitmapLayer`, `Shot`, and `SketchBlendMode` types

## State That Should Stay Outside

Keep these in `App.tsx` / `ShotCard` for the first extraction pass:

- `isLayerPanelOpen` in top-level `App`.
- `isLayerPanelRendered` in `ShotCard`, because it coordinates the card shell classes and close animation timing.
- Project mutation handlers: add, delete, clear, select, update, and move layer.
- Dirty-shot marking and undo/history work.

Moving these during the extraction would turn a file move into a behavior refactor.

## State That Can Move With LayerPanel

These are local to the panel and should move with it:

- `openBlendMenu`
- `rowGestureVisual`
- `LayerRowGesture`, `LayerRowGestureVisual`, and `BlendMenuState` types
- `interactiveLayerRowTarget`
- `layerRowFromPoint`
- `beginLayerRowGesture`
- `beginLayerVisibilityDrag`
- `blendModeLabel`

## Proposed First Extraction

Create:

- `src/renderer/LayerPanel.tsx`

Move from `App.tsx`:

- `LayerPanelProps`
- `LayerPanel`
- local layer gesture/menu types
- `blendModeLabel`

Keep in `App.tsx`:

- `ShotCard`
- `SketchPad`
- all project mutation handlers
- `isLayerPanelOpen`
- `isLayerPanelRendered`

After the move, `App.tsx` should import `LayerPanel` and continue passing the same props from `ShotCard`.

## Risks

- Pointer gestures use `document.elementsFromPoint`, `.layer-row`, `.layer-list`, and `data-layer-id`; CSS class names must remain unchanged.
- Visibility drag and row reorder depend on current display order being `bitmapLayersForShot(shot).reverse()`.
- Blend menu direction depends on row/list DOM geometry.
- Locked layer behavior is enforced partly in UI disabled states and partly in project operation handlers. The extraction must not weaken either.
- The global shortcut blocker checks `.layer-panel`; this class must remain on the panel root.

## Verification

For a pure extraction, run:

```bash
npm run test
npm run typecheck
npm run build
npm run smoke:bitmap
```

Manual or CDP smoke should inspect:

- Open/close layer drawer.
- Add layer.
- Delete current layer disabled when only one layer remains.
- Lock layer disables rename, blend mode, opacity drag, delete, and reorder.
- Visibility click and visibility drag.
- Opacity horizontal drag.
- Layer reorder vertical drag.
- Blend mode menu direction near top and bottom of the panel.

## Non-Goals

- Do not extract `SketchPad`.
- Do not change layer behavior.
- Do not change CSS.
- Do not change project data operations.
- Do not introduce a new layer state model.

