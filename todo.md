# TODO

## P0

- [ ] Manually verify bitmap Image layer behavior in Electron:
  - Select `Image`, draw directly on it.
  - Erase on `Image` and confirm white background appears.
  - Click `-` while `Image` is selected and confirm the button still reads `Delete current layer`.
  - Undo/redo the delete.
  - Save, reopen, and confirm the visible result is preserved.
- [ ] Manually verify bitmap Onion Skin in animation mode:
  - Toggle appears only in animation mode.
  - Previous frame is red, next frame is green.
  - Left/right playback updates ghost frames.
  - Drawing still affects only the current shot.
- [ ] Manually verify mixed aspect-ratio animation playback:
  - 16:9, 2.39:1, and 1.43:1 shots show without black bars.
  - Left/right playback keeps every shot centered.
  - Timeline remains visible at high zoom.
- [ ] Manually verify bitmap Save safety after recent changes:
  - Rename preflight still blocks final and temporary path conflicts.
  - Save does not modify Archive originals.
  - Save naming still uses `项目名_场号_stb_艺术家名_版本号_0010.ext`.

## P1

- [ ] Manually verify legacy stroke project migration:
  - Old `sketchLayers` become paint bitmap layers.
  - Old `imageLayerEdits` become Image bitmap pixels.
  - Reopen uses bitmap layers as editable source.
- [ ] Add Electron smoke coverage or a repeatable manual checklist for:
  - Open folder.
  - Draw on Image.
  - Add/reorder/rename/hide layer.
  - Save.
  - Reopen.
- [ ] Improve marquee selection so it is usable when the board is dense.
- [ ] Add validation or cleanup for missing Recent folder paths.
- [ ] Add UI feedback for autosave failures that persists long enough for users to notice.
- [ ] Add clearer Save conflict resolution UI beyond the current preflight error message.

## P2

- [ ] Consider a dedicated select/hand/draw tool mode if drawing, selecting, and dragging conflict in real use.
- [ ] Review whether `electron/preload/preload.cjs` should continue to be manually maintained or generated from TypeScript.
- [ ] Consider opacity controls for Onion Skin if fixed red/green ghost strength feels too strong or too weak.
- [ ] Consider a real select/transform tool only after bitmap layer model is stable.

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
- [x] Added repeatable `npm run smoke:bitmap` Electron CDP smoke for Image layer draw/undo/redo.

## Out Of Scope For Current MVP

- AI prompt fields or AI export.
- PDF or image sequence export.
- SQLite migration.
- Cloud sync or collaboration.
- Photoshop layer round-trip.
- Full Photoshop-compatible multi-layer TIFF writing.
