# TODO

## P0

- [ ] Manually dogfood configurable keyboard shortcuts in the app, especially recording `Escape`, duplicate shortcut errors, and persistence across restart.
- [ ] Manually dogfood bitmap Select lasso/rectangle corner scaling on high-resolution real storyboard images.
- [ ] Manually review mixed-aspect animation mode with the dark matte/stable frame and decide whether the visual treatment needs refinement.
- [ ] Manually verify multi-select shot dragging and double-click dialogue editing after the bitmap layer refactor.
- [ ] Manually dogfood Save speed and Layer Lock behavior on a real multi-shot, multi-layer storyboard folder.
- [ ] Manually dogfood `文 / 图` script card editing and external `storyboard-script.md` reorder/import on a real storyboard folder.
- [ ] Manually dogfood Delete-to-Trash on real folders: single delete, multi-select delete, Undo, Save, and Finder Trash recovery.
- [ ] Manually dogfood adding images externally from Finder/Bridge and confirm the yellow Import warning appears only when needed.

## P1

- [ ] Dogfood bitmap Select tool V1 on real storyboard files; note lasso/rectangle move and scale UX issues before adding more features.
- [ ] Run real-folder P0 dogfood using `docs/dogfood-2026-05-30.md` as the automated baseline, especially Save speed, Trash recovery, Finder/Bridge focus behavior, high-resolution Select scaling, mixed-aspect animation review, multi-select dragging, and double-click dialogue editing.
- [ ] Add installer packaging that copies populated `python-deps/photoshop-tiff` resources into the packaged app.
- [ ] Add UI feedback for autosave failures that persists long enough for users to notice.
- [ ] Add clearer Save conflict resolution UI beyond the current preflight error message.
- [ ] Improve marquee selection so it is usable when the board is dense.
- [ ] Add validation or cleanup for missing Recent folder paths.
- [ ] Revisit layer drawer pointer-drag open/close only after a small visual mock/prototype proves the occlusion and animation model.
- [ ] Add conservative orphan cleanup for `.storyboard-workbench/layers/<deletedShotId>/...` after Delete-to-Trash behavior is proven in real use.

## P2

- [ ] Extract `SketchPad` from `App.tsx` only under a dedicated plan because it owns drawing, selection, pointer handling, and layer PNG writes.
- [ ] Review whether `electron/preload/preload.cjs` should continue to be manually maintained or generated from TypeScript.
- [ ] Consider a dedicated select/hand/draw tool mode if drawing, selecting, and dragging conflict in real use.
- [ ] Consider opacity controls for Onion Skin if fixed red/green ghost strength feels too strong or too weak.
- [ ] Consider adding a visible cursor affordance for bitmap Select scale handles if users still miss corner scaling after hit target enlargement.
- [ ] Consider code splitting or manual chunks if the existing Vite chunk-size warning becomes noisy or affects startup.

## PSD / Photoshop Future

- [ ] Spike PSD-first workflow with `ag-psd`: read Photoshop-created RGB 8-bit raster PSD layers, write SWB raster layers back to PSD, and verify both directions in Photoshop 2026.
- [ ] Define PSD complex-layer policy for text, smart objects, adjustment layers, shapes, masks, effects, CMYK, 16-bit, and PSB. Recommended v1 default: rasterize unsupported layer types and mark them as such.
- [ ] Add PSD import layer parsing once the spike proves the library path.
- [ ] Add PSD export round-trip smoke: import PSD, edit/add/reorder layers, Save/Export PSD, reopen in Photoshop and SWB.
- [ ] Verify Photoshop PSD compatibility on Windows, not only macOS.

## Completed Milestones

- [x] Local-first folder/project model, autosaved `.storyboard-workbench/storyboard.project.json`, safe Save rename preflight, two-stage rollback, and SWB archive/import rollback.
- [x] Bitmap layer model with internal PNG layer assets, legacy stroke migration, undo/redo bitmap snapshots, orphan PNG cleanup, and active visible layer targeting.
- [x] Save composites visible bitmap layers into working TIFFs, preserves rename safety, writes single-layer shots as ordinary TIFFs, and writes multi-layer shots as Photoshop-readable layered TIFFs.
- [x] Photoshop layered TIFF import/export path with `psdtags + tifffile`, Unicode layer names, hidden/empty layer filtering, progress feedback, concurrent Save, and Python dependency resolution from env/resources/vendor/fallback.
- [x] Layer Lock behavior blocks drawing, erasing, Select transforms, Clear, Delete, rename, opacity/blend changes, and reorder while still allowing selection and visibility toggles.
- [x] Bitmap Select V1 with lasso/rectangle selection, active-layer move, corner scale, transient selection UI, expanded high-resolution corner hit targets, and geometry/unit coverage.
- [x] Layer drawer MVP with click-toggle per-shot panel, thumbnails, blend mode dots, opacity drag, row reorder drag, lock controls, and smoke coverage.
- [x] Animation mode with real aspect ratio display, stable dark frame, timeline, left/right navigation, mixed-aspect support, and Onion Skin preview.
- [x] UI polish for dark workbench theme, sticky top/tool rails, compact shot/dialogue headers, wheel zoom, status button, shortcut editor, and lower-contrast dialogue affordances.
- [x] Repeatable `npm run smoke:bitmap` covering renderer + Electron + filesystem paths: drawing, erasing, layer operations, Save safety, Photoshop TIFF round trip, shortcut persistence, animation, Onion Skin, Add Shot, reopen, and legacy migration.
- [x] Audit/cleanup pass added `docs/audit-2026-05-30.md`, `docs/superpowers/plans/2026-05-30-audit-cleanup.md`, README/AGENTS developer maps, shared Electron bitmap layer ordering, preload sync checking, and low-risk `App.tsx` component extraction.
- [x] Photoshop layered TIFF import now inherits Photoshop lock/protection signals into SWB bitmap layer `locked` state.
- [x] Storyboard script back side added with global `文 / 图` toggle, per-shot `scriptText`, root `storyboard-script.md` mirror, and explicit Import of external MD changes.
- [x] Import warning help localized to Chinese and expanded to explain TIFF Archive, SWB internal PNG data, Photoshop-only limits, and Markdown sync.
- [x] Import and Save speed improved by avoiding full post-import scans and narrowing Save TIFF writes to dirty/imported shots.
- [x] Delete/Backspace removes selected storyboards in-app, supports Undo, records pending deleted files, and moves root image files to system Trash on Save.
- [x] Focus-time external image detection now lights Import warning for newly added root images without decoding every existing image.
- [x] Script card, layer drawer handle, shot spacing, and dialogue row UI were polished with smoke coverage.
- [x] Long nested project paths no longer break TIFF preview generation during Import; preview cache filenames now use stable SHA-256 names.
- [x] LayerPanel extraction boundary audited in `docs/layer-panel-extraction-audit-2026-05-30.md`.
- [x] `LayerPanel` was extracted from `App.tsx` into `src/renderer/LayerPanel.tsx` as a behavior-preserving move, with test/typecheck/build/smoke verification.
- [x] Post-extraction automated dogfood baseline recorded in `docs/dogfood-2026-05-30.md`; no new functional failures found in the smoke-covered paths.

## Out Of Scope For Current MVP

- AI prompt fields or AI export.
- PDF or image sequence export.
- SQLite migration.
- Cloud sync or collaboration.
- Photoshop layer round-trip as a production feature.
