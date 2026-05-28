# AGENTS.md

## Project

Storyboard Workbench MVP is a local-first Electron desktop app for arranging storyboard images, moving dialogue between shots, drawing edits, and managing lightweight storyboard layers.

## Context

新 session 开始时请先阅读以下文档：

- `decisions.md` — 架构决策与设计理由。
- `context-handoff.md` — 上次 session 的进度与当前状态。
- `todo.md` — 待办事项、已知问题与未来规划。

## Tech Stack

- Electron main/preload process.
- React + TypeScript + Vite renderer.
- `dnd-kit` for shot and dialogue drag behavior.
- `Konva` / `react-konva` for sketch drawing.
- `sharp` in the Electron main process for TIFF preview generation, blank TIFF creation, metadata writing, and Save-time TIFF baking.
- Vitest for pure logic tests.

Current drawing data is still stroke-based (`sketchLayers` and `imageLayerEdits`). The next major planned refactor is bitmap layers stored under `.storyboard-workbench/layers/`; do not assume that refactor is already implemented.

## Commands

```bash
npm install
npm run dev
npm run test
npm run typecheck
npm run build
```

## Code Organization

- Keep cross-cutting data operations in `src/shared/projectOps.ts`.
- Add or update Vitest coverage in `src/shared/projectOps.test.ts` when changing project data behavior.
- Keep Electron filesystem work in `electron/main/main.ts`.
- Expose renderer-safe APIs through `electron/preload/preload.ts` and keep `electron/preload/preload.cjs` in sync.
- Keep renderer UI state and interactions in `src/renderer/App.tsx`.

## Code Standards

- Prefer small pure functions for ordering, dialogue, layer, sketch, SWB format, and rename behavior.
- Preserve user files unless an explicit user action requires changing them.
- Use two-stage renaming when changing image filenames in a folder.
- Keep V1 data structures understandable and local-first: `Project`, `Shot`, `Dialogue`, `SketchLayer`, `SketchStroke`, SWB metadata, and naming metadata.
- Avoid adding AI, export, database, cloud, Photoshop layer round-trip, or file watching code unless specifically requested.
- Treat `Save` as the only operation that may synchronize real image filenames or write working TIFF pixels.

## Prohibited Actions

- Do not modify business code when the user asks only for documentation.
- Do not auto-rename image files during autosave.
- Do not treat `.storyboard-workbench/` cache files as user image shots.
- Do not add SQLite, AI prompt fields, PDF export, cloud sync, or Photoshop integration to V1 without a new explicit plan.
- Do not attempt Photoshop layer round-trip or Photoshop-compatible multi-layer TIFF writing without a separate explicit plan.
- Do not use destructive file commands without explicit approval.

## Completion Standard

Before claiming a change is complete, run:

```bash
npm run test
npm run typecheck
npm run build
```

For UI interaction changes, also perform a manual or automated app smoke test when feasible. The canonical smoke areas for this app are Save rename safety, Save TIFF baking, Image layer drawing/erasing/delete, layer panel operations, multi-select shot dragging, double-click dialogue editing, zoomed sketch drawing, Add Shot aspect presets, timeline navigation when animation mode is active, mixed-aspect animation centering, Onion Skin, and `B` / `E` tool shortcuts.

Mark any untested GUI behavior as `TODO: verify`, especially dnd-kit drag behavior that automated tooling cannot fully prove.
