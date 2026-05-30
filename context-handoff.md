# Context Handoff

跨 session 交接文档。稳定规则见 `AGENTS.md` 和 `decisions.md`，待办事项见 `todo.md`。此处记录当前代码状态快照，每次 session 结束时覆盖重写。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `bitmap-layer-refactor`
- Latest committed baseline in this session: `0cd5b5f test: align smoke with deferred layer assets`
- Previous committed baseline: `5cbedf9 refactor: clarify save and active layer targets`
- Previous committed baseline: `40873ea fix: stabilize bitmap layers and animation mode`
- Earlier handoff baseline: `4744696 交接存档：记录快捷键和动画模式小修`
- Previous handoff baseline: `58f24b9 交接存档：记录 bitmap 图层交互与选区 V1`
- Photoshop layered TIFF spike handoff baseline: `12a2f7a 交接存档：记录 Photoshop 图层格式验证和后续 PSD 方向`
- Functional bitmap baseline: `4135066 spike: verify photoshop layered tiff output`
- Continue in this bitmap worktree unless explicitly asked to merge or switch.

## Current Product State

- Storyboard Workbench is a local Electron + React + TypeScript + Vite app.
- One local image folder is one scene; metadata autosaves to `.storyboard-workbench/storyboard.project.json`.
- Drawing is bitmap-layer based:
  - JSON stores `shots[].layers` and `activeLayerId`.
  - Editable pixels live in `.storyboard-workbench/layers/{shotId}/{layerId}.png`.
  - Brush, eraser, clear, delete, undo, redo, bitmap Select move, and bitmap Select corner scale operate on internal PNG layer assets plus JSON metadata.
- `Save` remains the only boundary that changes real delivery files: it performs filename sync, archives originals when needed, and bakes visible SWB layers into working TIFF.
- `Image` behaves like a normal layer in the UI: selectable, drawable, erasable, clearable, reorderable, and deletable when another layer remains.
- Legacy `sketchLayers` and `imageLayerEdits` remain migration inputs only. New renderer editing no longer depends on the old stroke model.
- Keyboard shortcuts are configurable from the gear button at the top of the tool rail and are persisted in the local Electron `userData` settings file.
- Photoshop layered TIFF import/export are now explicit Photoshop exchange paths, not part of `Save`: `Export TIFF` writes one Photoshop-readable layered TIFF per shot under `Photoshop TIFF Export/YYYYMMDDTHHMMSS/`; existing `Import` ingests Photoshop layered TIFF raster layers into SWB-owned bitmap layer PNG assets and archives the source TIFF.

## Completed This Session

- Photoshop layered TIFF export:
  - Created branch `photoshop-layered-tiff-export`.
  - Added `scripts/photoshop-layered-tiff-export.py`, a manifest-driven production helper based on the validated spike.
  - Added Electron export planning/orchestration in `electron/main/photoshopTiffExport.ts`.
  - Added `workspace:exportPhotoshopTiffs` IPC and preload APIs.
  - Added a top-toolbar `Export TIFF` action that exports the current whole scene, one TIFF per shot, without changing `Save`.
  - Export output goes to `Photoshop TIFF Export/YYYYMMDDTHHMMSS/` under the current scene folder.
  - Development dependency path defaults to `/private/tmp/psdtags-spike-deps` unless `SWB_PYTHON_DEPS_DIR` is set.
  - Extended `npm run smoke:bitmap` to click `Export TIFF`, verify three exported TIFFs, and read back layer names through `psdtags`.
  - Live Photoshop 2026 verification opened an exported TIFF and reported `layers=2;names=Paint 1,背景;width=320;height=180;mode=DocumentMode.RGB`.
- Photoshop layered TIFF import:
  - Added `scripts/photoshop-layered-tiff-import.py`, which reads Photoshop `ImageSourceData` tag `37724`, extracts 8-bit raster layers to PNG assets, and writes a JSON manifest.
  - Added `electron/main/photoshopTiffImport.ts` for import planning, TIFF gating, no-layer fallback detection, path containment, and layer move destination preflight.
  - Integrated Photoshop layered TIFF detection into the existing `Import` flow: ordinary TIFFs fall back to the existing flat import path, while Photoshop layered TIFFs become SWB-owned bitmap layers.
  - Source Photoshop TIFFs are moved into `Archive/YYYYMMDDTHHMMSS/`; imported SWB layers live in `.storyboard-workbench/layers/{shotId}/`.
  - Added `swb.sourceKind: "photoshop-layered-tiff"` for imported Photoshop layered TIFF shots.
  - Autosave no longer materializes layer PNG assets for external non-owned shots, preventing provisional `layer-image.png` conflicts before explicit Import. Explicit Export/Save still ensure layer assets.
  - Extended `npm run smoke:bitmap` to verify SWB export -> Photoshop layered TIFF -> SWB import round trip, matching layer count, layer PNG assets, archived source TIFF, and `sourceKind`.
