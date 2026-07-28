# Context Handoff

跨 session 接手页。稳定规则见 `AGENTS.md`，长期架构见 `decisions.md`，待办见 `todo.md`。

## Current State

- Workspace: `/Users/xiali/Documents/Storyboard-flow`
- Branch: `main`
- Handoff date: 2026-07-28
- Most recent local commit: `724e345 Update bitmap smoke tests for Japanese storyboard UI`
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

Rerun on 2026-07-26 immediately before the handoff commit:

```bash
npm run test
# passed: 171 test files, 834 tests

npm run typecheck
# passed

npm run check:preload
# passed: preload APIs are in sync

npm run build
# passed; only the known non-blocking Vite chunk-size warning remains
```

There is no `lint` script in `package.json`, so lint was skipped.

`npm run smoke:bitmap` was run from a normal macOS Terminal session after the smoke updates and passed in full. The Codex-managed execution environment may abort Electron during macOS AppKit initialization before the app code runs; this is an environment limitation, not a Storyboard Flow failure.

Earlier focused Electron checks in this same worktree also passed Z-drag zoom, Japanese Space pan, Blur (including masked transparent-layer replacement), Select rotation, and 24-shot zoom anchoring. These are now summarized here instead of keeping several obsolete per-feature verification blocks.

## Next Work

1. Manually dogfood both matte modes with real production folders:
   - toggle expanded `1080↔1230`;
   - toggle embedded without resizing;
   - verify Add/Import/Pending inherit Matte and Dialogue state;
   - Save, reopen, and inspect layered TIFF dimensions/layers.
2. Manually verify Z-drag zoom with a real pen tablet and confirm Space pan, Blur, and Select rotation in both board views.
3. After an explicit push, verify GitHub Actions tester releases, Windows/macOS packages, `update.json`, and the in-app update notice.
4. Keep Save / Import / TIFF / `.storyboard-workbench` boundaries unchanged unless the user approves a separate migration plan.
