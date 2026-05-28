# Context Handoff

跨 session 交接文档。稳定规则见 `AGENTS.md` 和 `decisions.md`，待办事项见 `todo.md`。此处记录当前代码状态快照，每次 session 结束时覆盖重写。

## Current Product State

- 本地 Electron + React + TypeScript + Vite 的 Storyboard Workbench MVP。
- 一个场景仍等于一个本地图像文件夹；内部状态自动保存到 `.storyboard-workbench/storyboard.project.json`。
- `Save` 仍是唯一会同步真实图片文件名、写工作 TIFF 像素的动作。
- 当前绘图系统仍以 stroke/vector 数据为主：普通 SWB 图层是 `sketchLayers[].strokes`，Image 层编辑是 `imageLayerEdits`，Save 时由 Electron/sharp 烘焙到 TIFF。
- 用户已决定下一轮“大施工”方向：把绘图系统重构为 bitmap layer。可编辑源数据放在 `.storyboard-workbench/`，真实 TIFF 仍只在 Save 时同步。

## Completed In This Session

- 顶部与状态 UI：
  - Save 改为 split button，命名字段收纳到 Save 菜单。
  - Recent 合并进地址栏右侧下拉，地址栏居中。
  - Import 移到左上角。
  - 状态信息移到右下角 `!` popover，移除状态栏重复路径。
  - 整体界面改为深色主题，画布/图像区域保持真实白底显示。
- Save 命名与项目元数据：
  - 项目名、Scene、Artist、Version 可编辑并自动保存到 JSON。
  - Save 文件命名规则改为 `项目名_场号_stb_艺术家名_版本号_0010.ext`，序号按 `0010, 0020...` 递增。
  - Save 前继续走 rename preflight，保护真实文件。
- Add Shot：
  - Add Shot 改为 split button，可选择 `16:9`、`2.39:1`、`1.43:1 IMAX`。
  - 新建不同画幅 storyboard 后，显示容器按真实 canvas 比例显示，去掉黑边。
- 动画模式与 zoom：
  - Zoom 进入动画模式的阈值按当前 shot 真实比例计算。
  - 修复宽画幅最大 zoom 时不进入动画模式的问题。
  - 修复混合尺寸图片在动画模式左右播放时偏上/偏下的问题；切换 shot 后会按当前显示尺寸重新居中。
  - 动画模式新增 Onion Skin 开关：显示前后各一张，上一张偏红、下一张偏绿，只做屏幕预览，不进入 Save。
- 绘图工具与图层：
  - 左侧工具栏使用图标按钮，笔刷/橡皮参数改为右键菜单。
  - 新增右下角图层面板，样式接近简化 Photoshop 图层面板。
  - 支持普通图层新增、删除、重命名、显隐、opacity、blend mode、拖动排序。
  - 移除旧 `sketchData` 兼容层，当前主流程只使用 `sketchLayers` 和 `imageLayerEdits`。
  - Import 后不再默认新增空 Drawing 层，默认选中 Image。
  - Image 层在 UI 心智上普通化：可选中、绘制、擦除；选中 Image 时 `-` 按钮仍显示 `Delete current layer`，点击后删除 Image 当前可见内容并露出白底。
  - 修复 Image 被 Delete 后继续绘制不显示/不保存的问题。
- SWB Format / Import / Save：
  - 引入 SWB-owned TIFF + JSON 主数据方向。
  - Import 会把非 SWB 图片转换为 SWB-owned TIFF，并移动原文件到 Archive。
  - Save 会把 SWB 绘制内容烘焙到 TIFF 像素，并写入 XMP metadata snapshot。
  - 兼容外部编辑方向：兼容的轻度外部 TIFF 修改可自动接受为新 base；不兼容修改保留 warning。
- Undo/Redo：
  - 加入平台区分的 Undo/Redo：macOS 使用 `Command+Z` / `Command+Shift+Z`，PC 使用 `Ctrl+Z`。
  - 修复刚打开软件后第一笔绘制需要切换工具才可撤销的问题。

## Verification

本次交接前已运行：

```bash
npm run test        # passed, 63 tests
npm run typecheck   # passed
npm run build       # passed, Vite chunk size warning only
```

当前 `git diff --stat` 看到的代码改动范围：

```text
electron/main/main.ts
electron/preload/preload.cjs
electron/preload/preload.ts
src/model/storyboard.ts
src/renderer/App.tsx
src/renderer/animationViewport.test.ts
src/renderer/animationViewport.ts
src/renderer/global.d.ts
src/renderer/sketchGeometry.test.ts
src/renderer/sketchGeometry.ts
src/renderer/styles.css
src/shared/projectOps.test.ts
src/shared/projectOps.ts
src/shared/types.ts
src/renderer/onionSkin.ts
src/renderer/onionSkin.test.ts
```

未做完整 Electron GUI smoke。用户已手动验证过多轮交互，但以下最新行为仍建议下个 session 或用户手动确认：

- Onion Skin 红绿透明度和绘制时的视觉干扰程度。
- Image 层选中后 `Delete current layer`、Undo、Save、重开的一致性。
- 深色主题下各菜单/按钮/图层面板的对比度。
- 混合比例 storyboard 在动画模式下的居中和时间线稳定性。

## Next Entry Point

建议先把当前状态提交一次，避免下一轮 bitmap layer 大重构和本轮 UI/图层/Save 改动混在一起。

下一轮如果开启新 session，建议用 `/goal` 执行 bitmap layer 重构计划：

- 目标：把 `sketchLayers` / `imageLayerEdits` 的 stroke 主数据迁移为 `.storyboard-workbench/layers/{shotId}/{layerId}.png` bitmap layer。
- 保留核心规则：真实 TIFF 和真实文件名仍只在 `Save` 时同步。
- 不做 Photoshop 图层 round-trip；外部 TIFF 第一阶段只读取可见合成结果作为 SWB Image bitmap layer。
