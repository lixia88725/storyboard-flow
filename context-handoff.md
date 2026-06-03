# Context Handoff

跨 session 接手页。稳定规则见 `AGENTS.md`，架构边界见 `decisions.md`，待办事项见 `todo.md`。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `bitmap-layer-refactor`
- Current handoff date: 2026-06-03
- Previous handoff baseline: `d50fe78 docs: record shot card extraction`
- Current goal of this handoff: preserve the latest feature work, validation results, and next-step map so another session or AI agent can continue without rediscovering context.

## Current Product State

- Storyboard Workbench is a local Electron + React + TypeScript + Vite app.
- One local image folder is one scene.
- Main project data lives in `.storyboard-workbench/storyboard.project.json`.
- Editable bitmap layer pixels live in `.storyboard-workbench/layers/{shotId}/{layerId}.png`.
- Root working TIFFs remain the visible delivery files.
- `Save` is still the only boundary that synchronizes real file names and writes working TIFF pixels.
- `Import` ingests non-SWB root images, external `storyboard-script.md` edits, incompatible external image changes, and explicit conflict cases.
- Compatible SWB TIFF edits from Photoshop can auto-import after Photoshop saves the TIFF, if the related shot has no local unsaved SWB edits.
- `Archive/` is only for preserving non-SWB originals during Import.
- User-deleted storyboard source files move to system Trash on Save, not Archive.
- `storyboard-script.md` is a human-editable mirror of JSON, not the primary data source.

## What This Session Finished

### Script Bootstrap And Project Creation

- Added first-pass Markdown storyboard bootstrap: numbered-list `.md` files can create a new SWB project in an empty folder.
- Generated shots receive the parsed item text as `scriptText`.
- The new project writes `.storyboard-workbench/storyboard.project.json` and root `storyboard-script.md`, then opens automatically.
- Existing Save / Import semantics were kept: no AI, no generated images, no append-to-existing-project flow.

### Parking Sidebar

- Added `project.parkedShots` for a right-side pending area.
- Main workspace renders only `project.shots`; parked shots stay in project JSON but do not enter Save output, filename sync, Timeline, or `storyboard-script.md`.
- Sidebar is opened and closed from the top-right sidebar button. Earlier edge-hover auto-open was removed because it conflicted with shot reorder intent.
- Parked shots can be restored into the main workspace by drag/drop.

### Layer Merge And Multi-Select

- Added Merge down / Merge visible workflows and then unified the drawer button label to `Merge`.
- `Cmd+E` on macOS and `Ctrl+E` on Windows/Linux now trigger the same Merge action as the button:
  - one selected layer: merge active layer down into the next visible layer.
  - multiple selected layers: merge selected visible/unlocked layers into the lowest selected layer.
- Merge visible now includes locked visible layers in the baked result, but preserves locked layer metadata/assets by hiding those locked source layers instead of deleting them.
- Added Shift-click layer multi-select, group reorder, group opacity drag, and consistent selected-row visuals.

### Option / Alt Copy Interactions

- Added Option/Alt drag copy for a single storyboard, layer, or dialogue item.
- Shot copy duplicates project metadata and assets, creates a PNG preview for the copy, and waits for Save to synchronize final names.
- Layer copy can target another shot or a specific insertion point in an open layer drawer.
- Dialogue copy keeps the original dialogue and appends a copy to the target shot.
- Shot drag preview now uses stable drag-start shot ids and PNG previews, with image-error fallback to avoid broken browser image icons.

### Drawing Stability And UI Polish

- Added a renderer bitmap layer write queue so fast brush strokes and eraser writes do not overwrite newer strokes with stale async layer writes.
- Simplified Select to lasso-only in the UI flow; the Rectangle choice UI was removed.
- Dialogue entry is single-click, with a cleaner transparent textarea and proportional dialogue-zone sizing.
- Shot card top and bottom bars were aligned visually and rounded.
- Layer drawer visuals were refined: selected-row bar, drawer shadow layering, and transparent scrollbar track.
- Delete/Backspace now deletes the last selected object: a clicked layer deletes the active layer, while a clicked storyboard deletes the selected storyboard(s).

### Save, Import, External Editing, And Close Flow

