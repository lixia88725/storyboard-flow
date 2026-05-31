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
  - `39e5174 docs: record shortcut dogfood`
- This handoff records the continuation through the long-path Import fix, the behavior-preserving LayerPanel extraction, the TEST2 real-folder dogfood sequence through actual Finder and Adobe Bridge focus handoff, Recent-folder cleanup after failed opens, persistent autosave failure UI, clearer Save conflict guidance, conservative deleted-shot layer cleanup, dense-board marquee selection audit, marquee edge auto-scroll, Photoshop TIFF package resource preparation, layer drawer pointer-drag prototype review, preload sync audit, interaction mode audit, Onion Skin opacity audit, bitmap Select handle affordance audit, layer drawer handle affordance audit, and outside-card marquee affordance audit.

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
- Layer Lock dogfood passed on shot 171's Photoshop-imported locked `背景` layer: locked controls were disabled, locked drawing did not change the PNG, unlocking allowed drawing, then the layer was locked back and saved. TEST2 still has 13 locked layers.
- Script card / Markdown import dogfood found and fixed same-length `storyboard-script.md` edits creating blank `new_shot...` storyboards. Same-length Markdown now updates existing shots positionally; extra Markdown entries still create new blank shots. TEST2 was restored to 302 shots with only shot 1 containing `TEST2 dogfood script line`.
- Delete-to-Trash dogfood passed on the last TEST2 shot, `TEST2_scene_stb_artist_v001_3020.tiff`: Delete recorded the pending removal without touching the root file, Undo restored the shot and cleared pending state, final Delete + Save removed the root TIFF, cleared `pendingDeletedShots`, did not move the file into `Archive/`, and left TEST2 with 301 shots. macOS blocked direct shell listing of `~/.Trash`, so Finder Trash contents were not independently enumerated.
- External image Import warning dogfood passed after adding `TEST2_external_import_dogfood_1780162936784.png` to the TEST2 root outside SWB and triggering the app focus check. The warning appeared, Import was enabled, deleted `3020.tiff` did not reappear, Import moved the PNG to `Archive/20260530T174638/`, created `TEST2_external_import_dogfood_1780162936784.tiff`, cleared the warning, and left TEST2 with 302 owned shots.
- Bitmap Select high-resolution dogfood passed on shot 2, `TEST2_scene_stb_artist_v001_0020.tiff`, layer `layer-0004` / `图层 5`: lasso move and rectangle corner scale both changed the 1920x1080 layer PNG, Save wrote the dirty TIFF in 1274 ms, project/root TIFF counts stayed 302, and the old deleted shot id did not return. After Save, the prior external-import dogfood shot was correctly renamed to the ordered file name `TEST2_scene_stb_artist_v001_3020.tiff` as a different shot id.
- Multi-select shot dragging and double-click dialogue editing dogfood passed: shots 002/003 moved together after shot 005, then were dragged back before shot 004 to restore the original first-six order. Shot 002 now has one persisted dialogue, `TEST2 dialogue dogfood line`. The reorder used dnd-kit PointerSensor events; the multi-select state was created by dispatched meta-click events.
- Mixed-aspect Animation mode dogfood passed after adding one `2.39:1` blank shot through the Add Shot preset menu and saving it. TEST2 now has 303 shots: 302 at 1920x1080 plus one 2581x1080 shot, `TEST2_scene_stb_artist_v001_0020.tiff`. Animation mode measured 16:9 stages at ratio 1.778 and the 2.39:1 stage at ratio 2.388 inside the same stable frame, timeline stayed visible, Onion Skin worked, and left/right navigation moved across mixed aspect shots. Onion Skin is functional but visually strong on TEST2 drawings.
- Shortcut recording dogfood passed with a temporary Electron `SWB_USER_DATA_DIR`: duplicate Escape assignment was blocked without writing settings, Clear Layer could be cleared with Backspace, Brush could record Escape, Escape capture did not close the shortcut menu, the saved `keyboard-shortcuts.json` persisted across restart, and Escape activated Brush after restart.
- Actual Finder focus handoff dogfood passed with `TEST2_finder_handoff_dogfood_1780195495081.png`: Finder became frontmost on the TEST2 folder, returning to Electron fired a document focus event, Import warning appeared in 1352 ms, Import archived the PNG to `Archive/20260531T024815/`, created `TEST2_finder_handoff_dogfood_1780195495081.tiff`, cleared the warning, and left TEST2 with 304 owned shots. Adobe Bridge 2026 activation failed via AppleScript in this automation run, so Bridge-specific handoff is not claimed as passed.
- Actual Adobe Bridge focus handoff dogfood passed with `TEST2_bridge_handoff_dogfood_1780199835574.png`: Adobe Bridge 2026 became frontmost on TEST2, returning to Electron made Electron frontmost, Import warning appeared and Import was enabled, Import archived the PNG to `Archive/20260531T035729/`, created `TEST2_bridge_handoff_dogfood_1780199835574.tiff`, cleared the warning, and left TEST2 with 305 owned shots. The PNG was created programmatically while Bridge was frontmost, so this validates Bridge -> Electron focus handoff rather than manual Bridge drag/drop.
- Recent-folder cleanup now removes a stale path only after the user attempts to open it and the folder no longer exists. The app keeps other Recent entries, updates `recent-folders.json`, and still reports the open error. Helper behavior is covered by `electron/main/recentFolders.test.ts`, and a temporary Electron IPC check verified the real preload/main path.
- Autosave failures now render a persistent right-bottom warning above the existing status control. The warning keeps the latest autosave error visible, can be dismissed manually, and clears automatically on the next successful autosave. State behavior lives in `src/renderer/autosaveError.ts`, with coverage in `src/renderer/autosaveError.test.ts`.
- Save temporary-rename conflicts now show a user-actionable recovery message instead of only the raw preflight error. The renderer keeps the exact `.storyboard-renaming-*` conflict path in the details. The formatter lives in `src/renderer/saveErrors.ts`, and `npm run smoke:bitmap` now asserts the Save conflict status text.
- Deleted-shot internal layer directories are now cleaned only after the corresponding pending deleted storyboard clears during Save. Delete and Undo still preserve `.storyboard-workbench/layers/<shotId>/...`; Save removes the exact cleared shot id directory after root image deletion is handled. The helper lives in `electron/main/deletedShotLayers.ts`, and `npm run smoke:bitmap` now asserts the layer directory exists before Save/after Undo and is gone after Save.
- Dense marquee selection audit used a 48-shot temporary Electron fixture. At 100% zoom the board had 2 columns; at 50% zoom it had 5 columns. Background-origin marquee selected visible cards, card-origin drag did not start a new marquee, and dragging to the viewport bottom did not auto-scroll. Results are recorded in `docs/dense-marquee-audit-2026-05-31.md`.
- Storyboard marquee now edge-scrolls while dragging from outside shot cards. Card interiors intentionally do not start marquee selection. Hit testing uses document coordinates so rows already crossed by the marquee remain selected after the viewport scrolls. The pure helper lives in `src/renderer/storyboardMarquee.ts`, with tests in `src/renderer/storyboardMarquee.test.ts`; `npm run smoke:bitmap` includes a 24-shot dense fixture that asserts card-origin drags do not start marquee and outside-card edge drags scroll/select across rows.
- Package resource preparation now has an explicit `npm run prepare:package-resources` step. It compiles Electron helpers, verifies populated `vendor/python/photoshop-tiff` deps exist, and copies them to `dist-resources/python-deps/photoshop-tiff`. `dist-resources/` is ignored by git and must be included at the packaged app resources root by any future installer/electron packager config.
- Layer drawer pointer-drag open/close was evaluated with an isolated prototype at `docs/prototypes/layer-drawer-pointer-drag-2026-05-31.html`; findings are recorded in `docs/layer-drawer-pointer-drag-prototype-2026-05-31.md`. Recommendation: do not implement pointer-drag now. Keep click-toggle because it has a simpler user model; if the handle remains too hidden, consider hover/cursor affordance or a slightly larger click target first.
- Preload sync audit is recorded in `docs/preload-sync-audit-2026-05-31.md`. Recommendation: keep manually maintained `electron/preload/preload.cjs` for now, but strengthen the gate. `scripts/check-preload-sync.mjs` now exports parser helpers, only runs as a CLI when invoked directly, and compares exposed API method parameter names/counts in addition to API keys and IPC channels.
- Interaction mode audit is recorded in `docs/interaction-mode-audit-2026-05-31.md`. Recommendation: do not add a global Select / Hand / Draw mode now. Current interaction ownership is region-based: image stage edits pixels, board background marquee-selects storyboards, shot header reorders shots, dialogue grip drags dialogue, and LayerPanel owns layer gestures.
- Onion Skin opacity audit is recorded in `docs/onion-skin-opacity-audit-2026-05-31.md`. Recommendation: do not add opacity controls now. Keep the current Animation-mode checkbox-only UI and fixed `0.28` ghost opacity because it is covered by smoke and the TEST2 "visually strong" note is qualitative rather than repeated user failure.
- Bitmap Select handle affordance audit is recorded in `docs/bitmap-select-handle-affordance-audit-2026-05-31.md`. Recommendation: do not add a CSS-only cursor now because the visible SVG overlay has `pointer-events: none`; revisit a true stage-level cursor only if real users still miss corner scaling after the enlarged hit target.
- Layer drawer handle affordance audit is recorded in `docs/layer-drawer-handle-affordance-audit-2026-05-31.md`. Recommendation: do not widen, iconize, or otherwise emphasize the handle now. The handle is already a real button with pointer cursor, hover, accessible label, and smoke-covered placement; revisit a slightly wider click target only if users still miss it.
- Outside-card marquee affordance audit is recorded in `docs/outside-card-marquee-affordance-audit-2026-05-31.md`. Recommendation: do not add persistent instruction text, stronger board-background styling, or card-internal start zones now. Edge-scroll fixed the concrete dense-board failure, and the start rule remains outside shot cards only.

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

