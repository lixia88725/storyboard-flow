# TODO

## P1

- [ ] Diagnose the existing `npm run smoke:bitmap` timeout at `markdown storyboard script textarea` (`scripts/electron-bitmap-smoke.mjs:1061`) without weakening the matte/dialogue scenarios that already pass before it.
- [ ] Manual dogfood single-shot AI Draft generation with OpenAI, Seedream, and ComfyUI: set provider credentials/settings from the GUI, generate one candidate, Apply as an `AI Draft` layer, Discard, and copy request preview.
- [ ] Manual dogfood batch AI generation: select 5+ and 19+ shots, confirm batch size `1 / 4 / 16`, per-shot resource availability, crop-back candidates, Apply All, and Discard All.
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
- [ ] Revisit outside-card marquee affordance only if dense boards still feel hard to select after the `.is-marquee-selected` performance change.
- [ ] Revisit a slightly wider layer drawer click target only if users still miss the current handle.
- [ ] Revisit a true stage-level bitmap Select cursor affordance only if users still miss corner scaling after hit target enlargement.

## PSD / Photoshop Future

- [ ] Spike PSD-first workflow with `ag-psd`: read Photoshop-created RGB 8-bit raster PSD layers, write SWB raster layers back to PSD, and verify both directions in Photoshop 2026.
- [ ] Define PSD complex-layer policy for text, smart objects, adjustment layers, shapes, masks, effects, CMYK, 16-bit, and PSB. Recommended v1 default: rasterize unsupported layer types and mark them as such.
- [ ] Add PSD import layer parsing once the spike proves the library path.
- [ ] Add PSD export round-trip smoke: import PSD, edit/add/reorder layers, Save/Export PSD, reopen in Photoshop and SWB.
- [ ] Verify Photoshop PSD compatibility on Windows, not only macOS.

## Completed Summary

- [x] Scene-wide Matte and Dialogue controls are reversible bitmap transactions. Expanded mode adds/removes `75px` above and below; embedded mode preserves dimensions. Add/Import/Pending inherit both switches, asset operations serialize with Save/autosave/bitmap writes, and rollback failures enter recovery-required state.
- [x] The left ToolRail now includes Blur directly below Select, with a transient `1–50px` Gaussian radius, current-layer Apply, selection-mask compositing, bitmap history/Undo support, and locked/hidden layer protection.
- [x] Bitmap Select now supports Photoshop-style center rotation from an external transform handle, with live preview and bitmap history/Undo through the existing active-layer transform path.
- [x] Storyboard zoom now anchors the selected Picture center or pointed detail across normal-grid column reflow and Japanese-row resizing; native scroll compensation preserves the focus where possible and keeps boundary-clamped anchors inside the board viewport without translating content under fixed tools.
- [x] Storyboard Flow has the V1 local-first storyboard workflow: scene-folder projects, bitmap layers, Save/Import safety, Photoshop layered TIFF exchange, script Markdown sync, parking shelf, Copy/Paste, Merge, selection, animation/onion skin, and smoke coverage.
- [x] GitHub Actions publishes tester releases from `main` to `lixia88725/storyboard-flow-releases`, including Windows portable zip, macOS Apple Silicon zip, and `update.json`.
- [x] AI Draft MVP supports GUI-only OpenAI / Seedream / local ComfyUI settings, request preview copy, single-shot candidates, batch 4-up/remainder candidates, AI Resources, and candidate-first Apply.
- [x] Architecture cleanup established focused renderer controllers, Electron runtime/service modules, CSS feature modules, preload sync checks, and AI controller/client boundaries.
- [x] Product naming is `Storyboard Flow`; `Storyboard Workbench` remains legacy/internal compatibility only.
- [x] Import-required warning UI and Save button state were polished without changing Save / Import / TIFF / `.storyboard-workbench` data behavior.
- [x] The legacy per-shot Script face was replaced by a board-level Japanese storyboard sheet with drawing, Action/Dialogue editing, shared selection/DND, zoom, and animation-mode handoff.
- [x] Drawing and navigation now include eyedropper, temporary eyedropper/eraser shortcuts, brush/eraser cursor rings, `Z` + wheel zoom, `Z` + pen/mouse horizontal drag zoom, Space hand pan across both storyboard modes, radial menu edit mode, and `9:16 Phone` blank shot preset.

## Out Of Scope For Current Scope

- PDF or image sequence export.
- SQLite migration.
- Cloud sync or collaboration.
- Photoshop layer round-trip as a production feature.
