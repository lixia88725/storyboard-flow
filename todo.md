# TODO

## P1

No active P1 items.

## P2

- [ ] Revisit outside-card marquee affordance only if dense boards still feel hard to select after edge auto-scroll.
- [ ] Revisit a slightly wider layer drawer click target only if users still miss the current handle.
- [ ] Revisit a true stage-level bitmap Select cursor affordance only if users still miss corner scaling after hit target enlargement.
- [ ] Revisit code splitting only after measured startup pain, a clear optional UI boundary, or substantial renderer bundle growth.

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
- [x] Real-folder `TEST2` dogfood found and fixed preview/import failures for TIFFs with large custom tag data by using `sharp` source reads with `unlimited: true`.
- [x] Real-folder `TEST2` reopen dogfood found and fixed renderer overload from mounting all 302 `SketchPad`/Konva stages and 2060 layer PNG reads at once.
- [x] Real-folder `TEST2` Save boundary dogfood passed after a dirty first-shot brush stroke: 302 root TIFFs renamed to default Save names, all project paths existed, and all shots remained `owned`.
- [x] Successful Save now removes its `save-tmp/<stamp>` manifests and `save-backup/<stamp>` directory after replacement commit, while rollback still preserves artifacts.
- [x] Real-folder `TEST2` Layer Lock dogfood passed on a Photoshop-imported locked `背景` layer: locked UI disabled edits/delete, locked drawing did not change the layer PNG, unlock allowed drawing, and the layer was locked back and saved.
- [x] Real-folder `TEST2` script card and `storyboard-script.md` import dogfood found and fixed same-length Markdown edits creating blank `new_shot...` storyboards instead of updating existing shot script text.
- [x] Real-folder `TEST2` Delete-to-Trash dogfood passed for single-shot Delete, Undo, Save, root file removal, Archive non-use, and pending deletion cleanup. Direct `~/.Trash` enumeration was blocked by macOS permission, and internal orphan layer cleanup remains separate.
- [x] Real-folder `TEST2` external image Import warning dogfood passed for filesystem-level external PNG addition, focus check warning, Import, Archive move, owned TIFF creation, and deleted-shot non-resurrection. Actual Finder/Bridge UI handoff remains a narrower manual check.
- [x] Real-folder `TEST2` bitmap Select dogfood passed on a 1920x1080 non-locked paint layer: lasso move and rectangle corner scale changed the layer PNG, Save wrote the dirty shot TIFF, and project/root counts stayed stable.
- [x] Real-folder `TEST2` multi-select shot dragging and double-click dialogue editing dogfood passed: shots 002/003 moved as a group, restored to original order, and shot 002 persisted `TEST2 dialogue dogfood line`.
- [x] Real-folder `TEST2` mixed-aspect Animation mode dogfood passed after adding one 2.39:1 shot: stable frame, timeline, Onion Skin, and left/right navigation worked across 16:9 and 2.39:1 shots.
- [x] Shortcut recording dogfood passed with temporary Electron userData: duplicate Escape was blocked, Clear Layer could be cleared, Brush could record Escape, Escape capture did not close the menu, and settings persisted across restart.
- [x] Real-folder `TEST2` actual Finder focus handoff dogfood passed: a root PNG added outside SWB lit the Import warning after Finder -> Electron focus return, Import archived the PNG, created an owned TIFF, and left all 304 shots owned. Adobe Bridge-specific activation was not completed.
- [x] Missing Recent folder paths are cleaned up after an attempted open: the app removes the stale path from `recent-folders.json`, keeps valid Recent entries, and still reports the open error.
- [x] Autosave failures now show a persistent right-bottom warning with the error message; users can dismiss it, and the next successful autosave clears it automatically.
- [x] Save temporary-rename conflicts now show a clearer recovery message telling users to move or delete `.storyboard-renaming-*` files before retrying Save, while preserving the exact conflict path in details.
- [x] Save now conservatively removes `.storyboard-workbench/layers/<deletedShotId>/...` directories only after the corresponding pending deleted storyboard has successfully cleared during Save; Delete and Undo still keep layer directories in place.
- [x] Dense board marquee selection audit recorded in `docs/dense-marquee-audit-2026-05-31.md`: background-origin marquee works, card-origin marquee does not start, and edge dragging does not auto-scroll.
- [x] Storyboard marquee now edge-scrolls while dragging from outside shot cards, uses document-coordinate hit testing so selected rows are preserved during scroll, and smoke covers dense-board card-origin non-start plus edge-scroll selection.
- [x] Package resource preparation now copies populated `vendor/python/photoshop-tiff` deps into `dist-resources/python-deps/photoshop-tiff`; future installer/electron packager config must include `dist-resources` at the packaged app resources root.
- [x] Layer drawer pointer-drag open/close was prototyped in `docs/prototypes/layer-drawer-pointer-drag-2026-05-31.html`; recommendation is not to implement drag now because click-toggle has lower mental load.
- [x] Real-folder `TEST2` Adobe Bridge focus handoff dogfood passed: Bridge 2026 became frontmost, returning to Electron lit Import warning, Import archived the external PNG, created an owned TIFF, and left TEST2 with 305 shots.
- [x] Preload sync audit concluded `electron/preload/preload.cjs` can remain manually maintained for now; `check:preload` now also compares exposed API method parameter names/counts.
- [x] Interaction mode audit recorded in `docs/interaction-mode-audit-2026-05-31.md`; recommendation is not to add a global Select / Hand / Draw mode now because gesture ownership is currently clear by start region.
- [x] Onion Skin opacity audit recorded in `docs/onion-skin-opacity-audit-2026-05-31.md`; recommendation is not to add opacity controls now and to keep the tested checkbox-only `0.28` baseline until repeated user feedback justifies more UI.
- [x] Bitmap Select handle affordance audit recorded in `docs/bitmap-select-handle-affordance-audit-2026-05-31.md`; recommendation is not to add a CSS-only cursor now because the visible SVG overlay is not the pointer target.
- [x] Layer drawer handle affordance audit recorded in `docs/layer-drawer-handle-affordance-audit-2026-05-31.md`; recommendation is not to widen or iconize the handle until repeated user misses justify it.
- [x] Outside-card marquee affordance audit recorded in `docs/outside-card-marquee-affordance-audit-2026-05-31.md`; recommendation is not to add persistent text, stronger background styling, or card-internal start zones now.
- [x] Vite chunk warning audit recorded in `docs/vite-chunk-warning-audit-2026-05-31.md`; recommendation is not to add manual chunks or raise the warning limit without measured startup pain.
- [x] Dedicated `SketchPad` extraction plan recorded in `docs/superpowers/plans/2026-05-31-sketchpad-extraction.md`; implementation remains deferred until the plan can be executed and verified as its own refactor.
- [x] `SketchPad` was extracted from `App.tsx` into `src/renderer/SketchPad.tsx` under the dedicated plan, with shared canvas helpers in `src/renderer/sketchRendering.ts` and test/typecheck/build/smoke verification.
- [x] Package resources packager audit recorded in `docs/package-resources-packager-audit-2026-05-31.md`; resource staging and runtime lookup are verified, but full installer integration is deferred until a packager is chosen.

## Out Of Scope For Current MVP

- AI prompt fields or AI export.
- PDF or image sequence export.
- SQLite migration.
- Cloud sync or collaboration.
- Photoshop layer round-trip as a production feature.
