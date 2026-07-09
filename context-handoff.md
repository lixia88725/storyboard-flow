# Context Handoff

跨 session 接手页。稳定规则见 `AGENTS.md`，长期架构见 `decisions.md`，待办见 `todo.md`。

## Current State

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `main`
- Handoff date: 2026-07-09
- Latest pushed code commit: `5b2ff23 Polish board navigation interactions`.
- Local state before this handoff update: `main` was synchronized with `origin/main`. This handoff doc update is intended to be committed locally; do not push again unless the user explicitly asks. Pushing `main` triggers GitHub Actions release automation.
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
- `Validated architecture result`

Start a new architecture slice only for a repeated conflict, real bug-risk hotspot, clear module owner, and focused test plan. One worktree should own one domain and avoid opportunistic edits.

## Recent Completed Work

- AI Draft MVP: GUI-only OpenAI / Seedream / local ComfyUI settings, request preview copy, single-shot candidates, selectable batch size `1 / 4 / 16`, AI Resources, and candidate-first Apply/Discard.
- Renderer architecture: focused controllers now cover autosave, external refresh, zoom, marquee, history, DND, selection, sketch settings, current-layer actions, add-shot, delete, dialogue, clipboard, layer metadata, and AI project changes.
- Electron architecture: low-risk IPC/runtime/read-side/settings glue moved into focused main-side modules; protected Save / Import / TIFF orchestration remains in `electron/main/main.ts`.
- CSS architecture: `src/renderer/styles.css` is an import-order manifest; feature styles live under `src/renderer/styles/*`.
- Preload contract and AI controller/client boundaries are documented and guarded.
- Storyboard view polish: the old per-shot Script back face was replaced by a board-level Japanese storyboard sheet. The topbar now switches between storyboard grid and Japanese storyboard modes; the sheet supports drawing on picture cells, Action/Dialogue editing, marquee selection, Cut-handle drag sorting, zoom scaling, and max-zoom animation mode.
- Drawing/navigation polish: eyedropper tool and temporary eyedropper/eraser shortcuts, brush/eraser size cursor rings, `Z` + mouse wheel zoom, Space temporary hand pan, radial menu edit mode, fixed dialogue drag handle dots, and `9:16 Phone` blank shot preset are implemented.
- Pending shelf is available in Japanese storyboard mode, and board panning no longer adds excessive horizontal space just because a layer drawer opens.

## Verification

Latest verification for the pushed UI polish and this handoff pass:

```bash
npm run test
# passed: 168 test files, 763 tests

npm run check:preload
# passed

npm run typecheck
# passed

npm run build
# passed with the known non-blocking Vite chunk-size warning
```

There is no `lint` script in `package.json`, so lint was skipped.

## Next Work

- Manual dogfood the two board modes together: topbar mode switch, Japanese storyboard drawing, Action/Dialogue editing, marquee selection, Cut-handle drag reorder, pending shelf, and max-zoom animation entry/exit.
- Manual dogfood navigation shortcuts: `Z` + mouse wheel zoom, Space hand pan with layer drawer overflow, normal mouse wheel vertical scroll, and sidebars open/closed.
- Manual dogfood AI Draft providers, candidates, Apply/Discard, request preview, batch size `1 / 4 / 16`, and AI Resources.
- After the next explicit push or when checking the latest pushed `main`, confirm GitHub Actions release, release repo assets, public `update.json`, and in-app update notice.
- Keep future architecture work in guarded mode; do not touch Save / Import / TIFF / `.storyboard-workbench` behavior without a separate safety plan.
