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

如果两阶段真实重命名在执行中失败，应尽力回滚已经移动到临时名或最终名的文件。

如果 Save 过程中导入非 SWB 图像，Archive 原图移动、工作 TIFF 移动和后续 metadata 写入失败也应尽力回滚；`Save` 失败不应把用户原图永久留在 `Archive/` 而项目 metadata 仍未更新。

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

## Animation Mode Uses A Stable Dark Frame

动画模式主画面只渲染当前 storyboard，并把当前 storyboard 的真实画幅居中放入稳定的深色 frame。不同画幅切换时 frame 尺寸保持稳定，图片本身不拉伸；timeline 仍显示全部 shot 缩略图用于跳转。

Reason: 线性播放时用户注意力应集中在当前画面；不挂载非当前 storyboard 可以避免其他卡片的 header、z-index 或滚动几何干扰 timeline。混合 16:9、2.39:1、1.43:1 时，外框尺寸跳动会干扰阅读节奏。

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

`Image` 层可选中、绘制、擦除、显隐、重排；如果当前 shot 还有其他图层，选中 Image 时 `Delete current layer` 会删除 Image layer metadata 和内部 `layer-image.png`。如果只剩一个 Image layer，删除按钮禁用。删除 Image layer 不会立刻移动或删除真实原图；真实文件仍只在 Save/import 边界处理。

Reason: 原文件已有 Archive 和 Save 边界保护，用户在绘图时应获得所见即所得的普通图层体验。

## Bitmap Selection Is A Transient Active-Layer Tool

Select 工具的 lasso / rectangle 选区只作用于当前 active bitmap layer。选区状态不写入 `storyboard.project.json`；移动或缩放提交后，只把像素结果写回当前 layer PNG，并通过 bitmap layer snapshot 进入 undo/redo。

Reason: V1 先提供接近 Photoshop 的基础选区移动/缩放体验，同时避免跨图层、保存选区、羽化、魔棒、旋转、自由变形等复杂状态污染内部项目格式。

Selection transform hit testing converts a visible screen-space handle target into canvas coordinates.

Reason: storyboard images can be much larger than their displayed size. A fixed canvas-space radius makes corner scale handles effectively unclickable on high-resolution images.

## Keyboard Shortcuts Are Local User Settings

快捷键配置通过 Electron IPC 读写到本机 `app.getPath("userData")/keyboard-shortcuts.json`。项目文件不保存快捷键配置；`SWB_USER_DATA_DIR` 只用于 smoke 隔离测试环境。

Reason: 快捷键是用户个人偏好，不属于 storyboard 项目内容，也不应随项目文件在团队间传播。

## Layer Drawer Opens By Click, Not Pointer Drag

当前 per-shot 图层抽屉通过右侧小把手点击打开/关闭。实验性的按住拖动推入/拉出交互已移除；图层本身的行拖动排序和横向 opacity 拖动保留。

Reason: 抽屉拖动需要更明确的遮挡和动画模型，否则容易出现窗口浮在画面上或被裁切的错觉。生产工具优先保持干净、稳定、可预期的点击交互。

## Photoshop Interop Stays Separate From Internal Working Data

SWB 内部工作格式继续使用 `.storyboard-workbench/layers/*.png` 加 `storyboard.project.json`。Photoshop layered TIFF 是 Save/Export 的交换写入格式，不替代内部 autosave 数据模型。当前 `Save` 会把多 bitmap layer shot 写回当前场景文件夹中的 Photoshop-readable layered TIFF；单层 shot 仍保存为普通单层 TIFF。主界面隐藏 `Export TIFF`，但底层 export API 仍可另存一份 Photoshop-readable layered TIFF 到 `Photoshop TIFF Export/YYYYMMDDTHHMMSS/`，用于 smoke 和开发调试；现有 `Import` 会把 Photoshop layered TIFF 的 raster layers 吸收到 SWB-owned bitmap layer assets，并归档源 TIFF。

Reason: Photoshop PSD/TIFF 图层格式适合作为交换格式，但不适合作为 V1 的内部事务日志。PNG layer assets + JSON 更容易做 autosave、undo/redo、迁移和安全恢复。

## Save And Export Share Bitmap Layer Ordering

Electron Save and Photoshop TIFF export must use the same bitmap layer filtering, sorting, and defaulting helper.

Reason: Save and export both serialize SWB bitmap layers into external TIFF outputs. Keeping layer eligibility and order in one helper reduces drift without changing the Save boundary or treating Photoshop TIFF as the internal working format.

## Layered TIFF Save Writes Once

多图层 TIFF 的 Save 只写一次最终 Photoshop-readable TIFF。Electron 把 SWB metadata 传给 Python writer；Python writer 在生成最终 composite 后计算 `baseFingerprint`，再把 SWB XMP 和 Photoshop layer records 一起写入最终 TIFF。

Reason: 之前的两遍写入是为了先得到最终 TIFF fingerprint，再第二次写入 XMP。把 fingerprint 计算放进最终 writer 后，可以保留 SWB metadata 和 Photoshop layers，同时少做一次大 TIFF 写入。

## Photoshop TIFF Python Dependencies Resolve From Stable Locations

Photoshop TIFF import/export Python deps 的解析顺序是 `SWB_PYTHON_DEPS_DIR`、packaged resources `python-deps/photoshop-tiff`、local dev vendor `vendor/python/photoshop-tiff`，最后才 fallback 到旧 spike 目录 `/private/tmp/psdtags-spike-deps`。

Reason: 临时 spike 目录不适合作为长期默认依赖来源。保留 fallback 保护现有开发环境，同时让开发目录和未来打包资源目录成为稳定路径。

## Locked Bitmap Layers Protect Content But Not Visibility

Locked bitmap layer 仍可被选中，也可显示/隐藏；但不能绘制、擦除、Select transform、Clear、Delete、重命名、调整 opacity / blend mode 或排序。

Reason: 锁定的核心目的是避免误改像素和图层属性。显示/隐藏属于查看状态，允许切换可以保持接近 Photoshop 的图层管理体验。

## Legacy Strokes Are Migration Input

旧项目中的 `sketchLayers`、`imageLayerEdits`、`baseVisible` 和 `activeLayerTarget` 只作为一次性迁移输入。打开旧项目后，Electron 会把旧 stroke 数据 rasterize 到内部 PNG layer assets，renderer 主流程不再依赖这些字段。

Reason: 迁移必须保护旧项目可见结果，同时避免新代码继续扩展两套绘图主数据。

Non-goal: bitmap layer 重构不代表完整 Photoshop 图层 round-trip。Photoshop layered TIFF import/export 已经产品化为 raster layer 交换路径；PSD-first、复杂 Photoshop 图层完整保真和文件监听同步仍是待验证方向。

## V1 Avoids Heavy Features

V1 刻意不包含 AI 字段、导出、SQLite、Photoshop 集成、文件监听、云同步和复杂绘图工具。

Reason: 产品目标是一个可用的最小分镜排列工具，后续可扩展。
