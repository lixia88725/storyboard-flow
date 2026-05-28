# Decisions

架构决策记录。AGENTS.md 引用此文件，不再重复这些规则。

## Folder Is The Project Boundary

一个场景 = 一个本地图片文件夹。

Reason: 匹配 Bridge 式的工作流，用户不需要额外管理 project file。

## Metadata Lives Beside Images

工作区元数据存于图片文件夹内的 `.storyboard-workbench/storyboard.project.json`。

Reason: 文件夹保持可移植，无需数据库即可恢复内部状态。

## Images Stay In Place

只存图片路径和元数据，不存二进制。

Reason: V1 保持简单、快速，兼容 Finder/Bridge 工作流。

Note: 当前实现已经开始把 SWB 可编辑状态写入 `.storyboard-workbench/` 和 TIFF metadata/cache。真实交付图片仍位于场景文件夹，Archive 原文件不应被修改。

## Autosave And Filename Sync Are Separate

自动保存只写元数据。`Save` 执行真实的文件名同步。

Reason: 内部状态不应丢失，但不能意外重命名用户文件。

## Save Uses Ordered Filenames

文件名同步时，图片重命名为 `项目名_场号_stb_艺术家名_版本号_0010.ext`、`..._0020.ext` 等。`stb` 固定小写，序号按 10 递增并补 4 位。

Reason: Finder 和 Bridge 能够显示与 app 内一致的顺序，同时保留手动插入中间号位的空间。

## Save Must Preflight Rename Plans

执行真实文件重命名前，必须检查最终路径和临时路径冲突。

Reason: `Save` 是唯一会改动真实图片文件名的操作，必须先发现冲突，避免半完成重命名或覆盖用户文件。

## TIFF Preview Is A Cache

TIFF 文件在 `.storyboard-workbench/previews/` 下生成 PNG 预览。

Reason: 浏览器对 TIFF 渲染不可靠，PNG 预览对渲染器友好。

## SWB Format Uses JSON As Source Of Truth

`.storyboard-workbench/storyboard.project.json` 是主数据；TIFF XMP metadata 只是便携快照。

Reason: JSON 更容易稳定读写、测试和迁移。TIFF metadata 可能被外部工具修改或丢失，冲突时应以 JSON 为准。

## Import Archives Original Files

将非 SWB 图像转换为 SWB-owned TIFF 时，原文件移动到 `Archive/YYYY-MM-DD-HHMMSS/`。

Reason: 用户需要可逆的安全网；工作区 TIFF 可以被 SWB Save 更新，但原始交付不应被静默覆盖。

## Compatible External TIFF Edits Are Accepted

如果外部工具修改 SWB TIFF 的像素但 shot id、尺寸和 metadata 仍兼容，打开时可自动接受为新的 base，不重复 Archive。

Reason: Photoshop 或其他工具可作为外部像素编辑器使用；轻度兼容编辑不应打断用户。

## Add Shot Creates A Blank TIFF

`Add Shot` 在当前场景文件夹创建白色 TIFF，支持 `16:9`、`2.39:1`、`1.43:1 IMAX` 预设。

Reason: 用户想在当前工作区内创建新分镜图，而非导入外部图片。

## Project Logic Belongs In Shared Pure Functions

排序、对白移动、草图更新、重命名规划等逻辑位于 `src/shared/projectOps.ts`。

Reason: 这些行为在 React UI 状态之外更易测试、更安全演进。

## Multi-Select Reordering Has Explicit Placement

Shot 成组拖拽排序需要显式表达 `before` / `after` 目标位置。

Reason: 用户会把多选组拖到前方或后方的 storyboard，只有“插入到目标前”无法匹配真实排序意图。

## Animation Mode Is View-Driven

当单张 storyboard 在当前窗口中接近填满工作区时进入动画模式，并显示底部时间线。

Reason: 这是从全局整理顺序切换到线性感知故事板流动的状态，不应该只依赖某个固定 zoom 数字。

## Storyboard Display Uses Real Canvas Aspect Ratio

Storyboard 显示容器按每张 shot 的 `swb.canvasWidth/canvasHeight` 设置比例，不再使用固定比例容器。

Reason: 混合画幅项目中，16:9、2.39:1、1.43:1 都不应出现额外黑边或裁切；绘制坐标也必须和真实画布尺寸一致。

## Onion Skin Is Preview Only

动画模式的 Onion Skin 只在 renderer 中叠加前后帧作为绘制辅助，不写入 JSON、TIFF 或 Save 结果。

Reason: 洋葱皮是临时参考，不属于用户作品内容。

## Current Drawing Layers Are Bitmap-Based

当前普通 SWB 图层和 `Image` 层都使用 bitmap layer。JSON 保存 `shots[].layers` 元数据，像素源文件保存在 `.storyboard-workbench/layers/{shotId}/{layerId}.png`。Save 时由 Electron/sharp 合成可见 bitmap layers 并写入工作 TIFF。

Reason: Storyboard Workbench 更接近像素绘制工具而非矢量绘图工具；统一 bitmap layer 能减少 Image 层和普通图层的行为差异。

Undo / redo for bitmap drawing stores command-level JSON snapshots plus the affected layer PNG data URLs. The history remains capped to avoid unbounded memory growth.

Reason: bitmap layer pixels are no longer recoverable from JSON alone, so undo must restore both metadata and internal layer assets.

## Image Layer Behaves Like A Normal Layer In UI

`Image` 层固定在最底部，但可选中、绘制、擦除；选中 Image 时 `Delete current layer` 删除其当前可见内容而不是删除 shot 或真实文件。

Reason: 原文件已有 Archive 和 Save 边界保护，用户在绘图时应获得所见即所得的普通图层体验。

## Legacy Strokes Are Migration Input

旧项目中的 `sketchLayers`、`imageLayerEdits`、`baseVisible` 和 `activeLayerTarget` 只作为一次性迁移输入。打开旧项目后，Electron 会把旧 stroke 数据 rasterize 到内部 PNG layer assets，renderer 主流程不再依赖这些字段。

Reason: 迁移必须保护旧项目可见结果，同时避免新代码继续扩展两套绘图主数据。

Non-goal: bitmap layer 重构不代表 Photoshop 图层 round-trip。第一阶段仍只读取 Photoshop TIFF 的可见合成结果，不解析或写回 Photoshop 图层结构。

## V1 Avoids Heavy Features

V1 刻意不包含 AI 字段、导出、SQLite、Photoshop 集成、文件监听、云同步和复杂绘图工具。

Reason: 产品目标是一个可用的最小分镜排列工具，后续可扩展。
