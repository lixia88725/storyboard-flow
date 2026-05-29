# TODO

## P0

- [ ] Manually verify multi-select shot dragging and double-click dialogue editing after the bitmap layer refactor.

## P1

- [ ] Dogfood bitmap Select tool V1 on real storyboard files; note lasso/rectangle move and scale UX issues before adding more features.
- [ ] Revisit layer drawer pointer-drag open/close only after a small visual mock/prototype proves the occlusion and animation model.
- [ ] Spike PSD-first workflow with `ag-psd`: read Photoshop-created RGB 8-bit raster PSD layers, write SWB raster layers back to PSD, and verify both directions in Photoshop 2026.
- [ ] Define PSD complex-layer policy for text, smart objects, adjustment layers, shapes, masks, effects, CMYK, 16-bit, and PSB. Recommended v1 default: rasterize unsupported layer types and mark them as such.
- [ ] Add PSD import layer parsing once the spike proves the library path.
- [ ] Add PSD export round-trip smoke: import PSD, edit/add/reorder layers, Save/Export PSD, reopen in Photoshop and SWB.
- [ ] Verify Photoshop PSD compatibility on Windows, not only macOS.
- [ ] Improve marquee selection so it is usable when the board is dense.
- [ ] Add validation or cleanup for missing Recent folder paths.
- [ ] Add UI feedback for autosave failures that persists long enough for users to notice.
- [ ] Add clearer Save conflict resolution UI beyond the current preflight error message.

## P2

- [ ] Consider a dedicated select/hand/draw tool mode if drawing, selecting, and dragging conflict in real use.
- [ ] Review whether `electron/preload/preload.cjs` should continue to be manually maintained or generated from TypeScript.
- [ ] Consider opacity controls for Onion Skin if fixed red/green ghost strength feels too strong or too weak.
- [ ] Consider code splitting or manual chunks if the existing Vite chunk-size warning becomes noisy or affects startup.

## Completed

- [x] Save rename preflight.
- [x] Multi-select storyboard drag ordering and stacked preview.
- [x] Compact dialogue strip.
- [x] Remove storyboard image white border/chrome.
- [x] Brush color and opacity controls.
- [x] Zoom-driven animation mode.
- [x] Timeline click jump.
- [x] Animation mode left/right direct switching.
- [x] Storyboard mode arrow-key grid selection.
- [x] `B` / `E` brush and eraser shortcuts.
- [x] Drawing in animation mode and zoom > 100%.
- [x] Save naming menu with Project / Scene / Artist / Version.
- [x] Status popover in bottom-right.
- [x] Recent dropdown merged into centered address bar.
- [x] Add Shot split menu for `16:9`, `2.39:1`, `1.43:1`.
- [x] Real image aspect-ratio display with no black bars.
- [x] Mixed-size animation centering fix.
- [x] Dark workbench theme.
- [x] SWB layer panel MVP.
- [x] Onion Skin toggle in animation mode.
- [x] Image layer can be drawn, erased, and deleted like a normal layer in UI.
- [x] Removed old `sketchData` compatibility layer.
- [x] Bitmap layer metadata and internal PNG layer assets.
- [x] Ordinary PNG/JPG/TIFF folders initialize editable bitmap layers automatically.
- [x] Renderer drawing writes active layer PNG under `.storyboard-workbench/layers/`.
- [x] Save composites visible bitmap layers into working TIFF while preserving rename preflight.
- [x] Legacy stroke metadata is migrated into bitmap layer metadata/assets.
- [x] Electron GUI smoke verified paint layer add/hide/opacity/delete autosave and PNG cleanup.
- [x] Undo/redo history captures affected bitmap layer PNG snapshots for stroke, clear, and delete.
- [x] Electron CDP smoke verified Image layer drawing changes internal PNG hash and undo/redo restores the expected hashes.
- [x] Added repeatable `npm run smoke:bitmap` Electron CDP smoke for Image layer draw/undo/redo/clear/Save/reopen.
- [x] Electron CDP smoke verified Image layer eraser and layer-panel Delete current layer clear/undo behavior.
- [x] Electron CDP smoke verified paint layer add/draw/erase/undo/opacity/blend mode/Save/reopen behavior.
- [x] Electron CDP smoke verified paint layer drag sorting updates JSON order.
- [x] Electron CDP smoke verified Save temp-conflict blocking, archive original hash preservation, multi-shot SWB-owned TIFF naming/status, and unit coverage still verifies final/temp rename preflight conflicts.
- [x] Electron CDP smoke verified mixed 16:9 / 2.39:1 / 1.43:1 animation stage ratios and high-zoom timeline visibility.
- [x] Electron CDP smoke verified Onion Skin animation-only toggle, previous/next ghost filters, left/right neighbor refresh, and current-shot drawing isolation.
- [x] Electron CDP smoke verified legacy `imageLayerEdits` and `sketchLayers` migrate into visible bitmap layer PNG assets.
- [x] Electron CDP smoke verified Add Shot creates a blank TIFF and updates the storyboard UI and metadata.
- [x] Image layer delete now behaves like normal layer delete when another layer remains; smoke verifies metadata removal, PNG asset deletion, Save output, and reopen persistence.
- [x] Photoshop layered TIFF spike generated a Photoshop 2026-readable layered TIFF with `psdtags + tifffile`.
- [x] Photoshop 2026 verification confirmed the layered TIFF opens with two layers; sharp/libvips standard multi-page TIFF opened as one background layer.
- [x] Added bitmap Select tool V1 with lasso and rectangle selection, active-layer move, corner scale, transient marching-ants UI, and undo snapshots.
- [x] Added geometry/unit coverage for bitmap selection bounds, hit testing, scaling, row drag intent, opacity mapping, row placement, and blend menu direction.
- [x] Added live eraser bitmap preview during pointer movement.
- [x] Restricted brush/eraser/select right-click settings menus to the storyboard image stage.
- [x] Added five custom brush color swatches with click-to-pick and double-click color picker.
- [x] Fixed paint layer creation so new layers stay transparent.
- [x] Made Image layer reorderable like ordinary bitmap layers.
- [x] Fixed layer thumbnails to show actual bitmap layer PNG content.
- [x] Moved blend mode controls into per-row colored dots and verified normal/multiply/screen metadata and stage preview.
- [x] Added layer row gestures: vertical drag reorders, horizontal drag adjusts opacity, with row opacity fill visualization.
- [x] Kept layer rows fixed height and added dragged-row preview while reordering.
- [x] Verified layer drag-to-bottom through the panel blank area in smoke.
- [x] Replaced the global Layers popover with a per-shot click-toggle layer drawer aligned beside the storyboard image.
- [x] Removed the experimental pointer-drag open/close behavior for the layer drawer; click toggle remains.
- [x] Made top status bar and tool rail sticky while scrolling.
- [x] Reduced top bar and shot header height; removed raw source filename display from shot headers.
- [x] Added mouse-wheel zoom over the storyboard image stage.
- [x] Restyled and repositioned the status/info button to be smaller and less urgent.
- [x] Expanded `npm run smoke:bitmap` to cover layer drawer click toggle, thumbnails, blend menu direction, opacity drag, layer row drag preview, selection move/scale, eraser preview, right-click stage scoping, and wheel zoom.

## Out Of Scope For Current MVP

- AI prompt fields or AI export.
- PDF or image sequence export.
- SQLite migration.
- Cloud sync or collaboration.
- Photoshop layer round-trip as a production feature.
- Full Photoshop-compatible multi-layer TIFF writing as a production Save path.
