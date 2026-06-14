# Context Handoff

跨 session 接手页。稳定规则见 `AGENTS.md`，架构边界见 `decisions.md`，待办事项见 `todo.md`。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `main`
- Current handoff date: 2026-06-14
- Baseline before this uncommitted session: `0e4ec2b feat: add batch AI draft generation`
- Current goal of this handoff: preserve the latest AI provider/UI work, verification results, and next-session architecture direction so another session or AI agent can continue without rediscovering context.

## Current Product State

- Storyboard Flow is a local Electron + React + TypeScript + Vite app.
- One local image folder is one scene.
- Main project data lives in `.storyboard-workbench/storyboard.project.json`.
- Editable bitmap layer pixels live in `.storyboard-workbench/layers/{shotId}/{layerId}.png`.
- Product naming boundary: `Storyboard Flow` is the only product/user-facing name. `Storyboard Workbench` may appear only as a legacy metadata compatibility value. `.storyboard-workbench`, `SWB`, `swb-*`, and `storyboard-workbench.local` remain internal compatibility names until a separate format migration is planned.
- Root working TIFFs remain the visible delivery files.
- `Save` is still the only boundary that synchronizes real file names and writes working TIFF pixels.
- `Import` ingests non-SWB root images, external `storyboard-script.md` edits, incompatible external image changes, and explicit conflict cases.
- Compatible SWB TIFF edits from Photoshop can auto-import after Photoshop saves the TIFF. If the same shot has local unsaved SWB layer edits, auto-import updates root TIFF ownership state / `baseFingerprint` while preserving the existing SWB layer metadata and local layer PNGs.
- `Archive/` is only for preserving non-SWB originals during Import.
- User-deleted storyboard source files move to system Trash on Save, not Archive.
- `storyboard-script.md` is a human-editable mirror of JSON, not the primary data source.

## Release And Update Automation

- Source repository: `https://github.com/lixia88725/storyboard-flow`.
- Public release repository: `https://github.com/lixia88725/storyboard-flow-releases`.
- GitHub Actions workflow: `.github/workflows/release.yml`.
- Required source-repo secret: `RELEASE_REPO_TOKEN`; it must have permission to create releases and push `update.json` in `lixia88725/storyboard-flow-releases`.
- Trigger: every `git push origin main` automatically runs tests, builds the Windows portable package, builds the macOS Apple Silicon package, publishes a GitHub Release, and updates the public `update.json` manifest.
- Current update manifest URL: `https://raw.githubusercontent.com/lixia88725/storyboard-flow-releases/main/update.json`.
- Current app update behavior: Storyboard Flow checks the manifest and shows an in-app update notice when `update.json.latest` is newer than the running packaged app version.
- Windows package: `Storyboard-Flow-Windows-x64.zip` is a portable folder distribution.
- macOS package: `Storyboard-Flow-macOS-arm64.zip` contains an Apple Silicon `.app`. It is ad-hoc signed but not Apple-notarized, so first launch may show macOS security prompts.
- Not implemented: silent self-updating, installer-based updates, macOS notarization, code-signed Windows installer, Intel macOS package, or automatic release notes beyond the generated version label.

## Recent Session Summary

### AI Draft Feature

- AI Draft is now an internal feature module, not an external plugin system.
- Apply remains candidate-first and additive: generation creates candidate files; Apply adds a visible top bitmap layer named `AI Draft`; it does not replace base art.
- OpenAI and Seedream API keys are GUI-only local app credentials. They are not stored in project files, `.storyboard-workbench`, AI resource metadata, or candidate metadata.
- ComfyUI is available as a local-only provider. The app connects to a user-run local ComfyUI server, validates an API-format workflow with placeholders, uploads inputs, queues `/prompt`, waits through `/ws`, reads `/history`, downloads `/view`, then reuses the existing candidate flow.
- AI request preview copy is available for debugging. It copies provider/model/server summary, prompt text, image input summaries, resource role/note, and batch grouping; it does not copy API keys, image binaries, or absolute local paths.

### AI Resources And Batch Generation

- `AI Resources/` is a visible project folder for reference images.
- Each AI resource can have sidecar metadata: role and note.
- Project AI metadata can store `shotResourceExclusions`, meaning a resource is available to all shots by default, and a shot only records resources the user manually excluded.
- Single-shot AI panel keeps resource role/note editing and per-shot allow/disallow checkboxes.
- Multi-shot AI panel shows batch grouping and per-shot resource assignment. It no longer uses a separate batch resource pool.
- Batch generation groups selected shots in project storyboard order: 4-up contact sheets first, then 1/2/3-up remainder templates.
- Batch provider output is cropped by fixed templates back into one candidate per shot.

### UI And Interaction Work

