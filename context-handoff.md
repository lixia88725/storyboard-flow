# Context Handoff

跨 session 交接文档。稳定规则见 `AGENTS.md` 和 `decisions.md`，待办事项见 `todo.md`。此处只记录当前状态快照，每次 session 结束时覆盖重写。

## Completed Recently

- Initialized git in this project directory. No initial commit has been created yet; current files are still untracked in the new repo.
- Added Save preflight validation before real file renames:
  - Shared logic: `validateRenamePlan(plan, existingPaths)` in `src/shared/projectOps.ts`.
  - Main-process guard: `workspace:save` checks the rename plan before `applyFileRenamePlan()`.
  - Covers target path collisions, temporary path collisions, and unchanged existing filenames.
- Improved multi-select storyboard drag:
  - Shared reorder logic now supports explicit `before` / `after` placement.
  - Renderer infers placement so selected groups can move both before earlier shots and after later shots.
  - Drag overlay now shows a stacked preview of selected storyboard images.
- Compacted the dialogue area:
  - Removed the `Dialogue` title.
  - Empty state is just gray `Double-click to type dialogue` text.
  - Reduced the area to a small note strip and removed excess blank space.
- Removed the white image border/chrome around storyboard images.
- Added brush color and opacity controls:
  - Native web color input.
  - Opacity slider.
  - `SketchStroke` now persists optional `opacity`.
- Expanded zoom behavior:
  - Minimum zoom is smaller, so more storyboard context can be seen.
  - Animation mode is triggered by measured card size relative to the board, not only by a hard-coded zoom value.
  - Timeline appears at the bottom once a single storyboard fills most of the board.
- Added keyboard navigation:
  - Storyboard mode: arrow keys navigate spatially in the visible grid.
  - Animation mode: left/right keys move linearly through shots.
  - `B` selects brush, `E` selects eraser.
- Fixed latest animation-mode interaction issues:
  - Timeline thumbnails can be clicked to jump to any storyboard.
  - Left/right playback switches immediately without smooth scroll animation.
  - Brush and eraser work in animation mode.
  - Drawing at zoom levels above 100% no longer breaks when the pointer leaves the canvas mid-stroke.

## Verification

Latest static verification:

```bash
npm run test        # passed, 18 tests
npm run typecheck   # passed
npm run build       # passed, Vite chunk size warning only
```

Manual / automated smoke verification covered:

- Save preflight blocks an intentional rename collision before changing real files.
- Dialogue strip height is compact and no longer leaves a large blank row.
- Image-stage padding/white border is removed.
- Brush color and opacity persist into saved sketch stroke data.
- Timeline appears when a shot fills most of the board.
- Clicking a timeline thumbnail selects that storyboard.
- Animation-mode right-arrow advances to the next storyboard.
- Animation-mode drawing adds sketch data.
- Storyboard-mode drawing at zoom above 100% adds sketch data.
- Storyboard-mode down-arrow moves to the shot in the next visible row.
- `B` and `E` switch tools.

## Next Entry Point

建议下个 session 先处理 `todo.md` 中的 P0 手动验证项，再推进 P1。
