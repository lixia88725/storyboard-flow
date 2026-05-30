# Context Handoff

跨 session 交接文档。稳定规则见 `AGENTS.md` 和 `decisions.md`，待办事项见 `todo.md`。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `bitmap-layer-refactor`
- Previous handoff commit before this continuation: `3820ac9 交接存档：完善脚本面板、导入提醒和删除流程`
- Latest continuation commits:
  - `2f2f52a fix: shorten preview cache filenames`
  - `e61b232 refactor: centralize preview cache paths`
  - `13155a6 docs: record layer panel extraction audit`
  - `7e56d19 refactor: extract layer panel component`
- This handoff records the continuation through the long-path Import fix and the behavior-preserving LayerPanel extraction.

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

### Long Path Import Fix

- Dogfood found a high-severity Import failure for deeply nested normal user folders.
- Root cause: TIFF preview cache filenames were generated from the full absolute image path encoded as hex, which could exceed macOS single-filename limits.
- Added `electron/main/previewPaths.ts`.
- Preview cache image names now use a stable SHA-256 hash plus `.png`.
- Moved `previewRootForFolder()` into the same preview path helper module so `main.ts` no longer owns that cache path detail.
- Covered by `electron/main/previewPaths.test.ts`.

### LayerPanel Extraction Audit

- Added `docs/layer-panel-extraction-audit-2026-05-30.md`.
- Key finding: `LayerPanel` already exists as an internal `App.tsx` component; the next safe step is moving it to `src/renderer/LayerPanel.tsx`, not redesigning it.
- Keep `isLayerPanelOpen` in top-level `App`, `isLayerPanelRendered` in `ShotCard`, and project mutation/history handlers outside the extracted component.
- Move only local panel UI state, gesture handlers, menu state, props, and `blendModeLabel`.
- Do not extract `SketchPad` in the same pass.

### LayerPanel Extraction

- Extracted `LayerPanel` from `src/renderer/App.tsx` into `src/renderer/LayerPanel.tsx`.
- Kept `ShotCard`, `SketchPad`, top-level panel open state, project mutation handlers, undo/history, CSS classes, and interaction behavior unchanged.
- Moved only the panel props, local layer-row gesture/menu types, panel-local helper functions, UI state, and `blendModeLabel`.
- Latest implementation commit: `7e56d19 refactor: extract layer panel component`.

### Post-Extraction Dogfood Baseline

- Added `docs/dogfood-2026-05-30.md`.
- Re-ran `npm run smoke:bitmap` after the extraction and documentation refresh.
- Result: passed.
- Covered automated paths include script card Markdown sync/import, external root image warning/import, Delete/Save-to-Trash source removal, LayerPanel drawer interactions, Layer Lock blocking, bitmap Select move/scale, keyboard shortcut persistence, Photoshop TIFF round trip, Save conflict protection, animation mode, Add Shot, reopen, and layer asset consistency.
- This is still an automated synthetic-folder pass. Real production-folder dogfood remains needed for perceived Save speed, Finder Trash recovery, Finder/Bridge focus behavior, high-resolution Select scaling feel, mixed-aspect animation review, multi-select dragging, and double-click dialogue editing.

### TEST2 Real-Folder Dogfood

- Real dogfood folder: `/Users/xiali/Pictures/TEST2`.
- Initial state: 302 root TIFF files, about 3.3GB, no `.storyboard-workbench/` metadata.
- First open initially stalled after generating 296/302 preview PNGs and never wrote project metadata within the dogfood timeout.
- Root cause: six real TIFFs contain large custom tag data that libvips rejects under default `sharp` source read limits during preview/raw pixel reads.
- Fix: user source image reads now use `sharpSourceOptions = { unlimited: true }` in Electron main and Photoshop TIFF import fallback working-TIFF creation.
- After the fix, `TEST2` opened, generated 302/302 previews, imported 302/302 shots as `owned`, archived 302 original TIFFs, and created 2060 internal layer PNGs.
- Script card edit wrote `TEST2 dogfood script line` to the first shot and `storyboard-script.md`.
- First shot LayerPanel opened with 7 imported Photoshop raster layers and preserved Chinese layer names.
- Reopen responsiveness issue was fixed by deferring heavy `SketchPad`/LayerPanel rendering for offscreen cards. TEST2 reopened to 302 cards without hanging; initial viewport mounted 14 Konva stages, and after scrolling to bottom only 15 stages were mounted.
- Save boundary was dogfooded after a small dirty brush stroke on the first shot. Save used default naming fields, renamed all 302 root TIFFs to `TEST2_scene_stb_artist_v001_####.tiff`, kept all 302 project paths valid, and preserved `owned` status on every shot.
- Follow-up finding fixed: successful Save now removes its per-save manifest directory and `save-backup/<stamp>/` directory after replacement commit. Rollback still preserves artifacts for recovery/diagnostics.

