# Context Handoff

跨 session 交接文档。稳定规则见 `AGENTS.md` 和 `decisions.md`，待办事项见 `todo.md`。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `bitmap-layer-refactor`
- Previous handoff commit before this work: `e942e5f 交接存档：记录audit cleanup和接手边界`
- This handoff records the current uncommitted implementation before the final commit.

## Current Product State

- Storyboard Workbench is a local Electron + React + TypeScript + Vite app.
- One local image folder is one scene; metadata autosaves to `.storyboard-workbench/storyboard.project.json`.
- Internal editable layer pixels live in `.storyboard-workbench/layers/{shotId}/{layerId}.png`; working TIFF files remain the folder-visible delivery surface.
- `Save` remains the only boundary that synchronizes real file names and writes working TIFF pixels.
- `Import` ingests non-SWB images, Photoshop layered TIFF raster layers, and external `storyboard-script.md` changes.
- `Archive/` is only for preserving non-SWB original files during Import. Deleted storyboard source files now go to the system Trash on Save, not Archive.

## Completed In This Session

### Photoshop Lock Import

- Photoshop layered TIFF import now carries lock/protection signals into SWB bitmap layers.
- Rule implemented: if Photoshop layer data reports transparency protection or protected settings, imported SWB layer `locked` becomes `true`.
- Covered by `electron/main/photoshopTiffImport.test.ts`.

### Storyboard Script Back Side And Markdown Mirror

- Added `Shot.scriptText`.
- Added global `文 / 图` tool in the left tool rail.
- Image mode shows existing storyboard cards; script mode flips cards to a back face with per-shot textarea.
- Autosave writes both project JSON and root-level `storyboard-script.md`.
- Markdown format is one standard ordered list item per shot, with no blank lines between entries:
  - `1. text`
  - `2. `
  - multiline continuation lines are indented under the numbered marker.
- Empty script shots are preserved in Markdown so numbering stays aligned with storyboard order.
- External Markdown edits are checked on folder open/focus. Import absorbs MD changes, can reorder matching shots, create blank TIFF shots for unmatched entries, and preserves existing shots missing from MD at the end.
- Storyboard script parsing/planning helpers live in `electron/main/storyboardScript.ts`, with tests in `electron/main/storyboardScript.test.ts`.

### Import Warning And External Folder Changes

- Import warning popover text is now Chinese.
- The warning explains Import, Archive, SWB internal PNG layer data, unsupported Photoshop-only details, and `storyboard-script.md` sync behavior.
- Window focus now checks both `storyboard-script.md` and newly added root images.
- External image focus check only decodes newly added image paths, excluding existing project shots and pending deleted shots.
- Newly added external images become `non-swb` shots so the yellow Import warning lights up and Import can ingest them.

### Import And Save Speed Improvements

- Pure Markdown Import no longer does a full folder image scan after import.
- Image Import now avoids a full post-import scan and only writes previews/metadata for imported shots.
- Renderer tracks dirty shot IDs in memory.
- Save passes dirty/imported shot IDs to Electron so unchanged shots do not have to be rewritten.
- `writeSwbMetadataToTiffs` and `ensureProjectLayerAssets` can operate on a focused shot set.

### Delete Storyboards

- Pressing Mac `Delete` / browser `Backspace`, or forward `Delete`, removes selected storyboard cards when focus is not in an editable field or blocking menu.
- Multi-select deletion is supported.
- Delete is undoable; Undo clears the pending deletion state.
- Deleted shots are recorded in `project.pendingDeletedShots` until Save.
- Folder merge ignores pending deleted image paths so unsaved deletes do not reappear on open/focus scans.
- Save moves pending deleted root image files to the system Trash with Electron `shell.trashItem()`, then clears the pending list.
- Missing pending files are treated as already deleted. Trash failures keep pending records so Save can be retried.
- Internal `.storyboard-workbench/layers/<shotId>/...` orphan cleanup is intentionally deferred.

### UI Polish

- Script card back face was aligned to the image card footprint.
- Storyboard horizontal spacing and layer drawer handle spacing/width were tuned.
- Layer drawer now behaves visually like it slides from under its owning storyboard and can overlap the right neighbor, not its own shot.
- Dialogue row styling was aligned with the shot header; one-line dialogue height is compact and grows for multiline text.
- Dialogue drag grip now matches the quieter dotted handle style.

## Verification Run For Handoff

Commands run in `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers` on 2026-05-30:

```bash
npm run test
# passed: 16 test files, 151 tests

npm run typecheck
# passed

npm run build
# passed; Vite reported the existing chunk-size warning only
```

Additional verification run during this session:

```bash
npm run check:preload
# passed

npm run smoke:bitmap
# passed
```

`npm run smoke:bitmap` now covers script card/Markdown sync, external Markdown import, external root image import warning, Delete/Undo/Save-to-Trash, textarea Delete safety, Photoshop layered TIFF lock import, Save safety, Photoshop round trip, layer drawer behavior, dialogue row clamp, animation mode, Add Shot, reopen, and legacy migration.

The smoke intentionally triggers a Save temporary rename conflict and logs `Temporary rename file already exists`; this is expected when the command exits `0`.

## Git Diff Summary For This Session

Current implementation changes before handoff-doc edits:

```text
13 tracked files changed, 1383 insertions(+), 169 deletions(-)
2 new untracked files:
  electron/main/storyboardScript.ts
  electron/main/storyboardScript.test.ts
```

Tracked files changed:

```text
M  electron/main/main.ts
M  electron/main/photoshopTiffImport.test.ts
M  electron/main/photoshopTiffImport.ts
M  electron/preload/preload.cjs
M  electron/preload/preload.ts
M  scripts/electron-bitmap-smoke.mjs
M  scripts/photoshop-layered-tiff-import.py
M  src/renderer/App.tsx
M  src/renderer/global.d.ts
M  src/renderer/styles.css
M  src/shared/projectOps.test.ts
M  src/shared/projectOps.ts
M  src/shared/types.ts
```

Docs updated for handoff after this diff summary:

```text
M  context-handoff.md
M  todo.md
M  decisions.md
M  AGENTS.md
M  README.md
```

## Next Handoff Target

Recommended next steps:

1. Dogfood the script back side and `storyboard-script.md` workflow on a real storyboard folder, including external MD reorder and blank-entry behavior.
2. Dogfood Delete-to-Trash on real folders, including multi-select delete, Undo, Save, and Finder Trash recovery.
3. Dogfood external root-image additions from Finder/Bridge and confirm the yellow Import warning appears at the right time.
4. Dogfood Save speed on a real multi-shot, multi-layer project after dirty-shot narrowing.
5. Continue UI polish only in small passes. If refactoring, extract `LayerPanel` before considering `SketchPad`.

## Known Remaining Work

- Real dogfood is still needed for Save speed, Layer Lock feel, script card editing, Delete-to-Trash recovery, external image Import warning, bitmap Select high-resolution scaling, mixed-aspect animation, multi-select dragging, and double-click dialogue editing.
- Delete currently leaves internal `.storyboard-workbench/layers/<shotId>/...` assets behind; orphan cleanup should be a separate conservative task.
- Photoshop TIFF Python deps can resolve from env/resources/vendor/fallback, but installer packaging still needs to copy populated deps into app resources.
- Photoshop layered TIFF import/export is raster-layer exchange; full Photoshop feature round-trip is not implemented.
- PSD-first spike and compatibility matrix are not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the Vite chunk-size warning.
