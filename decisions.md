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

## Autosave And Filename Sync Are Separate

自动保存只写元数据。`Save` 执行真实的文件名同步。

Reason: 内部状态不应丢失，但不能意外重命名用户文件。

## Save Uses Ordered Filenames

文件名同步时，图片重命名为 `001_原文件名.ext`、`002_原文件名.ext` 等。

Reason: Finder 和 Bridge 能够显示与 app 内一致的顺序。

## Save Must Preflight Rename Plans

执行真实文件重命名前，必须检查最终路径和临时路径冲突。

Reason: `Save` 是唯一会改动真实图片文件名的操作，必须先发现冲突，避免半完成重命名或覆盖用户文件。

## TIFF Preview Is A Cache

TIFF 文件在 `.storyboard-workbench/previews/` 下生成 PNG 预览。

Reason: 浏览器对 TIFF 渲染不可靠，PNG 预览对渲染器友好。

## Add Shot Creates A Blank TIFF

`Add Shot` 在当前场景文件夹创建一张 1920×1080 白色 TIFF。

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

## V1 Avoids Heavy Features

V1 刻意不包含 AI 字段、导出、SQLite、Photoshop 集成、文件监听、云同步和复杂绘图工具。

Reason: 产品目标是一个可用的最小分镜排列工具，后续可扩展。
