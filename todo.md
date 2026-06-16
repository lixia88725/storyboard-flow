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

- [x] Storyboard Flow now has a local-first scene-folder model, bitmap layer drawing, Save/Import safety, Photoshop layered TIFF exchange, script Markdown sync, parking shelf, fixed shortcut list, Copy/Paste, Merge, selection, animation/onion skin, UI polish, and repeatable automated coverage.
- [x] GitHub Actions now publishes tester releases automatically from `main` to `lixia88725/storyboard-flow-releases`, including Windows portable zip, macOS Apple Silicon zip, and `update.json`.
- [x] Storyboard marquee drag preview now uses lightweight temporary DOM selection and transform-positioned marquee box; final selection state still commits on pointer up.
- [x] AI Draft MVP now supports GUI-only provider settings, OpenAI / Seedream / local ComfyUI providers, request preview copy, single-shot candidates, batch 4-up candidates, and per-shot AI resource availability.
- [x] AI renderer logic now has controller/client boundaries for provider settings, resources, single-candidate flow, batch flow, and renderer API access; `AiDraftPanel.tsx` remains the UI composition surface.
- [x] Major extraction boundaries are in place for `ShotCard`, `SketchPad`, `LayerPanel`, shared project operations, Electron Save/Import helpers, and preload sync checks.
- [x] Architecture worktree slicing was validated with separate local renderer-controller and CSS-slice worktrees; remaining cross-slice risk is shell class naming between renderer controllers and CSS modules.
- [x] Architecture worktree slicing was further validated with separate Electron user-data runtime and renderer autosave persistence slices; both stayed inside their file boundaries and cherry-picked back to `main` without conflicts.
- [x] Architecture worktree slicing was validated again with CSS-only Production Slate override absorption and a separate renderer zoom controller slice; CSS files and renderer hook files stayed independent and cherry-picked back to `main` without conflicts.
- [x] Electron main read-side services were split out for folder scan, image records, known-image external change detection, and project metadata reading; Save / Import / TIFF orchestration remains protected in `main.ts`.
- [x] Electron settings/AI user-data glue now lives in `userDataRuntime.ts`; autosave metadata persistence side effects now live in `workspaceAutosaveController.ts`.
- [x] Additional architecture slices moved Electron AI runtime wiring, external refresh runtime wiring, and AI project-change dirty-shot handling into focused modules with tests; all were validated in separate worktrees and cherry-picked back without touching Save / Import / TIFF / `.storyboard-workbench` formats.
- [x] Additional Electron IPC runtime slices moved image blank-shot wiring and tool radial settings wiring out of `main.ts` into focused runtime modules with tests; both were validated in separate worktrees and cherry-picked back without touching Save / Import / TIFF / `.storyboard-workbench` formats.
- [x] Architecture audit now has an explicit stop rule: continue refactoring only for repeated conflicts, real bug-risk hotspots, clear module ownership, and focused tests; protected Save / Import / TIFF / `.storyboard-workbench` wiring needs a separate plan before movement.
- [x] Product naming is now `Storyboard Flow`; `Storyboard Workbench` remains only as a legacy metadata compatibility value. `.storyboard-workbench`, `SWB`, `swb-*`, and `storyboard-workbench.local` remain internal compatibility names until a separate format migration.
- [x] Detailed older milestone history was intentionally pruned from this file during the 2026-06-06 handoff cleanup. Use Git history and archived docs under `docs/` for the full dated record.

## Out Of Scope For Current Scope

- PDF or image sequence export.
- SQLite migration.
- Cloud sync or collaboration.
- Photoshop layer round-trip as a production feature.