Verification after Recent-folder cleanup:

```bash
npm run test -- electron/main/recentFolders.test.ts
# passed: 1 test file, 3 tests

npm run typecheck
# passed

npm run build
# passed; Vite reported the existing chunk-size warning only

node /private/tmp/swb-recent-missing-check.mjs
# passed: missing Recent path was removed from recent-folders.json, valid entry remained

npm run smoke:bitmap
# passed

npm run test
# passed: 19 test files, 160 tests
```

Verification after autosave failure UI:

```bash
npm run test -- src/renderer/autosaveError.test.ts
# passed: 1 test file, 1 test

npm run typecheck
# passed

npm run build
# passed; Vite reported the existing chunk-size warning only

node /private/tmp/swb-autosave-error-ui-check.mjs
# passed: real autosave EISDIR failure showed persistent warning, dismiss worked, next successful autosave cleared it

npm run smoke:bitmap
# passed

npm run test
# passed: 20 test files, 161 tests
```

Verification after Save conflict guidance:

```bash
npm run test -- src/renderer/saveErrors.test.ts
# passed: 1 test file, 2 tests

npm run typecheck
# passed

npm run build
# passed; Vite reported the existing chunk-size warning only

npm run smoke:bitmap
# passed; includes saveConflictStatus: true

npm run test
# passed: 21 test files, 163 tests
```

