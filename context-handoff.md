# Context Handoff

跨 session 接手页。稳定规则见 `AGENTS.md`，长期架构见 `decisions.md`，待办见 `todo.md`。

## Current State

- Workspace: `/Users/xiali/Documents/Storyboard-flow`
- Branch: `main`
- Handoff date: 2026-07-30
- Most recent local commit: `507defb Update bitmap smoke coverage for Japanese storyboard UI`
- Worktree status: dirty. The large-scene media-window, direct layer URL, per-shot revision, marquee Canvas, performance smoke, and follow-up safety fixes described below are still uncommitted.
- Product name: `Storyboard Flow`. `Storyboard Workbench` remains legacy/internal compatibility only.

## Must Preserve

- One local image folder is one scene.
- Main data lives in `.storyboard-workbench/storyboard.project.json`.
- Editable layer pixels live in `.storyboard-workbench/layers/{shotId}/{layerId}.png`.
- `Save` is the only boundary that synchronizes real filenames and writes working TIFF pixels.
- Autosave writes metadata only.
- AI output remains candidate-first and additive: Apply adds an `AI Draft` bitmap layer.
- Do not migrate `.storyboard-workbench`, `SWB`, `swb-*`, or `storyboard-workbench.local` without a separate format-migration plan.

## Architecture Status

Architecture cleanup is in guarded mode. Do not continue refactoring just to reduce line counts.

Use `decisions.md` as the source of truth, especially:

- `Current Architecture Map`
- `Parallel Work Uses Slice-Owned Worktrees`
- `Storyboard Matte Mode Is Explicit`

Protected Save / Import / TIFF orchestration remains in `electron/main/main.ts`. Renderer changes should continue using focused controllers and pure project operations rather than adding more inline logic to `App.tsx`.

## Completed In This Session

- Added large-scene interaction performance work for both storyboard views:
  - one shared viewport-rooted media window keeps card/row layout intact while splitting a one-viewport Warm image range from a 25%-viewport Hot `SketchPad` range;
  - Warm shots actively prepare only their base layer while additional full-resolution layers remain lazy, avoiding multi-layer decode storms;
  - offscreen shots render a lazy/async static bitmap layer stack, while primary selection, animation focus, and open layer drawers stay pinned;
  - drawing and bitmap Select interactions take a local mount lease so their editor cannot disappear during an active pointer session;
  - layer display, Timeline, thumbnails, drag composites, and Onion Skin now stream validated PNG files through `storyboard-img://layer` instead of passive base64 IPC reads;
  - per-shot bitmap revisions refresh only affected shot URLs and are restored correctly after Undo/Redo;
  - selection Sets, stable handlers, memoized cards/rows/previews, and equal-value selection/delete-target guards reduce App-wide work;
  - brush cursor movement is DOM/ref + RAF based, stage geometry is cached per stroke, and stroke points publish to Konva at most once per frame;
  - bitmap edits reuse one layer read for both history and source pixels and only create a transparent source when the layer file is actually missing.
- Added `npm run smoke:performance`, which creates 250-shot single-layer and 130-shot three-layer owned bitmap workspaces and measures both views at 50% zoom. It now records media tiers, editor churn, visible image readiness, view activation, scrolling, selection, marquee, first ink, passive reads, and heap stability. `STORYBOARD_PERF_LAYER_COUNT=8` is an optional destructive stress case; `STORYBOARD_PERF_FIXTURE=/path/to/project` adds an APFS-cloned real fixture under `/private/tmp`.
- Reworked dense marquee selection for 120Hz interaction:
  - one fixed Canvas overlay draws the green box, orange candidate outlines, and live count without per-card temporary classes;
  - viewport and shot geometry are cached at pointer-down and remeasured only on resize;
  - Warm/Hot observers keep recording during marquee edge-scroll, while editor tier publication is frozen;
  - release reconciliation applies at most six tier changes per frame, prioritizing offscreen editor teardown before Hot mounts and Warm/Cold preloading;
  - the performance smoke reports active-drag, edge-scroll, and release-reconcile phases separately.
- Completed a review and follow-up safety pass on the uncommitted performance work:
  - Delete-target equal-value short-circuiting now compares against rendered state before skipping the React update. Marquee preview and canvas focus can update the immediate ref without leaving the rendered target stuck on an old layer, so Delete cannot accidentally remove that stale layer after selecting shots.
  - `focusShotForCanvas` no longer writes `deleteTargetRef` before calling the synchronized setter.
  - bitmap Blur, Brush/Eraser stroke, Select transform, and Fill still reuse one PNG read for source pixels plus Undo, but a rejected read now aborts the edit. Only a successful `undefined` result means the asset is genuinely missing; permission, disk, or IPC failures cannot be converted into an empty layer or a destructive Undo snapshot.
  - focused regression coverage verifies that a read failure performs no bitmap write, dirty marking, history recording, or project update.