- Save rename safety:
  - Extracted the Electron two-stage rename executor into `electron/main/fileRenames.ts`.
  - Added rollback for execution failures after preflight, so files already moved to temporary or final names are restored to their original paths when possible.
  - Save now also keeps the applied rename rollback handle while TIFF import/bake/metadata writes run, so later Save failures can attempt to restore renamed files.
  - Added Electron-side Vitest coverage for final-rename failure rollback and included Electron tests in the Vitest config while excluding test files from the Electron build.
- Save / bake boundary refactor:
  - `workspace:save` now delegates to a focused `saveWorkspace` helper, keeping the Save flow readable as rename, SWB import, TIFF metadata/bake, then project JSON write.
  - TIFF metadata writing now uses small helpers for TIFF eligibility, working-TIFF baking, and SWB metadata construction.
  - This pass is structure-only; it does not change Save semantics, filesystem boundaries, renderer behavior, or the bitmap layer data model.
- Renderer active target refactor:
  - Extracted active storyboard and active visible bitmap-layer resolution into `src/renderer/activeTargets.ts`.
  - `App` and `SketchPad` now share the same rule: use the active layer only when it is visible, otherwise fall back to the topmost visible bitmap layer.
  - Added renderer unit coverage for selected-shot lookup, command fallback, hidden active layer fallback, and no-visible-layer cases.
- Bitmap layer undo cleanup:
  - Added a dedicated add-bitmap-layer path that records the new layer PNG path in the undo entry before metadata changes.
  - Undoing a newly added bitmap layer now removes its internal PNG asset if the asset did not exist before the layer was added; redo restores both metadata and asset.
  - Expanded `npm run smoke:bitmap` to verify add-layer undo removes metadata and the internal PNG, then redo restores both.
- Import and metadata write safety:
  - Added rollback for `importProjectToSwbFormat` archive and target moves.
  - If import succeeds but later Save / Import SWB metadata writes fail, the imported working TIFFs and archived originals are rolled back in reverse order.
  - Metadata temp replacement now deletes the `.storyboard-metadata-*` temp file on replace failure and still cleans baked temp TIFFs.
  - Added Electron-side Vitest coverage for import move rollback handles and metadata temp cleanup.
- Metadata typing and asset consistency:
  - Aligned shared `SwbImageMetadata.layers` typing with Electron metadata fields (`kind`, `bitmapPath`, `width`, `height`) and removed a local cast.
  - Expanded `npm run smoke:bitmap` to scan `.storyboard-workbench/layers` and fail if unreferenced PNG layer assets remain.
- Audit cleanup:
  - Kept cleanup local to the audit diff: clarified Electron file-move helper naming, deduplicated rollback call sites, and extracted small smoke helpers for layer asset checks.
  - Did not split `App.tsx`, split the full smoke script, change UI behavior, or address the existing Vite chunk-size warning.
- Bitmap layer behavior fixes:
  - Save now flattens all visible bitmap layer PNGs in one composite call, so lower visible layers are preserved in the working TIFF instead of only the last/top layer.
  - Layer opacity is applied by multiplying each layer PNG alpha before compositing into the working TIFF.
  - Hidden bitmap layers are no longer valid active layer targets; hiding the active layer selects the topmost visible layer when one exists.
  - Starting a brush/eraser/select interaction on a storyboard canvas now also selects that storyboard, so Clear layer targets the canvas that was just edited.
  - Animation mode suppresses the stale header focus outline so the current storyboard focus is represented by the active red frame only.
- Animation mode single-shot layout:
  - Animation mode now renders only the active storyboard in the main board area; the timeline still renders all shot thumbnails for navigation.
  - Removed the dark mask overlay that previously hid non-focused storyboard cards, because non-active cards are no longer mounted in the animation board.
  - Existing `ShotCard` / `SketchPad` / bitmap layer / Onion Skin paths are reused; this is a layout-level split, not a second animation drawing stack.
- Toolbar and shortcut system:
  - Added a gear button at the top of the tool rail for editing shortcuts.
  - Added configurable shortcuts for Brush, Eraser, Select, Clear layer, Save, Add Shot, Onion Skin, previous/next shot, Undo, and Redo.
  - Persisted shortcut settings through Electron IPC in `keyboard-shortcuts.json` under `app.getPath("userData")`.
  - Added `SWB_USER_DATA_DIR` override so Electron smoke can isolate local settings.
  - Default `Clear layer` shortcut is now `Escape`; shortcut capture accepts `Escape`, while `Backspace` / `Delete` clear a shortcut.
  - Menus consume `Escape` first, so closing a menu does not accidentally clear the active bitmap layer.