- Save progress now reports the actual changed TIFF write count instead of the whole project shot count.
- Added a Save error dialog for development/debug iteration.
- Close prompt now includes Save and Close, Close Without Saving, and Cancel.
- Fixed Save-and-Close close-loop behavior on larger projects by separating the save operation from the close confirmation state.
- External Photoshop edit detection now checks known SWB TIFF paths, uses JSON base fingerprints as the owned baseline, and avoids locking the app for internal autosave/dirty state.
- Compatible external TIFF edits auto-import when there is no local dirty conflict. Dirty SWB + external Photoshop conflict stays locked until Import, then imports the Photoshop version as a copy.
- Large folder opening now reports loading progress and can show existing SWB project JSON state before slower background checks finish.

### Photoshop TIFF Export Robustness

- Photoshop layered TIFF export now resizes copied layer PNGs to the manifest canvas size before writing, so copied layers from different shot sizes do not fail export.
- Python dependency resolution continues to prefer stable local/vendor/package resource paths over the old temp fallback.

## Current Renderer Ownership Map

- `src/renderer/App.tsx`
  - Top-level project state
  - toolbar state
  - Save / Import / autosave wiring
  - external change refresh
  - global selection and delete target state
  - undo / redo project history
  - global keyboard shortcuts and menus
  - parking sidebar orchestration
- `src/renderer/ShotCard.tsx`
  - one storyboard card's presentation
  - dialogue cards and dialogue drag handles
  - script back face
  - lazy card media placeholder
  - card-local `SketchPad` / `LayerPanel` composition
- `src/renderer/SketchPad.tsx`
  - bitmap drawing and erasing UI
  - lasso Select transforms
  - Onion Skin overlay
  - Konva stage wiring
- `src/renderer/LayerPanel.tsx`
  - per-shot layer drawer UI
  - layer row selection and gestures
  - visibility sweep
  - opacity / blend mode / reorder controls
  - Merge / Merge visible / layer add-delete controls
- `src/renderer/ParkingShelf.tsx`
  - right-side parked shot shelf UI

## Verification

Fresh verification for this handoff:

```bash
npm run test
# passed: 35 test files, 241 tests

npm run typecheck
# passed

npm run check:preload
# passed

npm run build
# passed
# Vite still reports the existing non-blocking chunk-size warning:
# dist/assets/index-RjhoD930.js 681.34 kB, gzip 208.69 kB
```

Recent end-to-end smoke from this session:

```bash
npm run smoke:bitmap
# passed
# Expected Save conflict protection log appeared:
# Temporary rename file already exists
```

There is no `lint` script in `package.json`.

## Current Git State Before This Handoff Commit

This session has broad uncommitted feature work plus this documentation refresh. `git diff --stat` should be rerun immediately before commit for the exact final count because untracked test/helper files are not included in normal `git diff --stat`.

High-level changed areas:

- Electron Save / Import / external change / close prompt helpers and tests.
- Preload API surface and preload sync.
- Renderer App, ShotCard, SketchPad, LayerPanel, ParkingShelf, drag previews, delete target, bitmap write queue, and styling.
- Shared project operations and project type metadata.
- Electron bitmap smoke coverage and Photoshop TIFF export script.
- Handoff/progress/decision docs.

## Next Recommended Work

Start with manual dogfood of the newest interaction edges:

1. Open `/Users/xiali/Pictures/test`, draw several fast strokes, Save, close, reopen.
2. Option/Alt copy one shot, one layer into the same drawer at a chosen position, one layer into another shot, and one dialogue item.
3. Shift-select several layers, run `Merge`, then undo/redo and Save.
4. Open a larger folder such as `/Users/xiali/Pictures/TEST2`, confirm loading progress appears quickly and Save and Close exits.
5. Photoshop-save an owned SWB layered TIFF, confirm compatible changes auto-import when SWB is clean and create a copy when SWB has dirty local edits.

Good code follow-ups:

- Keep reducing `App.tsx` only when a feature naturally exposes a boundary. Do not split just to split.
- If shot copy DnD still feels visually different from normal move, simplify toward one shared layout strategy before adding more animation code.
- If Save error dialog text becomes too raw for artists, wrap the same details in clearer recovery copy.

## Known Remaining Work

- No active P1 items.
- Current P2 items are in `todo.md`.
- Full installer/electron packager integration is not implemented.
- PSD-first import/export is not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the documented Vite chunk-size warning.