## Verification Run For Handoff

Commands run in `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers` on 2026-05-30:

```bash
npm run test
# passed: 17 test files, 154 tests

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

Verification run after `7e56d19` LayerPanel extraction:

```bash
npm run typecheck
# passed

npm run test
# passed: 17 test files, 154 tests

npm run build
# passed; Vite reported the existing chunk-size warning only

npm run smoke:bitmap
# passed
```

Additional automated dogfood baseline after the documentation refresh:

```bash
npm run smoke:bitmap
# passed
```

Verification after the TEST2 TIFF source-read fix:

```bash
npm run test
# passed: 17 test files, 154 tests

npm run build
# passed; Vite reported the existing chunk-size warning only

npm run smoke:bitmap
# passed
```

For the long-path Import fix, a manual Electron/CDP dogfood repro also passed: a deeply nested folder under `/Users/xiali/Documents/Codex/2026-05-30/storyboard-workbench-users-xiali-documents-codex-3/work/swb-dogfood-long-fixed/project` imported successfully, root PNGs became TIFFs, and preview filenames were 64-character SHA-256 names.

`npm run smoke:bitmap` now covers script card/Markdown sync, external Markdown import, external root image import warning, Delete/Undo/Save-to-Trash, textarea Delete safety, Photoshop layered TIFF lock import, Save safety, Photoshop round trip, layer drawer behavior, dialogue row clamp, animation mode, Add Shot, reopen, and legacy migration.

The smoke intentionally triggers a Save temporary rename conflict and logs `Temporary rename file already exists`; this is expected when the command exits `0`.

## Current Git State

Latest implementation commits before this documentation handoff:

```text
7e56d19 refactor: extract layer panel component
13155a6 docs: record layer panel extraction audit
e61b232 refactor: centralize preview cache paths
2f2f52a fix: shorten preview cache filenames
3820ac9 交接存档：完善脚本面板、导入提醒和删除流程
```

Documentation changes recorded in this handoff:

```text
context-handoff.md
todo.md
docs/layer-panel-extraction-audit-2026-05-30.md
docs/dogfood-2026-05-30.md
```

## Next Handoff Target

Recommended next steps:

1. Continue real-folder dogfood for Save speed, Delete-to-Trash recovery, external image Import warning, script editing, bitmap Select scaling, multi-select dragging, and double-click dialogue editing.
2. Fix only concrete dogfood findings in small, behavior-focused patches with focused verification.
3. Defer `SketchPad` extraction unless there is a dedicated plan, because it owns drawing, selection, pointer handling, and layer PNG writes.

## Known Remaining Work

- Real dogfood is still needed for Layer Lock feel, script card editing, Delete-to-Trash recovery, external image Import warning, bitmap Select high-resolution scaling, mixed-aspect animation, multi-select dragging, and double-click dialogue editing.
- Delete currently leaves internal `.storyboard-workbench/layers/<shotId>/...` assets behind; orphan cleanup should be a separate conservative task.
- Photoshop TIFF Python deps can resolve from env/resources/vendor/fallback, but installer packaging still needs to copy populated deps into app resources.
- Photoshop layered TIFF import/export is raster-layer exchange; full Photoshop feature round-trip is not implemented.
- PSD-first spike and compatibility matrix are not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the Vite chunk-size warning.
