# Context Handoff

跨 session 接手页。稳定规则见 `AGENTS.md`，架构边界见 `decisions.md`，待办事项见 `todo.md`。

## Current Workspace

- Worktree: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `main`
- Current handoff date: 2026-06-12
- Previous handoff baseline: `0eb44c0 Document Storyboard Flow naming boundary`
- Current goal of this handoff: preserve the latest feature work, validation results, and next-step map so another session or AI agent can continue without rediscovering context.

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

## What This Session Finished

### Script Bootstrap And Project Creation

- Added first-pass Markdown storyboard bootstrap: numbered-list `.md` files can create a new SWB project in an empty folder.
- Generated shots receive the parsed item text as `scriptText`.
- The new project writes `.storyboard-workbench/storyboard.project.json` and root `storyboard-script.md`, then opens automatically.
- Existing Save / Import semantics were kept: no AI, no generated images, no append-to-existing-project flow.

### Parking Sidebar

- Added `project.parkedShots` for a right-side pending area.
- Main workspace renders only `project.shots`; parked shots stay in project JSON but do not enter Save output, filename sync, Timeline, or `storyboard-script.md`.
- Sidebar is opened and closed from the top-right sidebar button. Earlier edge-hover auto-open was removed because it conflicted with shot reorder intent.
- Parked shots can be restored into the main workspace by drag/drop.

### Layer Merge And Multi-Select

- Added Merge down / Merge visible workflows and then unified the drawer button label to `Merge`.
- `Cmd+E` on macOS and `Ctrl+E` on Windows/Linux now trigger the same Merge action as the button:
  - one selected layer: merge active layer down into the next visible layer.
  - multiple selected layers: merge selected visible/unlocked layers into the lowest selected layer.
- Merge visible now includes locked visible layers in the baked result, but preserves locked layer metadata/assets by hiding those locked source layers instead of deleting them.
- Added Shift-click layer multi-select, group reorder, group opacity drag, and consistent selected-row visuals.

### Drag And Copy Interactions

- Option/Alt drag copy for storyboard, layer, and dialogue is retired.
- Holding Option/Alt while dragging now follows the same move/sort path as ordinary drag.
- `Cmd+C` / `Ctrl+C` and `Cmd+V` / `Ctrl+V` now copy/paste storyboard and layer selections.
- Storyboard paste inserts the copied storyboard after the current storyboard and uses a small slide-out animation from the source storyboard.
- Layer paste inserts the copied layer below the current layer and uses a small slide-out animation from the source layer.

### Drawing Stability And UI Polish

- Added a renderer bitmap layer write queue so fast brush strokes and eraser writes do not overwrite newer strokes with stale async layer writes.
- Simplified Select to lasso-only in the UI flow; the Rectangle choice UI was removed.
- Dialogue entry is single-click, with a cleaner transparent textarea and proportional dialogue-zone sizing.
- Shot card top and bottom bars were aligned visually and rounded.
- Layer drawer visuals were refined: selected-row bar, drawer shadow layering, and transparent scrollbar track.
- Delete/Backspace now deletes the last selected object: a clicked layer deletes the active layer, while a clicked storyboard deletes the selected storyboard(s).

### Save, Import, External Editing, And Close Flow

- Save progress now reports the actual changed TIFF write count instead of the whole project shot count.
- Added a Save error dialog for development/debug iteration.
- Close prompt now includes Save and Close, Close Without Saving, and Cancel.
- Fixed Save-and-Close close-loop behavior on larger projects by separating the save operation from the close confirmation state.
- External Photoshop edit detection now checks known SWB TIFF paths, uses JSON base fingerprints as the owned baseline, and avoids locking the app for internal autosave/dirty state.
- Compatible external TIFF edits auto-import. Dirty SWB + external Photoshop edits now keep the same shot live by updating root TIFF ownership state / `baseFingerprint` while preserving local SWB layer metadata and layer PNGs; manual Import can still bring the Photoshop version in as a copy.
- Large folder opening now reports loading progress and can show existing SWB project JSON state before slower background checks finish.

### Photoshop TIFF Export Robustness

- Photoshop layered TIFF export now resizes copied layer PNGs to the manifest canvas size before writing, so copied layers from different shot sizes do not fail export.
- Python dependency resolution continues to prefer stable local/vendor/package resource paths over the old temp fallback.

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
# passed: 40 test files, 304 tests

npm run typecheck
# passed

npm run check:preload
# passed

npm run build
# passed
# Vite still reports the existing non-blocking chunk-size warning:
# dist/assets/index-DO1Roag-.js 711.48 kB, gzip 217.19 kB
```

There is no `lint` script in `package.json`.

## Current Git State Before This Handoff Commit

Before the final handoff commit, the working tree had only documentation changes:

```bash
git diff --stat
# context-handoff.md and todo.md only
```

The project is on `main` tracking `origin/main`. The GitHub repository is `https://github.com/lixia88725/storyboard-flow`.

## Next Recommended Work

Start a fresh session for a release-and-team-handoff audit before first external user testing and team split-up. Suggested prompt:

```text
请接手 Storyboard Flow 项目，做一次发布前 + 团队接手前的系统 audit。

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
只做 audit，不要先改代码。系统检查第一批用户测试前的稳定性风险、核心用户体验风险、团队分工开发风险、技术债/测试覆盖风险、交付/打包风险。

输出：
生成 docs/audit-2026-06-06-release-and-team-handoff.md，按 P0 / P1 / P2 / 明确不做 / 推荐下一步执行顺序组织。
```

## Known Remaining Work

- Active P1: release-and-team-handoff audit; see `todo.md`.
- Current P2 and PSD future items are in `todo.md`.
- Full installer/electron packager integration is not implemented.
- PSD-first import/export is not implemented.
- Windows Photoshop compatibility has not been tested.
- Current build still emits the documented Vite chunk-size warning.
