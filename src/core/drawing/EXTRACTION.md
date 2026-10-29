# Drawing extraction map (wave 1)

Status: **navigation document only.** Nothing below is extracted yet. The only thing that exists in
`src/core/drawing` today is the image-document edit Interface (`applyImageEdit`), which models layer
structure, properties, lock policy, pixel-asset references and revisions. No pixel algorithm, no
canvas, no IPC and no GUI moved behind it.

**The production app still runs the old drawing path.** `src/renderer/SketchPad.tsx`,
`bitmapLayerCanvas.ts`, `bitmapLayerPaintingController.ts`, `bitmapLayerActions.ts`,
`src/shared/projectOps.ts` and `electron/main/bitmapLayers.ts` are unchanged and still own every
gesture the user can perform.

Future-owner names below are *proposals* for the coordinator to accept or replace; they are not
contracts. Locations are current line numbers and will drift.

## 1. What wave 1 already covers

| Legacy concept | Wave-1 equivalent | Note |
|---|---|---|
| `BitmapLayer.order` (number, renormalized on every edit) | array index of `ImageDocumentV1.layers` (bottom-to-top) | `order` disappears; array order is authoritative (CONTRACTS.md) |
| `BitmapLayer.bitmapPath` (workspace-relative PNG path) | `LayerV1.assetId` (lowercase SHA-256 of encoded PNG) | path binding belongs to the persistence lane |
| `id`, `name`, `kind`, `visible`, `locked`, `opacity`, `blendMode`, `width`, `height` | same fields in `LayerV1` | blend modes reduced to `normal`/`multiply`/`screen`, as in `projectOps.bitmapBlendModes` |
| `shot.activeLayerId` | **no equivalent** | UI selection state; see QUESTIONS.md Q7 |
| `BitmapLayer.cleared` (marker for a cleared pixel file) | **no equivalent** | would become a real pixel effect (`replacePixels` with an empty asset) |
| pinned `layer-matte-overlay` / `layer-dialogue-overlay` ordering (`projectOps.normalizeBitmapLayerOrder`) | **no equivalent** | V1 has no pinned overlay layers; see QUESTIONS.md Q6 |
| `uniqueBitmapLayers` (dedupe by id *and* `bitmapPath`) | duplicate ids rejected as `invalid-input` | sharing one asset reference between two layers is allowed and intentional |

Legacy mutators replaced by this Interface: `projectOps.addBitmapLayer` (insert),
`deleteBitmapLayer` (remove), `moveBitmapLayer` / `moveBitmapLayerGroup` (move),
`updateBitmapLayer` / `updateBitmapLayerGroupOpacity` (set) and the metadata half of
"paint into this layer" (`replacePixels`).

## 2. Capability → future owner

