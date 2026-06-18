# Context Handoff

跨 session 接手页。稳定规则见 `AGENTS.md`，长期架构见 `decisions.md`，待办见 `todo.md`。

## Current State

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `main`
- Handoff date: 2026-06-18
- Latest pushed code commit: `2f88eb3 Polish import warning UI`.
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

- AI Draft MVP: GUI-only OpenAI / Seedream / local ComfyUI settings, request preview copy, single-shot candidates, batch 4-up/remainder generation, AI Resources, and candidate-first Apply/Discard.
- Renderer architecture: focused controllers now cover autosave, external refresh, zoom, marquee, history, DND, selection, sketch settings, current-layer actions, add-shot, delete, dialogue, clipboard, layer metadata, and AI project changes.
- Electron architecture: low-risk IPC/runtime/read-side/settings glue moved into focused main-side modules; protected Save / Import / TIFF orchestration remains in `electron/main/main.ts`.
- CSS architecture: `src/renderer/styles.css` is an import-order manifest; feature styles live under `src/renderer/styles/*`.
- Preload contract and AI controller/client boundaries are documented and guarded.
- Import-required UX polish: the Import warning help is now a compact status-panel-style card, the central lock overlay no longer blurs or covers the board, the warning copy explains both Photoshop half-finished import and later external edits, and Import/status warning icons use matching sizing.
- Save button polish: Save is visually de-emphasized when workspace output is saved and file names are synced; it becomes emphasized again when dirty, saving/error, or file names are unsynced.

## Verification

Latest verification for the pushed UI polish and this handoff pass:

```bash
npm run test
# passed: 163 test files, 682 tests

npm run typecheck
# passed

npm run build
# passed with the known non-blocking Vite chunk-size warning
```

There is no `lint` script in `package.json`, so lint was skipped. `npm run check:preload` was not needed for this pass because preload files did not change.

## Next Work

- Manual dogfood AI Draft providers, candidates, Apply/Discard, request preview, batch generation, and AI Resources.
- Manual dogfood the latest Import-required UI: Photoshop half-finished project import, external TIFF edit warning, transparent board lock click, Import help copy, Save gray/white state, and bottom-right status panel spacing.
- Manual dogfood storyboard canvas scrollbar with AI/Pending sidebars open and closed.
- Manual dogfood 60+ shot marquee selection at 50% zoom, including edge-scroll, Delete, copy-paste, and drag reorder.
- After the next explicit push or when checking the latest pushed `main`, confirm GitHub Actions release, release repo assets, public `update.json`, and in-app update notice.
- Keep future architecture work in guarded mode; do not touch Save / Import / TIFF / `.storyboard-workbench` behavior without a separate safety plan.
