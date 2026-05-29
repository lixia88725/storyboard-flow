# Context Handoff

跨 session 交接文档。稳定规则见 `AGENTS.md` 和 `decisions.md`，待办事项见 `todo.md`。此处记录当前代码状态快照，每次 session 结束时覆盖重写。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `bitmap-layer-refactor`
- Latest handoff baseline before this session: `12a2f7a 交接存档：记录 Photoshop 图层格式验证和后续 PSD 方向`
- Functional bitmap baseline before handoff docs: `4135066 spike: verify photoshop layered tiff output`
- Original master worktree remains at `/Users/xiali/Documents/Codex/2026-05-25/applications-mentioned-by-the-user-appshot`; continue bitmap exploration from this `appshot-bitmap-layers` worktree unless explicitly merging back.

## Current Product State

- Storyboard Workbench is a local Electron + React + TypeScript + Vite app.
- One local image folder is one scene; metadata autosaves to `.storyboard-workbench/storyboard.project.json`.
- Drawing is bitmap-layer based:
  - JSON stores `shots[].layers` and `activeLayerId`.
  - Editable pixels live in `.storyboard-workbench/layers/{shotId}/{layerId}.png`.
  - Brush, eraser, clear, delete, undo, redo, selection move, and selection scale operate on internal PNG layer assets plus JSON metadata.
- `Save` remains the only boundary that changes real delivery files: it performs filename sync, archives originals when needed, and bakes visible SWB layers into working TIFF.
- `Image` is treated like a normal visible layer in the UI: it can be selected, drawn on, erased, cleared, hidden, reordered, and deleted when another layer remains. Deleting it removes its metadata and internal `layer-image.png`; it does not immediately delete or move the original source file.
- Legacy `sketchLayers` and `imageLayerEdits` remain migration inputs only. New renderer editing no longer depends on the old stroke model.

## Completed This Session

- Bitmap selection / transform V1:
  - Added Select tool with lasso and rectangle modes.
  - Lasso/rectangle selection creates transient bitmap selection state for the active layer only.
  - Moving inside the selection and scaling from corner handles commits pixels back to the active layer PNG and records undo snapshots.
  - Switching away from Select clears selection UI handles.
  - Added geometry helpers/tests for selection bounds, hit testing, scaling, row drag intent, opacity mapping, and blend menu direction.
- Brush / eraser bitmap behavior:
  - Eraser now uses live bitmap canvas preview during pointer movement instead of only changing after mouseup.
  - Brush/eraser/select right-click settings only open when right-clicking inside the storyboard image stage, not on arbitrary UI.
  - Brush settings menu includes five color swatches; single click picks a swatch, double click opens the color picker and saves that swatch color.
- Layer model and layer panel:
  - New transparent paint layers stay transparent and no longer cover the Image layer with white.
  - Image layer is freely reorderable like any other layer.
  - Layer thumbnails render actual bitmap PNG layer content instead of an empty transparent preview.
  - Layer blend mode is per-row via a small colored dot: normal, multiply, screen. Multiply/screen preview uses CSS blend mode inside an isolated image stage.
  - Layer row drag now has two gestures: vertical drag reorders, horizontal drag changes opacity. All rows show opacity fill; active row keeps the red left bar.
  - Layer rows have fixed height; fewer layers no longer stretch to fill the panel.
  - Dragging a layer row vertically shows the dragged row following the pointer.
  - Dropping into the bottom blank area can move a layer to the bottom.
  - Blend mode menus open upward for lower rows so they are not clipped by the panel.
- Per-shot layer drawer UI:
  - Replaced the global layer popover with a per-shot drawer beside the current storyboard image.
  - Layer drawer aligns to the image/dialogue area, has compact footer add/delete buttons, a stronger shadow, and a vertical handle.
  - Drawer open/close uses a light animation.
  - Experimented with pointer-drag opening/closing, but removed that code before handoff because the visual model was not acceptable. Current behavior is click-only toggle via the handle.
- Storyboard/workbench UI:
  - Top status bar and tool rail stay fixed while scrolling the board.
  - Top bar height and shot header height were reduced; original image filename is no longer displayed in the shot header.
  - Selection red outline is no longer used as the default single-shot focus affordance; it is reserved for multi-select style feedback.
  - Mouse wheel over the image stage zooms the board.
  - Status/info button was moved to the lower bar area and restyled to be smaller and less urgent.
- Save/project data:
  - Shared project operations and tests now cover bitmap layer ordering, metadata, opacity/blend mode behavior, and migration edge cases touched by the bitmap-layer UI.
  - Electron smoke now covers the newer bitmap layer, layer panel, selection, eraser preview, blend mode, thumbnail, right-click, wheel zoom, Add Shot, Save, Archive, reopen, animation mode, Onion Skin, and legacy migration flows.

## Latest Verification

Fresh verification before this handoff update:

```bash
npm run test
# passed: 7 test files, 87 tests

npm run typecheck
# passed

npm run build
# passed; Vite reported the existing chunk-size warning only
```

Latest full Electron smoke from this session:

```bash
npm run smoke:bitmap
# passed; launches Electron via local CDP
```

The smoke intentionally triggers a Save temporary rename conflict and logs `Temporary rename file already exists`; this is expected inside the conflict-safety test when the command exits 0.

## Current Git Diff Before Commit

Files changed in this session:

- `scripts/electron-bitmap-smoke.mjs`
- `src/renderer/App.tsx`
- `src/renderer/sketchGeometry.test.ts`
- `src/renderer/sketchGeometry.ts`
- `src/renderer/styles.css`
- `src/shared/projectOps.test.ts`
- `src/shared/projectOps.ts`
- `src/shared/types.ts`

Doc files updated for this handoff:

- `context-handoff.md`
- `todo.md`
- `decisions.md`
- `README.md`
- `AGENTS.md`

## Next Handoff Target

Recommended next steps:

1. Manually dogfood the current click-only layer drawer and confirm the removed pointer-drag drawer interaction no longer appears.
2. Manually verify multi-select shot dragging and double-click dialogue editing, because those are dnd-kit / text-editing flows that are still best checked in the app.
3. Polish bitmap selection only after more user testing:
   - Lasso is functional but still V1.
   - Rectangle/lasso move/scale are active-layer only.
   - No rotation, feathering, magic wand, saved selections, or cross-layer transform.
4. If drawer drag is revisited, start with a tiny visual mock/prototype first. Do not re-add pointer-drag drawer code directly into production UI without a clearer occlusion/animation model.
5. PSD-first Photoshop interoperability remains a future spike, separate from the main Save path.

## Known Remaining Work

- Manually verify multi-select shot dragging and double-click dialogue editing after the bitmap layer refactor.
- Bitmap Select tool is V1 and needs real production dogfooding before deeper polish.
- Pointer-drag open/close for the layer drawer was removed; future rework needs a better interaction design first.
- PSD-first spike and compatibility matrix are not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the Vite chunk-size warning.