| Capability | Current entry point(s) | Current dependencies | Existing coverage | Proposed future owner | Remaining real-GUI check |
|---|---|---|---|---|---|
| Brush / paint stroke | `drawStrokeOnBitmapLayer` `src/renderer/bitmapLayerCanvas.ts:242`; `drawStrokePathOnCanvas` `src/renderer/sketchRendering.ts:183`; pointer pipeline in `SketchPad.tsx` + `bitmapLayerPaintingController.ts` (stroke path ~`250-300`) | DOM `<canvas>`, `Image`/data-URL loading, `window.storyboard.readLayerPng`/`writeLayerPng` (IPC), write queue, asset-intent admission, React refs/hooks | `bitmapLayerCanvas.test.ts`, `sketchRendering.test.ts`, `bitmapLayerPaintingController.test.ts`, `bitmapHistoryComposition.test.ts` | `src/core/drawing/paint/` behind a pixel-surface port; produces a new asset reference handed to `applyImageEdit({kind:"replacePixels"})` | Stroke feel, latency under 1920×1080, softness ramp, stylus/trackpad behaviour, one stroke vs. held stroke |
| Eraser | same path with `globalCompositeOperation = "destination-out"` (`sketchRendering.ts:190`); `E` hold in `appKeyboardShortcutsController.ts` | DOM canvas, same IPC/queue as brush | same files as brush | same pixel-surface owner | Partial-alpha erase across a paint layer over the image layer; eraser on a locked layer must stay refused |
| Paint bucket fill | `fillBitmapLayerAtPoint` `bitmapLayerCanvas.ts:268`; `fillImageDataAtPoint` `sketchRendering.ts:127`; target gate `canFillBitmapLayer` `activeTargets.ts` | DOM canvas, `getImageData`/`putImageData`, IPC write | `bitmapLayerCanvas.test.ts`, `activeTargets.test.ts` | pixel-surface owner | Flood fill on anti-aliased edges and on a hidden/locked layer |
| Gaussian blur | `gaussianBlurBitmapLayer` + `normalizeGaussianBlurRadius` + `hasBitmapBlurSelection` `bitmapLayerCanvas.ts:15-21,180`; call site `bitmapLayerPaintingController.ts` ~`139-195` | DOM canvas `filter = blur()`, lasso selection points, IPC write | `bitmapLayerCanvas.test.ts`, `bitmapLayerPaintingController.test.ts` | pixel-surface owner | CSS-filter blur vs. real gaussian parity at radius 0.5/8/40 and along selection edges |
| Selection transform (lasso, move, scale, rotate) | `prepareTransformPreview` / `drawPreparedTransformPreview` / `commitSelectionTransform` `SketchPad.tsx:~635-935`; `applySelectionTransform` `bitmapLayerPaintingController.ts:~275-300`; geometry in `sketchGeometry.ts`; handle hit-test in `activeTargets.ts`/`SketchPad.tsx` | DOM canvas, pointer events, React state, IPC write; no filesystem access of its own | `sketchGeometry.test.ts`, `bitmapLayerPaintingController.test.ts`, `paintingCloseCompletion.test.ts` | `src/core/drawing/selection/` (transform as a pure function over a pixel surface + bounds) | Handle hit areas at 125 %/200 % display scaling, rotation preview vs. committed result, transform on a partially transparent layer |
| Merge down / merge selected / merge visible | metadata: `projectOps.mergeBitmapLayerDown:1380`, `mergeSelectedBitmapLayers:1428`, `mergeVisibleBitmapLayers:1466`; pixels: `mergeBitmapLayerFilesToPng` / `flattenBitmapLayerBuffersToPng` `electron/main/bitmapLayers.ts:39-124`; orchestration: `bitmapLayerActions.ts:201-494` | sharp, real filesystem paths, IPC (`mergeVisibleLayers`, `cleanupMergedLayerSources`), history snapshots, React hooks | `bitmapLayerActions.test.ts`, `bitmapHistoryComposition.test.ts`, `electron/main/bitmapLayers.test.ts`, `src/shared/projectOps.test.ts` | `src/core/drawing/merge/` (order + visibility + lock rules) calling a pixel compositor owned by the raster side, then `removeLayer` edits | Multi-select merge with the matte/dialogue overlays present; locked/visible refusal messages; source-asset cleanup |
| Matte overlay and dialogue text overlay | `createMatteOverlayDataUrl`, `expandBitmapLayerForMatte`, `collapseBitmapLayerFromMatte`, `dialogueOverlayText`, `createDialogueOverlayDataUrl` `bitmapLayerCanvas.ts:100-178`; metadata `projectOps.upsertDialogueOverlayBitmapLayer:316`, `applyShotMatte:255`, pinning in `normalizeBitmapLayerOrder:1659` | DOM canvas + `measureText` (system font stack), project-level matte settings, React (`shotPresentationController.ts`) | `bitmapLayerCanvas.test.ts`, `shotPresentationController.test.ts`, `projectOps.test.ts` | overlay generator producing an asset reference + `applyImageEdit` insert/replace; overlay *pinning* becomes an explicit ordering rule at the call site | Chinese/Japanese/Latin line breaking and font fallback, matte height vs. canvas height coupling, overlay refresh on text edit |
| Layer compositing / rendering | `drawBitmapLayerImageUrl`, `canvasBlendMode`, `cssBlendMode`, `drawImageUrl` `sketchRendering.ts:46-62,232-261`; Konva stage inside `SketchPad.tsx`; layer list rendering `LayerPanel.tsx` | DOM/Konva/React, data URLs, CSS blend modes | `sketchRendering.test.ts`, `ShotStaticMedia.test.ts`, `activeTargets.test.ts`, `LayerPanel`-level tests via `bitmapLayerActions.test.ts` | a renderer-owned compositor reading `ImageDocumentV1` + an asset reader; drawing core never renders | multiply/screen parity between canvas 2d, Konva and CSS at partial opacity |
| Layer metadata edits (add/remove/move/properties/lock/pixel reference) | **`src/core/drawing/index.ts` `applyImageEdit`** (wave 1, done) | none: pure functions, no DOM/React/FS/IPC | `src/core/drawing/index.test.ts`, `src/core/drawing/workload.test.ts` | this module | none for the Interface; the real check is `LayerPanel`/`ShotCard` call sites after wiring |
| Layer PNG read/write, asset identity, undo snapshots | `readLayerPng`/`writeLayerPng`/`createLayerPng`/`deleteLayerPng` and `layer-*.png` layout in `electron/main/bitmapLayers.ts`; `bitmapLayerWriteQueue.ts`; `bitmapLayerHistory.ts` `readLayerAssetSnapshots`; `projectHistoryController.ts` | IPC, filesystem, sharp, recovery namespace, history entries | `bitmapLayers.test.ts`, `bitmapLayerWriteQueue.test.ts`, `bitmapLayerHistory.test.ts`, `projectHistoryController` tests | persistence lane (`electron/core/persistence`, `assets/<sha256>.png`) + storyboard lane's history facade | atomic publication, crash recovery, external-change adoption for layer PNGs |

