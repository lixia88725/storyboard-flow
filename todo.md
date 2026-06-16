# TODO

## P1

- [ ] Manual dogfood single-shot AI Draft generation with OpenAI, Seedream, and ComfyUI: set provider credentials/settings from the GUI, generate one candidate, Apply as an `AI Draft` layer, Discard, and copy request preview.
- [ ] Manual dogfood batch AI generation: select 5+ and 19+ shots, confirm 4-up / remainder grouping, per-shot resource availability, crop-back candidates, Apply All, and Discard All.
- [ ] Manual dogfood AI Resources: drag images into the AI panel, edit role/note in single-shot mode, delete resources, and confirm per-shot exclusions persist after project reload.
- [ ] Manual dogfood storyboard canvas scrollbar: AI/Pending closed and open, macOS and Windows if possible, confirm the scrollbar is inside the board area and visually matches the AI panel scrollbar.
- [ ] Manual dogfood latest tester release flow: after GitHub Actions publishes a new Release, install/update from `storyboard-flow-releases` on one Windows machine and one Apple Silicon Mac.
- [ ] Manual dogfood in-app update notice: run an older packaged build, confirm the bottom-right status/info panel shows the newer version, and confirm `Download` opens the release page.
- [ ] Manual dogfood 60+ shot marquee selection: 50% zoom, background drag across multiple rows, edge-scroll near the bottom, then Delete / copy-paste / drag reorder with the final selected group.

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

- [x] Storyboard Flow has the V1 local-first storyboard workflow: scene-folder projects, bitmap layers, Save/Import safety, Photoshop layered TIFF exchange, script Markdown sync, parking shelf, Copy/Paste, Merge, selection, animation/onion skin, and smoke coverage.
- [x] GitHub Actions publishes tester releases from `main` to `lixia88725/storyboard-flow-releases`, including Windows portable zip, macOS Apple Silicon zip, and `update.json`.
- [x] AI Draft MVP supports GUI-only OpenAI / Seedream / local ComfyUI settings, request preview copy, single-shot candidates, batch 4-up/remainder candidates, AI Resources, and candidate-first Apply.
- [x] Architecture cleanup established focused renderer controllers, Electron runtime/service modules, CSS feature modules, preload sync checks, and AI controller/client boundaries.
- [x] Worktree slicing was validated across renderer, CSS, Electron, and AI slices; architecture work is now in guarded mode with an explicit stop rule.
- [x] Product naming is `Storyboard Flow`; `Storyboard Workbench` remains legacy/internal compatibility only.

## Out Of Scope For Current Scope

- PDF or image sequence export.
- SQLite migration.
- Cloud sync or collaboration.
- Photoshop layer round-trip as a production feature.