- AI Draft panel now uses the same dark/cool visual family as the pending sidebar.
- AI panel opens as a right-side sidebar and does not cover storyboard cards. AI and Pending are mutually exclusive.
- General Settings moved behind the small gear button and shows only the active provider's settings.
- Text input focus rings were removed for text editing fields, while button/tool focus styles are preserved.
- AI panel scroll handles wheel events inside the panel instead of zooming the storyboard canvas.
- Storyboard canvas scrollbar was moved into the board area and styled toward the same flat scrollbar language as the AI panel.
- Left tool palette spacing and top toolbar layout were tightened after scrollbar layout changes.

### Review Fixes Already Applied

- Marquee autoscroll now uses the storyboard scroll viewport geometry instead of `window.innerHeight`, so scrolling remains correct when AI/Pending sidebars are open.
- ComfyUI draft workflow status now uses the shared workflow placeholder helper, so the renderer preview can report non-contiguous image placeholders consistently with main-process validation.

## Current Renderer Ownership Map

- `src/renderer/App.tsx`
  - Top-level project state
  - toolbar state
  - Save / Import / autosave wiring
  - external change refresh
  - global selection and delete target state
  - undo / redo project history
  - global keyboard shortcuts and menus
  - parking sidebar and AI panel orchestration
- `src/renderer/ai/AiDraftPanel.tsx`
  - AI panel presentation
  - provider settings UI
  - AI resource selection/notes UI
  - single-shot and batch candidate controls
- `electron/main/ai/*`
  - AI provider adapters, settings, prompt/request preview logic, candidate generation, and ComfyUI workflow handling
- `src/renderer/ShotCard.tsx`
  - one storyboard card's presentation
  - dialogue cards and dialogue drag handles
  - script back face
  - lazy card media placeholder
  - card-local `SketchPad` / `LayerPanel` composition
- `src/renderer/SketchPad.tsx`
  - bitmap drawing and erasing UI
  - lasso Select transforms
  - Onion Skin overlay
  - Konva stage wiring
- `src/renderer/LayerPanel.tsx`
  - per-shot layer drawer UI
  - layer row selection and gestures
  - visibility sweep
  - opacity / blend mode / reorder controls
  - Merge / Merge visible / layer add-delete controls
- `src/renderer/ParkingShelf.tsx`
  - right-side parked shot shelf UI

## Verification

Fresh verification for this handoff:

```bash
npm run test
# passed: 62 test files, 390 tests

npm run typecheck
# passed

npm run build
# passed
# Vite still reports the existing non-blocking chunk-size warning:
# dist/assets/index-DXXX94Zv.js 745.37 kB, gzip 227.56 kB
```

There is no `lint` script in `package.json`, so lint was skipped.

## Current Git State Before This Handoff Commit

Before the documentation handoff update, code changes were already present in the working tree:

```bash
git diff --stat
# 16 changed tracked files, 755 insertions, 281 deletions
```

Untracked AI files were also present:

- `electron/main/ai/comfyUiImageProvider.test.ts`
- `electron/main/ai/comfyUiImageProvider.ts`
- `electron/main/ai/comfyUiWorkflow.test.ts`
- `electron/main/ai/comfyUiWorkflow.ts`
- `electron/main/ai/settings.test.ts`
- `electron/main/ai/settings.ts`

This handoff commit should include the existing code changes plus these documentation updates. The project is on `main` tracking `origin/main`. Do not push unless the user explicitly asks; pushing `main` triggers GitHub Actions automatic release.

## Next Recommended Work

Start the next session with an architecture handoff/audit before more feature work. Suggested prompt:

```text
请接手 Storyboard Flow 项目，先不要改代码。

工作目录：
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers

分支：
main

请先阅读：
1. AGENTS.md
2. decisions.md
3. context-handoff.md
4. todo.md
5. README.md

目标：
做一次架构梳理，重点看 App.tsx、styles.css、electron/main/main.ts、AI 模块、preload API 和 storyboard canvas/side panel 的边界。目标不是立刻大改，而是提出一个可分阶段执行的高内聚低耦合计划，方便后续用 git worktree 分工。

边界：
1. 不要碰 Save / Import / TIFF / .storyboard-workbench 格式，除非用户明确要求。
2. 不要自动 push。
3. 先输出 audit 结果和拆分建议，等用户确认后再实施。
```

## Known Remaining Work

- Manual dogfood ComfyUI provider with a real local workflow.
- Manual dogfood OpenAI / Seedream GUI-only settings and error states.
- Manual dogfood single-shot AI Draft generation, Apply, Discard, and request preview.
- Manual dogfood batch 4-up generation, crop-back, Apply All, Discard All, and per-shot resource assignment.
- Manual dogfood storyboard canvas scrollbar on macOS and Windows, with AI/Pending open and closed.
- Current build still emits the documented Vite chunk-size warning.
- Architecture audit is recommended before the next large AI/UI iteration.
- Silent self-update / installer update is not implemented; current update path is in-app notice plus manual download.
- macOS notarization and Windows code-signed installer are not implemented.
- Intel macOS builds are not currently published.
- PSD-first import/export is not implemented.
- Windows Photoshop compatibility has not been tested.
