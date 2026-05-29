# Context Handoff

跨 session 交接文档。稳定规则见 `AGENTS.md` 和 `decisions.md`，待办事项见 `todo.md`。此处记录当前代码状态快照，每次 session 结束时覆盖重写。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `bitmap-layer-refactor`
- Functional baseline before this handoff-doc commit: `4135066 spike: verify photoshop layered tiff output`
- Original worktree remains at `/Users/xiali/Documents/Codex/2026-05-25/applications-mentioned-by-the-user-appshot` on `master`; continue new work from the `appshot-bitmap-layers` worktree unless explicitly merging back.

## Current Product State

- Storyboard Workbench is a local Electron + React + TypeScript + Vite app.
- One local image folder is still one scene; metadata autosaves to `.storyboard-workbench/storyboard.project.json`.
- Drawing is now bitmap-layer based:
  - JSON stores `shots[].layers` and `activeLayerId`.
  - Editable pixels live in `.storyboard-workbench/layers/{shotId}/{layerId}.png`.
  - Brush, eraser, clear, delete, undo, and redo operate on internal PNG layer assets plus JSON metadata.
- `Save` remains the only boundary that changes real delivery files: it performs filename sync, archives originals when needed, and bakes visible SWB layers into working TIFF.
- `Image` is treated like a normal visible layer in the UI: it can be selected, drawn on, erased, cleared, hidden, and deleted when another layer remains. Deleting it removes its metadata and internal `layer-image.png`; it does not immediately delete or move the original source file.
- Legacy `sketchLayers` and `imageLayerEdits` remain migration inputs only. New renderer editing no longer depends on the old stroke model.

## Completed Work

- Bitmap layer refactor:
  - Added bitmap layer metadata and internal PNG layer assets.
  - Ordinary PNG/JPG/TIFF folders initialize editable `Image` bitmap layers automatically.
  - Renderer drawing writes active layer pixels under `.storyboard-workbench/layers/`.
  - Undo/redo restores affected bitmap layer PNG snapshots and JSON metadata.
  - Save composites visible bitmap layers into SWB-owned TIFF while preserving rename preflight and Archive safety.
  - Legacy stroke projects migrate visible old image edits and sketch layers into bitmap layer PNG assets.
- Layer UX and smoke coverage:
  - Paint layer add/draw/erase/undo/opacity/blend/reorder/delete flows are covered by Electron CDP smoke.
  - `Image` layer delete now truly removes the layer when multiple layers exist; only one remaining layer disables delete.
  - Add Shot smoke verifies blank TIFF creation plus UI and metadata update.
  - Mixed 16:9 / 2.39:1 / 1.43:1 animation layout, high-zoom timeline visibility, Onion Skin, and current-shot drawing isolation are covered in `npm run smoke:bitmap`.
- Photoshop layered TIFF spike:
  - Added `scripts/photoshop-layered-tiff-spike.py`.
  - Added `docs/photoshop-layered-tiff-spike.md`.
  - Generated `/private/tmp/swb-photoshop-layered-spike.tiff` using Python `psdtags + tifffile`.
  - Photoshop 2026 opened the file as a layered document with `layers=2`, names `Paint 1,背景`, size `320 x 180`, RGB mode.
  - A sharp/libvips standard multi-page TIFF control opened in Photoshop as one background layer, proving ordinary multi-page TIFF is not enough for Photoshop layer recognition.

## Latest Verification

Fresh verification before this handoff update:

```bash
npm run test
# passed: 7 test files, 73 tests

npm run typecheck
# passed

npm run build
# passed; Vite reported the existing chunk-size warning only
```

Earlier full Electron smoke evidence on this branch:

```bash
npm run smoke:bitmap
# passed; launches Electron via local CDP
```

The smoke covers Image layer draw/erase/clear/delete, paint layer draw/erase/undo/opacity/blend/reorder, Add Shot, Save safety, Archive original hash preservation, mixed-aspect animation mode, Onion Skin, reopen persistence, and legacy stroke migration.

## Next Handoff Target

The next large direction discussed is PSD-first Photoshop interoperability. Do not wire this directly into the main Save path first.

Recommended next step:

1. Build a small PSD spike, separate from app UI and Save.
2. Prefer testing `ag-psd` first because it is TypeScript/JavaScript and fits the current Electron main-process stack.
3. Verify both directions with Photoshop 2026:
   - Read a simple Photoshop-created RGB 8-bit raster PSD and extract layers.
   - Write a simple multi-layer raster PSD and confirm Photoshop sees editable layers.
4. Record limitations clearly: v1 should target raster RGB 8-bit PSD layers, not full Photoshop round-trip of text layers, smart objects, adjustment layers, masks, effects, CMYK, 16-bit, or PSB.
5. Keep SWB internal working data as PNG layer assets + JSON unless a later spike proves a safer architecture.

## Known Remaining Work

- Manually verify multi-select shot dragging and double-click dialogue editing after the bitmap layer refactor.
- PSD-first spike and compatibility matrix are not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the Vite chunk-size warning.