## 3. Deliberate behaviour changes in this Interface

Copied from the legacy code where the contract allowed it, explicitly not copied where it did not:

1. **No silent clamping.** `projectOps.updateBitmapLayer` clamped opacity into `[0,1]`; wave 1 returns
   `invalid-input` for `1.0001` (CONTRACTS.md "Opacity is finite in [0,1]").
2. **No silent lock drops.** Legacy ignored a locked layer's name/opacity/blend-mode patch and still
   reported success; wave 1 returns `locked` (see QUESTIONS.md Q1).
3. **No kind-based reordering.** `electron/main/bitmapLayerOrdering.ts` sorts `image` layers below
   `paint` layers; `projectOps.normalizeBitmapLayerOrder` pins matte/dialogue overlays on top and
   renumbers `order`. V1 stores order as the array and does neither (QUESTIONS.md Q6).
4. **No dedupe by file path.** Legacy dropped a second layer pointing at the same PNG; V1 allows two
   layers to reference one asset and only rejects duplicate layer ids.
5. **Revisions replace "dirty" flags.** There is no `markShotsDirty` here: every real edit increments
   `ImageDocumentV1.revision` exactly once, and `visualChanged` is the invalidation signal.

## 4. Suggested migration order (wave 2+, coordinator-owned)

1. **Asset sink**: give the persistence lane `readAsset(assetId)` and make a drawing-side
   `commitPixels(pngBytes) -> assetId` port. Until then `replacePixels` only adopts a reference the
   caller already has, which is why no pixel algorithm lives here.
2. **Metadata call sites first**: route `LayerPanel.tsx`, `ShotCard.tsx`, `layerMetadataActionController.ts`
   and `deleteActionController.ts` through `applyImageEdit` + a project-level facade. This is the
   cheapest step and needs the `activeLayerId` decision (QUESTIONS.md Q7).
3. **One pixel tool at a time, in this order**: brush → eraser (same path) → fill → blur → selection
   transform. Each should read pixels through the port, produce bytes, then call
   `applyImageEdit({kind:"replacePixels"})`; the existing write queue, admission and history stay as
   the outer shell until they are replaced too.
4. **Merge**: needs both the compositor and asset cleanup; keep `cleanupMergedLayerSources` semantics.
5. **Overlays last**: matte/dialogue pinning is an ordering rule, not a layer property, and needs a
   decision about whether overlays stay in `layers[]` at all.
6. **GUI acceptance**: none of the above can be claimed from unit tests. Each step needs a real-app
   check of the gesture listed in §2.

## 5. What this wave deliberately does not touch

- `src/shared/projectOps.ts`, `src/renderer/*`, `electron/main/*`: read-only references here.
- No `sharp`, no canvas, no DOM, no `window.storyboard`, no filesystem, no timers, no async in
  `src/core/drawing`. The workload test is synchronous on purpose.
- No vector `SketchLayer`/`SketchStroke` drafts: they are a retired model for bitmap drawing
  (`src/shared/retiredDrawingModel.test.ts` guards that) and are not part of `ImageDocumentV1`.