Verification after deleted-shot layer cleanup:

```bash
npm run test -- electron/main/deletedShotLayers.test.ts
# passed: 1 test file, 2 tests

npm run typecheck
# passed

npm run build
# passed; Vite reported the existing chunk-size warning only

npm run smoke:bitmap
# passed; deleteShotChecks layerDirExistsAfterSave was false

npm run test
# passed: 22 test files, 165 tests
```

Read-only dense marquee audit:

```bash
node /private/tmp/swb-dense-marquee-audit.mjs
# passed; recorded card-origin marquee limitation and lack of edge auto-scroll
```

Verification after marquee edge auto-scroll:

```bash
npm run test -- src/renderer/storyboardMarquee.test.ts
# passed: 1 test file, 2 tests

npm run typecheck
# passed

npm run build
# passed; Vite reported the existing chunk-size warning only

npm run smoke:bitmap
# passed; denseMarqueeChecks reported scrollY 181, selectedCount 20, marqueeVisible true

npm run test
# passed: 23 test files, 167 tests
```

Verification after Photoshop TIFF package resource preparation:

```bash
npm run test -- electron/main/packageResources.test.ts electron/main/photoshopTiffDeps.test.ts
# passed: 2 test files, 6 tests

npm run typecheck
# passed

npm run setup:photoshop-tiff-deps
# passed with escalated network access; populated git-ignored vendor/python/photoshop-tiff

npm run prepare:package-resources
# passed; copied vendor/python/photoshop-tiff to dist-resources/python-deps/photoshop-tiff
```

