# Context Handoff

跨 session 交接文档。稳定规则见 `AGENTS.md` 和 `decisions.md`，待办事项见 `todo.md`。此处记录当前代码状态快照，每次 session 结束时覆盖重写。

## Current Product State

- 本地 Electron + React + TypeScript + Vite 的 Storyboard Workbench MVP。
- 一个场景仍等于一个本地图像文件夹；内部状态自动保存到 `.storyboard-workbench/storyboard.project.json`。
- `Save` 仍是唯一会同步真实图片文件名、写工作 TIFF 像素的动作。
- 当前绘图主数据已经迁移为 bitmap layer：
  - JSON 保存 `shots[].layers` 和 `activeLayerId`。
  - 可编辑像素保存在 `.storyboard-workbench/layers/{shotId}/{layerId}.png`。
  - 画笔、橡皮、清空图层和删除普通图层只写 `.storyboard-workbench/`。
- 旧 `sketchLayers` / `imageLayerEdits` 字段仍作为迁移输入保留；打开旧项目时会生成 bitmap layer metadata 和内部 PNG layer assets。
- 不做 AI、导出、SQLite、云同步、Photoshop layer round-trip 或 Photoshop-compatible multi-layer TIFF writing。

## Completed In This Session

- 新增 bitmap layer 数据模型：
  - `BitmapLayer`、`Shot.layers`、`Shot.activeLayerId`。
  - `.storyboard-workbench/layers/{shotId}/{layerId}.png` 路径规则。
  - shared 层新增 add/select/update/move/delete/clear/painted bitmap layer 纯函数和测试。
- 打开普通图片文件夹时，不再要求先 Import 才能开始编辑：
  - 新扫描/导入图片会自动生成 `Image` bitmap layer metadata。
  - 新文件夹首次打开会触发 autosave，创建 JSON 和内部 layer assets。
- Electron layer asset API：
  - `layers:writePng`
  - `layers:readPng`
  - `layers:deletePng`
  - 路径限制在当前 folder 的 `.storyboard-workbench/layers/` 下。
- Renderer 绘图主流程：
  - 图层面板改为操作 bitmap layers。
  - 完成 stroke 后读取 active layer PNG，用 canvas 写入像素，再通过 preload API 写回内部 PNG。
  - 清空当前 layer 会写透明 PNG，不会写真实 TIFF。
  - Undo / redo 对 stroke、clear、delete 捕获并恢复相关 layer PNG snapshot 和 JSON metadata。
  - Renderer 主流程已移除旧 stroke layer 操作函数引用；旧字段只留在 shared/Electron migration 路径。
  - `B` / `E` 快捷键仍切换 Brush / Eraser。
- Save 路径：
  - 如果 shot 有 bitmap layers，Save 按可见 layer 顺序合成 PNG layers 到工作 TIFF。
  - 继续执行现有 rename preflight。
  - `Save` 仍是唯一会改真实文件名和工作 TIFF 像素的动作。
- Legacy migration：
  - 旧 stroke layer 会迁移为对应 paint bitmap layer metadata。
  - Electron 初始化 layer assets 时会 rasterize 旧 stroke 到 PNG。
  - 旧 Image layer edits 会迁移到 Image bitmap layer。
- Onion Skin：
  - 改为优先读取相邻 shot 的 bitmap layer PNG。
  - 仍只做 renderer preview，不写 JSON、PNG、TIFF 或 Save 结果。

## Verification

本次交接前已运行：

```bash
npm run test        # passed, 69 tests
npm run typecheck   # passed
npm run build       # passed, Vite chunk size warning only
```

新增 bitmap layer history helper 后，最新完整测试为：

```bash
npm run test        # passed, 71 tests
npm run build       # passed, Vite chunk size warning only
npm run smoke:bitmap # passed, launches Electron via local CDP
```

Electron GUI smoke 已用本地 Electron app path 定位到 Storyboard Workbench 窗口，并验证：