- Zoom and storyboard header UI:
  - Mouse wheel over the workbench now always adjusts Zoom, including blank board space; the old blank-area vertical scroll behavior is removed.
  - Shot headers are shorter, the `#` and black badge were removed, and the whole header bar is the drag activator with a subtle grip on hover.
- Dialogue UI:
  - Dialogue drag grip is low-contrast gray instead of red.
  - Empty dialogue hint is lower contrast.
  - Dialogue textareas auto-size from 1 to 3 rows and clamp input to three explicit lines.
- Select tool icon and bitmap selection:
  - Select tool icon was changed from a pointer arrow to a lasso-style icon.
  - Bitmap Select corner hit testing now converts a 12px screen target into canvas coordinates, making lasso / rectangle corner scaling reachable on high-resolution images.
- Animation mode:
  - Timeline scrollbar is visually hidden.
  - Animation mode renders one active storyboard in a stable dark frame while the timeline shows all shots.
  - Mixed-aspect shots are centered inside the stable frame without stretching, reducing visual jumps when stepping left/right.
  - Left/right timeline navigation works even when focus is on the Zoom range input.
- Smoke coverage:
  - `npm run smoke:bitmap` now isolates keyboard shortcut settings, verifies shortcut persistence, verifies blank-board wheel zoom, dialogue row clamp, animation left/right key events via CDP, range-focus timeline navigation, and existing bitmap layer/select flows.

## Latest Verification

Fresh verification before this handoff update:

```bash
npm run test
# passed: 13 test files, 120 tests

npm run typecheck
# passed

npm run build
# passed; Vite reported the existing chunk-size warning only
```

Latest Electron smoke from this session:

```bash
npm run smoke:bitmap
# passed; launches Electron via local CDP and verifies Photoshop TIFF export/import round trip
```

Additional manual/live validation:

```text
Photoshop 2026 opened /private/tmp/swb-photoshop-export-validation/Photoshop TIFF Export/20260529T171628/0010-shot.tiff
Result: layers=2; names=Paint 1,背景; width=320; height=180; mode=DocumentMode.RGB
```

The smoke intentionally triggers a Save temporary rename conflict and logs `Temporary rename file already exists`; this is expected inside the conflict-safety test when the command exits 0.

## Current Git State

Recent Photoshop layered TIFF import commits include:

```bash
cf8bfd7 feat: extract photoshop tiff layers for import
4bdd17e feat: plan photoshop tiff import assets
8a36ebc feat: import photoshop layered tiffs into swb layers
c5849fc fix: skip layer assets for external shots
0cd5b5f test: align smoke with deferred layer assets
```

Current session documentation changes are pending commit until the final docs update is complete.

## Next Handoff Target

Recommended next steps:

1. Manually dogfood the configurable shortcut panel in the packaged app, especially recording `Escape`, conflict errors, and persistence across app restarts.
2. Manually verify bitmap Select lasso and rectangle scaling on real high-resolution storyboard images; automated smoke covers selection move/scale, but hand feel still matters.
3. Manually review animation mode with mixed 16:9 / 2.39:1 / 1.43:1 shots and decide whether the stable dark matte should be visually refined.
4. Manually verify multi-select shot dragging and double-click dialogue editing, because those dnd-kit / text-editing flows are still best checked in the app.
5. If the next session starts implementation work, a good small feature is making layer lock behavior truly enforce drawing/editing restrictions before adding larger Photoshop interoperability work.
6. If drawer drag is revisited, start with a tiny visual mock/prototype first. Do not re-add pointer-drag drawer code directly into production UI without a clearer occlusion/animation model.
7. Replace the temporary Python dependency path for Photoshop TIFF import/export with a packaged or installer-managed dependency story before treating the feature as distribution-ready.
8. PSD-first Photoshop interoperability remains a future spike, separate from the main Save path.

## Known Remaining Work

- Manual dogfood remains needed for shortcut editing, bitmap Select hand feel, mixed-aspect animation matte, multi-select shot dragging, and double-click dialogue editing.
- Bitmap Select tool is still V1: no rotation, feathering, magic wand, saved selections, cross-layer transform, or free transform.
- Layer `locked` exists in metadata/UI but still needs a product pass to define and enforce which operations are blocked.
- Pointer-drag open/close for the layer drawer was removed; future rework needs a better interaction design first.
- PSD-first spike and compatibility matrix are not implemented.
- Photoshop layered TIFF import/export currently relies on Python deps available via `SWB_PYTHON_DEPS_DIR` or `/private/tmp/psdtags-spike-deps`; packaging is not solved.
- Photoshop layered TIFF import supports raster layer ingestion for V1; full Photoshop feature round-trip is not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the Vite chunk-size warning.
