# Context Handoff

跨 session 接手页。稳定规则见 `AGENTS.md`，长期架构见 `decisions.md`，待办见 `todo.md`。

## Current State

- Workspace: `/Users/xiali/Documents/Storyboard-flow`
- Branch: `main`
- Handoff date: 2026-07-26
- Base commit before this handoff commit: `3a0cd77 Refresh handoff documentation`
- `3a0cd77` 与本地 `origin/main` 同步；本次 `session:` 提交完成后，本地 `main` 将领先远端 1 个提交，除非用户之后手动 push。
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

`npm run smoke:bitmap` was also run after the latest build. The expanded/embedded matte toggles, scene dialogue toggles, Undo/Redo, and Add Shot matte/dialogue inheritance all passed. The full smoke then stopped at the pre-existing unrelated failure:

```text
markdown storyboard script textarea timed out
scripts/electron-bitmap-smoke.mjs:1061
```

Earlier focused Electron checks in this same worktree also passed Z-drag zoom, Japanese Space pan, Blur (including masked transparent-layer replacement), Select rotation, and 24-shot zoom anchoring. These are now summarized here instead of keeping several obsolete per-feature verification blocks.

## Next Work

1. Diagnose the existing `markdown storyboard script textarea timed out` smoke failure at line 1061 without weakening earlier smoke scenarios.
2. Manually dogfood both matte modes with real production folders:
   - toggle expanded `1080↔1230`;
   - toggle embedded without resizing;
   - verify Add/Import/Pending inherit Matte and Dialogue state;
   - Save, reopen, and inspect layered TIFF dimensions/layers.
3. Manually verify Z-drag zoom with a real pen tablet and confirm Space pan, Blur, and Select rotation in both board views.
4. After an explicit push, verify GitHub Actions tester releases, Windows/macOS packages, `update.json`, and the in-app update notice.
5. Keep Save / Import / TIFF / `.storyboard-workbench` boundaries unchanged unless the user approves a separate migration plan.