- 打开普通 PNG 文件夹成功显示 shot。
- 首次 autosave 会创建 `.storyboard-workbench/storyboard.project.json`。
- 首次 autosave 会创建 `.storyboard-workbench/layers/{shotId}/layer-image.png`。
- 图层面板中新增普通 paint layer 会创建 JSON metadata 和内部 PNG layer asset。
- 普通 paint layer 的 hide 和 opacity 会 autosave 到 JSON。
- 删除普通 paint layer 会移除 JSON metadata，并删除对应内部 PNG layer asset。
- Electron CDP smoke 验证了 Image layer 上真实绘制会改变内部 `layer-image.png` hash，`Cmd+Z` 会恢复原 hash，`Cmd+Shift+Z` 会恢复绘制后的 hash；Eraser 会改变 Image layer hash 且 undo eraser 会恢复绘制 hash；Clear current layer 会写透明 layer hash，undo clear 会恢复绘制 hash；Layer panel 的 `Delete current layer` 对 Image layer 执行同样清空语义且可 undo；Save 会生成 SWB-owned TIFF，reload/reopen 后仍从内部 layer PNG 恢复绘制结果：
  - before / undo: `7c669eaf1130b4a32632e0e969acd3dce4df5f403404eab7a20cd125ab1ccfc4`
  - drawn / redo: `5c560fd38543631f9d5b96af9e86e1a6920f813522b58b8592d1c16d4385c369`
  - erased: `fa3894548c6c300769aea2d1ae7d48459e7eebfdf9b6ea23496039f4de935db7`
  - cleared: `738440fafe37d11b377c33463c8e8cf6998ac5591591e4a1a066018b7ac6e247`
  - saved file pattern: `swb-bitmap-smoke-*_scene_stb_artist_v001_0010.tiff`
  - reopened hash: `5c560fd38543631f9d5b96af9e86e1a6920f813522b58b8592d1c16d4385c369`
- Electron CDP smoke 也验证了新增普通 paint layer 的绘制、擦除、undo eraser、opacity `0.5`、blend mode `multiply`、Save 后 layer asset 不变、reload/reopen 后 paint layer metadata 和 PNG hash 保留：
  - paint blank: `8acb6b57817a1fb71fc80513fbc392ed1a6941224f4984f88b7713f054716375`
  - paint drawn / undo eraser / reopened: `f0d1314668ba878a956f3b9bedcbf5cc3a99ee1f9b5f2b47e1f236fa4940aca5`
  - paint erased: `738440fafe37d11b377c33463c8e8cf6998ac5591591e4a1a066018b7ac6e247`
- 该 CDP smoke 已固化为 `npm run smoke:bitmap`。
- 对普通 PNG 执行 Save 后，原 PNG 进入 `Archive/`，生成命名 TIFF，JSON 指向 `status: "owned"` 的 TIFF。
- Save 仍需要用户确认缺失命名字段时是否使用默认 Scene / Artist / Version。

以下行为仍需手动或自动确认：

- `TODO: verify` 普通 paint layer 拖动排序的一致性。
- `TODO: verify` 旧 stroke 项目迁移后的可见结果是否符合预期。
- `TODO: verify` Onion Skin 在 bitmap layer 下的红绿透明度和相邻帧刷新。
- `TODO: verify` mixed aspect-ratio 动画模式、timeline、multi-select shot dragging、double-click dialogue editing。

## Current Branch

当前工作在隔离 worktree：

```text
/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers
```

分支：

```text
bitmap-layer-refactor
```

阶段提交：

```text
def3653 feat: add bitmap layer metadata foundation
0c6484a feat: composite bitmap layers on save
b2370a3 fix: autosave new folders for layer assets
371bcac feat: draw strokes into bitmap layer assets
7eb3c2e feat: migrate legacy strokes to bitmap layers
45e529b feat: render onion skin from bitmap layers
2e0abcc docs: update handoff for bitmap layer workflow
40788ea fix: save ordinary images as swb tiffs
17b983d fix: delete paint layer assets from renderer
8ab9c95 feat: restore bitmap layer assets on undo
7407d52 docs: record image layer cdp smoke
```