Verification after layer drawer pointer-drag prototype:

```bash
git diff --check
# passed

node --input-type=module -e 'import { readFileSync } from "node:fs"; const html=readFileSync("docs/prototypes/layer-drawer-pointer-drag-2026-05-31.html","utf8"); const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]); for (const script of scripts) new Function(script); console.log("scripts parsed: " + scripts.length);'
# passed: scripts parsed: 1
```

Verification after Adobe Bridge focus handoff dogfood:

```bash
osascript -e 'tell application "Adobe Bridge 2026" to activate' -e 'delay 2' -e 'tell application "System Events" to get name of first application process whose frontmost is true'
# passed: Adobe Bridge 2026

node --input-type=module -e '...Bridge TEST2 focus handoff dogfood...'
# passed: Bridge frontmost Adobe Bridge 2026, Electron frontmost Electron, TEST2 304 -> 305 shots, PNG archived, owned TIFF created
```

Verification after preload sync audit:

```bash
npm run test -- electron/preload/preloadSync.test.ts
# passed: 1 test file, 2 tests

npm run check:preload
# passed

npm run typecheck
# passed

npm run test
# passed: 24 test files, 170 tests
```

Verification after interaction mode audit:

```bash
git diff --check
# passed
```

Verification after Onion Skin opacity audit:

```bash
git diff --check
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
39e5174 docs: record shortcut dogfood
14ef021 docs: record TEST2 animation dogfood
e8134f0 docs: record TEST2 dragging dialogue dogfood
876acb1 docs: record TEST2 select dogfood
0a03248 docs: record TEST2 external import dogfood
667b1c1 docs: record TEST2 delete-to-trash dogfood
99ff1b2 fix: import same-length storyboard scripts positionally
c1ece86 docs: record TEST2 layer lock dogfood
8c95044 fix: clean successful save artifacts
ca7a3a9 docs: record TEST2 save dogfood
bb08639 perf: defer offscreen shot media rendering
7de13c0 fix: allow large TIFF source reads
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

1. Keep storyboard marquee start outside shot cards to reduce user mental load; revisit outside-card affordance only if dense boards still feel hard after edge auto-scroll.
2. Fix only concrete dogfood findings in small, behavior-focused patches with focused verification.
3. Defer layer drawer pointer-drag open/close unless real user demand appears; if users still miss the current handle, prefer a slightly wider click target before adding drag or an icon.
4. Defer `SketchPad` extraction unless there is a dedicated plan, because it owns drawing, selection, pointer handling, and layer PNG writes.
5. Revisit a dedicated global Select / Hand / Draw mode only if real dogfood finds repeated conflicts that cannot be solved by clearer gesture start regions.
6. Revisit Onion Skin opacity controls only if repeated user feedback shows the fixed red/green `0.28` ghosts are distracting or too subtle.
7. Revisit bitmap Select stage-level cursor affordance only if users still miss corner scaling; do not add CSS-only cursor styling to the non-interactive SVG overlay.
8. Revisit layer drawer handle width only if users still miss opening layers; keep the current quiet handle otherwise.
9. Revisit outside-card marquee affordance only if real dense-board use still shows missed selections; do not add card-internal start zones.

## Known Remaining Work

- Full installer/electron packager integration is still not present. The repo now prepares `dist-resources`, but a future packager config must include that directory at the packaged app resources root.
- Dense-board marquee selection intentionally starts outside shot cards only; edge-scroll is implemented, and outside-card affordance should be revisited only after real missed-selection feedback.
- Photoshop layered TIFF import/export is raster-layer exchange; full Photoshop feature round-trip is not implemented.
- PSD-first spike and compatibility matrix are not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the Vite chunk-size warning.
