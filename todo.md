# TODO

## P1

- [ ] Manual dogfood single-shot AI Draft generation with OpenAI, Seedream, and ComfyUI: generate repeatedly, Retry, Apply as an `AI Draft` layer, Discard, switch shot/sidebar/focus, reopen the project, and confirm all successful candidates remain in Pending until explicitly removed.
- [ ] Manual dogfood batch AI generation: select 5+ and 19+ shots, confirm batch size `1 / 4 / 16`, per-shot resource availability, partial-failure behavior, crop-back candidates, Apply All, Discard All, and Pending persistence after reopen.
- [ ] Manual dogfood visible Pending with Finder/Bridge: park dirty single- and multi-layer storyboards, confirm current pixels appear under project-root `Pending/`, edit parked TIFF pixels externally, restore to both board views, drag AI candidates before/after and into an empty board in both views, Save/reopen, and confirm external rename/move remains explicitly unsupported.
- [ ] Manual dogfood Pending crash recovery on a disposable project by force-quitting around park and restore, then reopening and confirming project JSON and file location agree without duplicate or lost files.
- [ ] Manual dogfood AI Resources: drag images into the AI panel, edit role/note in single-shot mode, delete resources, and confirm per-shot exclusions persist after project reload.
- [ ] Manual dogfood board navigation: normal mouse wheel scrolls vertically, `Z` + mouse wheel and `Z` + pen/mouse horizontal drag keep the pointed detail inside a selected Picture stable without drawing/selecting, Space hand pan works from Picture/Konva canvases in both storyboard modes, can reveal an open layer drawer without unrelated empty horizontal space, and AI/Pending sidebars still behave normally.
- [ ] Manual dogfood Blur in storyboard and Japanese storyboard modes: set `1–50px`, Apply to Image and paint layers, Undo/Redo, and confirm hidden/locked layers cannot be modified.
- [ ] Manual dogfood Select rotation in storyboard and Japanese storyboard modes: use the external rotation handle on Image and transparent paint layers, confirm source pixels are replaced without a ghost copy, and verify Undo/Redo.
- [ ] Manual dogfood latest tester release flow: after GitHub Actions publishes a new Release, install/update from `storyboard-flow-releases` on one Windows machine and one Apple Silicon Mac.
- [ ] Manual dogfood in-app update notice: run an older packaged build, confirm the bottom-right status/info panel shows the newer version, and confirm `Download` opens the release page.
- [ ] Manual dogfood 60+ shot marquee selection in both storyboard grid and Japanese storyboard mode: 50% zoom, background drag across multiple rows, edge-scroll near the bottom, then Delete / copy-paste / drag reorder with the final selected group.
- [ ] Manual dogfood Import-required UI: open a folder with half-finished Photoshop TIFFs, trigger external TIFF / `storyboard-script.md` changes, confirm the board lock is transparent, the Import help card is readable, Import/status warning icons match size, Save is gray only when synced, and Import/Save still preserve existing data boundaries.
- [ ] Manual dogfood Japanese storyboard mode: topbar mode switch, Action text backed by `shot.scriptText`, Dialogue text backed by existing Dialogue records, picture-cell drawing/context menu, Cut-handle drag sorting, pending shelf visibility, and max-zoom animation entry/exit.
- [ ] Manual dogfood storyboard matte/caption V1 in both board modes: toggle expanded scenes `1080↔1230`, toggle embedded scenes without resizing, toggle scene dialogue overlays on/off including shots with no dialogue, verify Matte/Dialogue assets are removed and restored by Undo/Redo, confirm Add/Import/Pending inherit both matte and dialogue state, then Save/reopen and verify layered TIFF dimensions.

## P2

- [ ] Keep architecture follow-through in guarded mode before the next large AI/UI iteration: CSS, zoom, marquee, history, DND, selection, sketch/tool settings, external refresh action, current-layer tool actions, AI panel UI sections/action dispatch, Electron IPC/runtime glue, and common layer metadata/clipboard/delete/dialogue/add-shot actions now have focused boundaries. Start another refactor slice only for a repeated conflict, a real bug-risk hotspot, or a clear product-driven owner. Do not split protected Save / Import / TIFF / `.storyboard-workbench` wiring without a separate plan.
- [ ] Revisit Vite renderer chunk size after the architecture audit identifies a clean lazy-loading boundary; current build warning is non-blocking.
- [ ] Manual dogfood retired Option/Alt drag copy paths: Option/Alt dragging storyboard, layer, and dialogue should behave like normal move/sort and must not create copies.
- [ ] Manual dogfood keyboard copy/paste: copy/paste one storyboard with `Cmd/Ctrl+C` and `Cmd/Ctrl+V`, then copy/paste one layer below the current layer; confirm both paste actions show the short slide-out animation.
- [ ] Manual dogfood large folder close flow on `/Users/xiali/Pictures/TEST2`: loading progress appears quickly, Save and Close exits, and Save error dialog only appears for real failures.
- [ ] Revisit Photoshop dirty conflict UI only if users need non Image/base Photoshop layer edits to merge with simultaneous SWB local layer edits.
- [ ] Revisit outside-card marquee affordance only if dense boards still feel hard to select after the single-Canvas marquee feedback change.
- [ ] Revisit a slightly wider layer drawer click target only if users still miss the current handle.
- [ ] Revisit a true stage-level bitmap Select cursor affordance only if users still miss corner scaling after hit target enlargement.
- [ ] If production storyboards begin using 8+ visible full-resolution bitmap layers per shot, add a revisioned flattened proxy/thumbnail cache. The optional `STORYBOARD_PERF_LAYER_COUNT=8 npm run smoke:performance` destructive fixture currently exceeds the 33ms scrolling budget; shrinking the Hot editor margin made decode bursts worse.

## PSD / Photoshop Future

- [ ] Spike PSD-first workflow with `ag-psd`: read Photoshop-created RGB 8-bit raster PSD layers, write SWB raster layers back to PSD, and verify both directions in Photoshop 2026.
- [ ] Define PSD complex-layer policy for text, smart objects, adjustment layers, shapes, masks, effects, CMYK, 16-bit, and PSB. Recommended v1 default: rasterize unsupported layer types and mark them as such.
- [ ] Add PSD import layer parsing once the spike proves the library path.
- [ ] Add PSD export round-trip smoke: import PSD, edit/add/reorder layers, Save/Export PSD, reopen in Photoshop and SWB.
- [ ] Verify Photoshop PSD compatibility on Windows, not only macOS.

## Completed Summary

- [x] Visible Pending now stores recoverable manual parked TIFFs and persistent AI PNG candidates in project-root `Pending/`; AI candidates survive panel/project changes and can move into either storyboard view with rollback on failure.
- [x] Stable V1 baseline includes local scene projects, bitmap layers, Save/Import safety, Photoshop TIFF exchange, script sync, both storyboard views, drawing/editing, animation/onion skin, AI Draft, and focused smoke coverage. Older per-feature completion notes are preserved by Git history instead of this active TODO.

## Out Of Scope For Current Scope

- PDF or image sequence export.
- SQLite migration.
- Cloud sync or collaboration.
- Photoshop layer round-trip as a production feature.
