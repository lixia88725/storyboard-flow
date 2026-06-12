# Context Handoff

跨 session 接手页。稳定规则见 `AGENTS.md`，架构边界见 `decisions.md`，待办事项见 `todo.md`。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `main`
- Current handoff date: 2026-06-12
- Previous shipped baseline before this docs-only handoff: `90fca49 optimize storyboard marquee selection`
- Current goal of this handoff: preserve the latest release automation, marquee performance work, validation results, and next-step map so another session or AI agent can continue without rediscovering context.

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
- Version rule for push-triggered releases: `package.json` major/minor plus GitHub run number, e.g. `0.1.6`. Manual `workflow_dispatch` and `v*.*.*` tag releases are still supported.
- Current update manifest URL: `https://raw.githubusercontent.com/lixia88725/storyboard-flow-releases/main/update.json`.
- Current app update behavior: Storyboard Flow checks the manifest and shows an in-app update notice when `update.json.latest` is newer than the running packaged app version.
- Windows package: `Storyboard-Flow-Windows-x64.zip` is a portable folder distribution. It includes the Electron runtime, app files, Windows Python runtime, and Photoshop TIFF Python dependencies; users can replace/overwrite the old folder with the new extracted folder.
- macOS package: `Storyboard-Flow-macOS-arm64.zip` contains an Apple Silicon `.app`. It is ad-hoc signed but not Apple-notarized, so first launch may show macOS security prompts. Intel macOS builds are not currently published.
- Not implemented: silent self-updating, installer-based updates, macOS notarization, code-signed Windows installer, Intel macOS package, or automatic release notes beyond the generated version label.

## Recent Session Summary

### Release Automation

- GitHub Actions now acts as the tester release pipeline. A `git push origin main` triggers tests, builds Windows portable and macOS Apple Silicon packages, publishes a GitHub Release to `lixia88725/storyboard-flow-releases`, and updates `update.json`.
- The app has an in-app update notice path. When a packaged app sees a newer `update.json.latest`, the bottom-right status/info panel can show the available version with `Download` and `Later`.
- Windows distribution is currently a portable zip; macOS distribution is an ad-hoc signed Apple Silicon `.app` zip.

### Marquee Selection Performance

- Latest shipped code: `90fca49 optimize storyboard marquee selection`.
- Storyboard multi-card marquee now uses a temporary `.is-marquee-selected` DOM class while dragging, then commits real `selectedShotIds` once on pointer up.
- Dragging no longer toggles `.shot-card.is-selected` across many cards every frame; this reduces selected-card repaint cost while preserving final selection semantics.
- The selection rectangle now updates position via `translate3d(...)` instead of `left/top`, keeping the existing `requestAnimationFrame` throttling and hit-test rules.
- Measured scenario: 60 shots, 50% zoom, background drag with edge-scroll. After the change, dragging used 60 `.is-marquee-selected` elements and 0 `.is-selected` elements; after mouseup, `.is-marquee-selected` cleared and 60 `.is-selected` elements were committed.

### UI Polish Already Landed

- Toolbar labels and icon contrast were flattened toward the current Codex-style UI direction.
- Import / Save / Add controls were aligned to the slimmer top bar.
- Animation timeline now sits against the window edges and follows the active shot as selection advances.
- Radial tool menu now has no large gray backing disk, has open/close scale animation, a tighter radius, and a smaller center close button.

## Current Renderer Ownership Map

- `src/renderer/App.tsx`
  - Top-level project state
  - toolbar state
  - Save / Import / autosave wiring
  - external change refresh
  - global selection and delete target state
  - undo / redo project history
  - global keyboard shortcuts and menus
  - parking sidebar orchestration
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
# passed: 45 test files, 333 tests

npm run typecheck
# passed

npm run build
# passed
# Vite still reports the existing non-blocking chunk-size warning:
# dist/assets/index-DdfCM3Go.js 721.41 kB, gzip 221.26 kB
```

There is no `lint` script in `package.json`.

## Current Git State Before This Handoff Commit

Before this docs-only handoff update, the working tree was clean:

```bash
git diff --stat
# no output
```

This handoff commit should include only documentation changes. The project is on `main` tracking `origin/main`. The GitHub repository is `https://github.com/lixia88725/storyboard-flow`.

## Next Recommended Work

Start the next session from manual tester readiness and feedback loops rather than another broad audit. Suggested prompt:

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
确认最新 main 和 GitHub Actions 发布状态，检查 release repo 的最新 Release / update.json 是否与本地最新提交匹配，然后根据用户反馈继续做小步 UI 或稳定性修复。

重点：
1. 不要碰 Save / Import / TIFF / .storyboard-workbench 格式，除非用户明确要求。
2. 如果要发布，记住 push main 会自动触发 release。
3. 优先手动 dogfood Windows portable save、macOS first launch、软件内 update notice、60+ shots 框选丝滑度。
```

## Known Remaining Work

- Active manual dogfood list is in `todo.md`.
- Silent self-update / installer update is not implemented; current update path is in-app notice plus manual download.
- macOS notarization and Windows code-signed installer are not implemented.
- Intel macOS builds are not currently published.
- PSD-first import/export is not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the documented Vite chunk-size warning.