- Added the `1.85:1` blank-shot preset (`1998×1080`).
- Made `Cmd+S` / `Ctrl+S` save globally, including while Action/Dialogue inputs have focus, with repeated-key Save single-flight protection.
- Added `Z` + pen/mouse horizontal drag zoom while preserving `Z` + wheel, and fixed Space hand pan from Japanese storyboard Picture/Konva canvases.
- Added stable zoom anchors for the selected/pointed Picture and safe native-scroll clamping so zoom no longer moves storyboards under fixed toolbars.
- Added Gaussian Blur below Select with `1–50px`, layer protection, Undo/Redo, lasso-mask support, and correct replacement compositing on transparent paint layers.
- Added Photoshop-style Select rotation with an external handle and bitmap Undo/Redo.
- Added scene-wide matte controls:
  - `Expand canvas` adds/removes `75px` above and below every active storyboard.
  - `Use existing matte` preserves canvas dimensions.
  - `Matte Overlay` is a locked transparent PNG above ordinary layers.
  - `Dialogue Overlay` is a scene-wide on/off switch above Matte Overlay.
  - Add Shot, completed Import, and Pending restore inherit both the scene matte mode and dialogue switch.
- Hardened scene presentation transactions:
  - presentation changes serialize with painting, layer operations, clipboard asset copies, Undo/Redo, autosave, and Save;
  - stale project snapshots abort and roll back instead of overwriting newer edits;
  - Add Shot rebases onto the latest project;
  - rollback failure enters recovery-required state and blocks autosave, Save, and further presentation changes until the workspace is explicitly reopened.
- Updated README, decisions, TODO, smoke coverage, and focused unit tests for these workflows.
- Updated stale bitmap smoke coverage after the legacy per-shot Script face was replaced by the Japanese storyboard sheet:
  - Action text now verifies the Japanese storyboard Action field, not the removed card-back textarea.
  - Import help checks the current explanatory copy.
  - The smoke explicitly returns to the standard storyboard board before card-origin marquee coverage.

## Verification

Rerun on 2026-07-30 during the performance work:

```bash
npm run test
# passed after the review fixes: 175 test files, 860 tests

npm run typecheck
# passed

npm run check:preload
# passed: preload APIs are in sync

npm run build
# passed; only the known non-blocking Vite chunk-size warning remains

npm run smoke:performance
# synthetic 250-shot single-layer and 130-shot three-layer projects passed:
# standard editor peak <= 46; Japanese peak <= 10;
# marquee active/edge RAF p95 <= 9.2ms, active Layout <= 1;
# active/edge editor churn 0; release tier changes <= 6 per frame;
# passive layer reads 0, one read per stroke, first ink <= 16.1ms;
# no pauses >100ms and heap growth <= 1.77%.

STORYBOARD_PERF_FIXTURE=/Users/xiali/Desktop/C23temp \
STORYBOARD_PERF_ONLY_FIXTURE=1 npm run smoke:performance
# APFS-cloned C23 130-shot project passed in both views:
# standard editor peak 46; Japanese peak 10;
# marquee active RAF p95 9.1ms / 8.4ms, active Layout 1 / 0;
# active/edge editor churn 0; release tier changes <= 6 per frame;
# passive layer reads 0, one read per stroke, first ink 11.5ms / 17ms;
# no pauses >100ms and heap growth <= 3.04%.

npm run smoke:bitmap
# rerun after the review fixes and passed in full, including drawing/eraser/Select,
# Undo/Redo, layer actions, DND/marquee/zoom/Onion Skin, Save, reopen, Import,
# and layered TIFF checks
```

There is no `lint` script in `package.json`, so lint was skipped.

The post-review production build also passed. The only build diagnostic remains the known non-blocking Vite renderer chunk-size warning. `git diff --check` passed.

The C23 performance run rewrote paths and drew only inside its `/private/tmp` APFS clone. The desktop source project was not modified, and smoke-owned temporary copies were cleaned after exit. A separate visual-check copy remains at `/private/tmp/storyboard-flow-c23-manual-20260730`.

The optional `STORYBOARD_PERF_LAYER_COUNT=8` destructive fixture does not meet the 33ms scrolling budget with the current full-resolution layer stack. C23 has 122 one-layer shots, seven two-layer shots, and one three-layer shot. Keep the default three-layer pressure gate aligned with current production data; if 8+ layer scenes become common, implement a per-shot flattened proxy/thumbnail cache instead of shrinking the Hot margin.

Earlier focused Electron checks in this same worktree also passed Z-drag zoom, Japanese Space pan, Blur (including masked transparent-layer replacement), Select rotation, and 24-shot zoom anchoring. These are now summarized here instead of keeping several obsolete per-feature verification blocks.

## Next Work

1. Continue manual dogfood of Delete / copy-paste / group DND after a 60+ shot marquee selection in both views. Ordinary reverse marquee and final orange-border handoff were visually checked on the C23 temporary clone; Japanese reverse geometry and both views' edge-scroll remain automated.
   - Include this regression sequence: select a bitmap layer, marquee-select several shots, press Delete, and confirm the selected shots—not the formerly active layer—become pending deletion.
2. If production scenes begin using 8+ visible full-resolution layers per shot, add a revisioned flattened proxy/thumbnail cache and re-enable the eight-layer fixture as a hard performance gate.
3. Manually dogfood both matte modes with real production folders:
   - toggle expanded `1080↔1230`;
   - toggle embedded without resizing;
   - verify Add/Import/Pending inherit Matte and Dialogue state;
   - Save, reopen, and inspect layered TIFF dimensions/layers.
4. Manually verify Z-drag zoom with a real pen tablet and confirm Space pan, Blur, and Select rotation in both board views.
5. After an explicit push, verify GitHub Actions tester releases, Windows/macOS packages, `update.json`, and the in-app update notice.
6. Keep Save / Import / TIFF / `.storyboard-workbench` boundaries unchanged unless the user approves a separate migration plan.
