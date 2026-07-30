# Decisions

架构决策记录。AGENTS.md 引用此文件，不再重复这些规则。

## Product Name Is Storyboard Flow

`Storyboard Flow` 是唯一产品名。UI、README、GitHub 文案、窗口标题、新用户可见状态文案和新写入的 TIFF metadata 都应使用 `Storyboard Flow`。

`Storyboard Workbench` 是旧产品名，只保留为 legacy metadata 兼容值。`.storyboard-workbench/`、`SWB`、`swb-*`、`SWB_PYTHON_DEPS_DIR` 和 `storyboard-workbench.local` 暂时保留为内部格式/命名空间/环境变量名称。

Reason: 产品命名需要统一，避免用户和 AI agent 混乱；但内部格式名已经写入旧项目、TIFF XMP、测试和 Photoshop 交换路径。彻底迁移内部格式应作为单独任务处理，包含旧项目读取、首次保存迁移、XMP 兼容和 smoke 覆盖。

## Tester Releases Use GitHub Release Plus Update Notice

当前测试期发布方式是：源代码仓库 `lixia88725/storyboard-flow` 的 `main` 被 push 后，由 GitHub Actions 构建 Windows portable zip 和 macOS Apple Silicon `.app` zip，并发布到公开 release 仓库 `lixia88725/storyboard-flow-releases`。应用读取 release 仓库的 `update.json`，在有新版本时显示软件内更新提示，但不静默下载安装。

Reason: 早期测试需要快速分发和收集反馈，优先减少人工打包/传文件成本；但正式安装器、静默更新、macOS notarization、Windows code signing 都会增加发布复杂度。当前策略把“发现新版本”和“下载安装”分开，适合朋友/同事小范围测试。

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

## External TIFF Sync Uses JSON Baseline First

已知 SWB TIFF 路径可以参与外部编辑检测，但 owned 项目的像素变化比较优先使用 `storyboard.project.json` 中的 `shot.swb.baseFingerprint`。TIFF XMP 仍用于检查 shot id、画布尺寸和 SWB 兼容性，但 Import 后的旧 XMP `baseFingerprint` 不应覆盖 JSON 基线。

Reason: Import 可更新内部 layer PNG 和 JSON，但不写 root TIFF。若下一次检测继续相信旧 XMP，就会把同一次 Photoshop 修改反复判成外部修改，导致 Import 锁定无法闭环。

## Compatible External Edits May Auto-Import

当已知 SWB TIFF 有兼容外部编辑时，SWB 可以自动吸收 Photoshop 保存结果。同一 shot 同时有 SWB 本地 dirty layer 改动时，自动吸收只更新 root TIFF ownership 状态和 `baseFingerprint`，保留现有 SWB layer metadata 与本地 layer PNG；用户手动 Import 仍可把 Photoshop 版本作为副本 shot 导入。

Reason: Photoshop 保存后的兼容修改应接近实时进入 SWB；但 SWB 本地绘画 layer 不应被外部 Photoshop 保存静默覆盖。V1 先把 dirty 场景定义为 “Photoshop 更新外部/root TIFF 状态，SWB layer PNG 继续保留”，复杂 Photoshop layer 冲突留给 PSD-first / layer round-trip 方向。

## Add Shot Creates A Blank TIFF

`Add Shot` 在当前场景文件夹创建白色 TIFF，支持 `16:9`、`1.85:1`、`9:16 Phone`、`2.39:1`、`1.43:1 IMAX` 预设。

Reason: 用户想在当前工作区内创建新分镜图，而非导入外部图片。

## Project Logic Belongs In Shared Pure Functions

排序、对白移动、草图更新、重命名规划等逻辑位于 `src/shared/projectOps.ts`。

Reason: 这些行为在 React UI 状态之外更易测试、更安全演进。

## Renderer Components Have Explicit Ownership Boundaries

`App.tsx` owns top-level project state, Save/Import/autosave wiring, global selection, shortcuts, menus, and history. `Topbar.tsx` owns the board-view segmented control. `ToolRail.tsx` owns drawing tools. `ShotCard.tsx` owns per-card storyboard presentation, dialogue cards, lazy media placeholders, and card-local composition of `SketchPad` and `LayerPanel`. `JapaneseStoryboardView.tsx` owns the Japanese storyboard sheet presentation, drawable picture cells, and row-level editing/drag handles. `ShotPreviewComposite.tsx` owns reusable shot/layer preview composition for non-drawing surfaces. `SketchPad.tsx` owns bitmap stage behavior. `LayerPanel.tsx` owns the per-shot layer drawer.

Reason: The renderer was becoming too large for smooth collaboration. Keeping Save/Import/history in `App.tsx` while moving card, canvas, and layer drawer presentation into focused components reduces merge conflicts and lowers the risk of UI work accidentally touching filesystem boundaries.

## Large Storyboards Window Editors, Not Layout

普通 Storyboard 和 Japanese Storyboard 都保留完整 card/row 外壳、CSS 布局、DND 和 marquee 几何，但图片预热和完整编辑器挂载使用不同范围。视口上下各一个 viewport 是 Warm 图片范围；只有视口上下 25% 的 Hot 范围挂载完整 `SketchPad`。离开 Hot 的 shot 使用无 Canvas、无 ResizeObserver、无全局绘图事件的静态 bitmap layer 图片栈。primary selection、动画焦点、打开图层抽屉以及正在绘画/Select 的 shot 会被 pin 住，不能在交互中卸载。

Warm 范围只主动 eager/decode 最底部的 base layer，其他可见 layer 保持 lazy；完整 layer stack 在进入 Hot 后加载。这样普通 50% grid 不会为了提前准备图片而一次解码数百张全尺寸 paint PNG，也不会把编辑器推迟到真正进入屏幕后才挂载。Cold/Warm/Hot 状态写在 card/row 外壳的 renderer-only data attribute 上，performance smoke 可直接审计媒体级别、编辑器峰值、挂载 churn 和可见图片就绪状态。

Renderer 通过一个以 `.workspace-board-scroll` 为 root 的共享 Warm/Hot `IntersectionObserver` 对管理双向进入/退出。Bitmap layer 普通显示、静态 composite、Timeline、图层缩略图和 Onion Skin 使用经过 main-side layer path 校验的 `storyboard-img://layer` URL；`readLayerPng` 只用于真实像素修改和 Undo/Redo snapshot。Cache bust 使用 renderer-only per-shot revision，metadata-only shot 更新和重排不应刷新无关 layer URL。

画笔高频路径使用缓存的 stage rect、coalesced pointer events、ref 内 points、每 RAF 最多一次 Konva snapshot，以及 DOM-ref brush cursor。单次 bitmap edit 只读取一次旧 layer PNG；同一份数据同时作为 Undo snapshot 和绘制输入。第一下按压用即时 dot preview 显示，磁盘写入、history 和 autosave 仍在 pointer-up 后经过原有 bitmap write queue。

Reason: 整卡虚拟化会破坏 CSS Grid、dnd-kit、文本编辑和框选几何；只窗口化重型 media/editor 可以保留交互模型，同时让 130–250 shot 场景不再常驻数百个 Konva Stage，也避免被动滚动把整套 layer PNG 作为 base64 拉进 renderer heap。图片预热与编辑器挂载必须分离：预热太窄会把解码集中到可见边缘，预热全部图层又会让多层场景在滚动中产生解码风暴。当前 base-first Warm 策略匹配 C23 的 1–3 layer 生产分布；普遍 8+ full-resolution layer 的场景需要后续 flattened proxy/thumbnail cache，而不是继续缩小 Hot 距离。

## Marquee Feedback Uses One Canvas And Freezes Media Churn

普通与 Japanese Storyboard 圈选都只操作一个固定、裁切在 `.workspace-board-scroll` 内的 Canvas 覆盖层。pointer-down 一次缓存 viewport、scroll 起点和全部 shot 的文档坐标；pointer-move 每 RAF 最多处理一次，只读取 `scrollTop/scrollLeft`，不再逐卡添加临时 class，也不再逐帧读取 `getBoundingClientRect()`。绿色选框、橘红候选边和实时数量都画在 Canvas；松手后覆盖层保留一帧，再交接给正式 React `is-selected` 边框。

圈选期间 Warm/Hot `IntersectionObserver` 继续记录最新可见性，但媒体 Provider 暂停向 card/row 发布 tier 变化。现有编辑器不卸载，新滚入 shot 暂用静态图片；primary selection、绘画、Select 和图层抽屉 pinning 仍可直接获得 Hot。松手后下一帧恢复，并按每帧最多 6 个变化分批处理：先卸载离屏编辑器，再挂载 Hot，最后处理 Warm/Cold 图片预热。新的圈选 lease 会取消旧恢复队列。

Reason: 破坏性实测否定了最初的“双 SVG path”假设：在 Chromium 中每帧修改 SVG `d` 会进入 SVG Layout，36 帧产生约 38–39 次 Layout。Canvas 保留单层反馈和相同视觉语义，但避开 DOM/SVG layout pipeline；冻结媒体窗口则避免边缘滚动时 SketchPad mount/unmount 与命中测试争抢主线程。

## Current Architecture Map

Storyboard Flow is a local-first Electron app with four major layers:

1. Renderer UI and interaction layer
   - `src/renderer/App.tsx` is the composition shell for workspace open/load, Save/Import wiring, bitmap layer asset action composition, global selection, sidebar orchestration, and cross-domain coordination.
   - Focused renderer controllers own low-risk orchestration for autosave, external refresh, zoom, marquee, history, DND, selection, sketch/tool settings, current-layer actions, add-shot, delete, dialogue, clipboard, layer metadata, board pan, and AI project changes.
   - `boardViewMode.ts` defines the non-persistent board-level switch between storyboard mode and Japanese storyboard sheet mode.
   - `ShotCard.tsx`, `SketchPad.tsx`, `LayerPanel.tsx`, and `ParkingShelf.tsx` own card presentation, bitmap drawing/select behavior, layer drawer UI, and parked-shot UI.
   - `Topbar.tsx` owns the board-view segmented control. `ToolRail.tsx` owns drawing tools only.
   - `JapaneseStoryboardView.tsx` owns Japanese storyboard sheet layout: rows ordered by shot order, drawable picture cells, action text backed by `Shot.scriptText`, dialogue text backed by existing Dialogue records, and Cut-area drag handles.
   - `ShotPreviewComposite.tsx` owns non-interactive shot/layer preview rendering reused outside `ShotCard`, and `editableDialogueText.ts` owns the text-to-dialogue conversion used by sheet editing.
   - Storyboard and Japanese storyboard modes share the same main shot selection, marquee, DND, pending shelf, `reorderShots`, `reorderShotGroup`, zoom state, max-zoom animation mode, and Space hand-pan flow; only the insertion geometry and presentation layout differ.
   - Rule: add behavior to focused helpers/controllers first when there is an obvious owner; keep `App.tsx` as the explicit composition point for protected cross-domain wiring.

2. Electron main and filesystem layer
   - `electron/main/main.ts` is the protected app composition layer for Electron startup, IPC registration, Save / Import / TIFF orchestration, and shared helper injection.
   - Low-risk IPC and runtime glue live in focused `electron/main/*AppRuntime.ts` modules. Read-side and settings-style behavior lives in focused `electron/main/*Service.ts` modules.
   - Photoshop/TIFF exchange helpers live in dedicated main-side modules such as `photoshopTiffExport.ts`, `photoshopTiffImport.ts`, `bitmapLayerOrdering.ts`, and `storyboardScript.ts`.
   - Rule: do not move `saveWorkspace`, `importProjectToSwbFormat`, `writeSwbMetadataToTiffs`, `workspace:save`, `workspace:importSwbFormat`, or Photoshop layered TIFF writer composition without a dedicated Save / Import / TIFF plan.

3. Shared project logic layer
   - `src/shared/projectOps.ts` owns pure project-data behavior such as ordering, dialogue movement, layer metadata updates, rename planning, lock rules, and SWB import status.
   - Focused shared tests should cover behavior changes before renderer or Electron wiring is changed.
   - Rule: if a change affects project JSON semantics, start in shared pure logic instead of hiding the behavior inside a UI component.

4. AI Draft layer
   - `electron/main/ai/*` owns provider adapters, GUI-only settings, prompt/request preview logic, candidate generation, batch generation, ComfyUI workflow handling, and AI file/resource services.
   - `src/renderer/ai/aiClient.ts` is the renderer API boundary. Controller hooks, action controllers, and section components own renderer-side AI state and UI composition.
   - Rule: AI output stays candidate-first and additive. Apply adds an `AI Draft` bitmap layer and must not replace base art or bypass Save / Import / TIFF boundaries.

Cross-cutting contracts:

- Preload: update `electron/preload/preload.ts`, `electron/preload/preload.cjs`, and renderer typings together; run `npm run check:preload`.
- CSS: `src/renderer/styles.css` is the import-order manifest; feature styles live under `src/renderer/styles/*`; `production-slate-theme.css` remains the final override layer.
- Disk format: `.storyboard-workbench`, `SWB`, `swb-*`, and `storyboard-workbench.local` remain internal compatibility names until a separate migration plan exists.
- Save boundary: `Save` is the only operation that synchronizes real image filenames and writes working TIFF pixels. Autosave writes metadata only.
- Worktree rule: one slice owns one domain. Do not mix renderer behavior, Electron filesystem behavior, CSS cleanup, preload contract changes, and AI provider work in the same slice.
- Stop rule: do not refactor only to reduce line counts. Start a new architecture slice only for a repeated conflict, real bug-risk hotspot, clear module owner, and focused test plan.

## Parallel Work Uses Slice-Owned Worktrees

Future architecture work should split into slice-owned git worktrees instead of multiple people or agents editing the same aggregation files at the same time:

- App orchestration hooks: `src/renderer/App.tsx` and focused renderer hook files.
- Electron main services: `electron/main/main.ts`, `electron/main/ipc/`, and small main-side services.
- Preload contract: `electron/preload/`, `src/renderer/global.d.ts`, and `scripts/check-preload-sync.mjs`.
- CSS theme cleanup: `src/renderer/styles.css` and `src/renderer/styles/`.
- AI controller/client: `src/renderer/ai/`, `electron/main/ai*.ts`, and AI provider modules.

Each worktree should own one slice and avoid opportunistic edits outside that slice. Changes to Save / Import / TIFF / `.storyboard-workbench` behavior require a separate explicit plan and should not be bundled with renderer UI, CSS, or AI controller cleanup.

Validated architecture result:

- Renderer, CSS, Electron, and AI slices were tested in separate worktrees and integrated without cross-domain conflicts when each slice owned one domain.
- Low-risk renderer orchestration now has focused controllers. The remaining `App.tsx` work is mostly protected workspace open/load, Save/Import wiring, and bitmap layer asset action composition.
- Low-risk Electron IPC/read-side/settings/runtime glue now has focused modules. Protected Save / Import / TIFF orchestration remains in `electron/main/main.ts` by design.
- CSS split is complete enough for collaboration: `styles.css` is an import-order manifest, feature styles live under `src/renderer/styles/*`, and `production-slate-theme.css` remains the final override layer.
- AI renderer/controller split is complete enough for parallel feature work. Future AI work should prioritize provider/candidate hardening and dogfood over architecture-only splitting.
- The standard verification set for architecture slices is `npm run test`, `npm run check:preload` when preload changes, `npm run typecheck`, `npm run build`, and `npm run smoke:bitmap` when the slice touches renderer interaction, Electron, layers, drawing, Save, Import, or TIFF paths.

Reason: The highest-conflict files are still shared coordination points. Slice-owned worktrees reduce merge conflicts and keep architectural cleanup from accidentally crossing protected product/data boundaries, but further refactoring should be driven by real risk rather than line count.

## Multi-Select Reordering Has Explicit Placement

Shot 成组拖拽排序需要显式表达 `before` / `after` 目标位置。

Reason: 用户会把多选组拖到前方或后方的 storyboard，只有“插入到目标前”无法匹配真实排序意图。

## Animation Mode Is View-Driven

当 Zoom 拉到最大值时进入动画模式，并显示底部时间线。Storyboard grid 和 Japanese storyboard sheet 共用同一个最大 Zoom 动画模式；低于最大 Zoom 时回到进入动画前的 board view mode。

Reason: 最大 Zoom 是用户明确进入线性阅读/播放状态的意图边界，避免在接近阈值时因为窗口尺寸、滚动位置或缩放拖动造成动画模式反复抖动。

## Board Zoom Preserves The Active Picture Anchor

普通 storyboard grid 与 Japanese storyboard sheet 缩放前会暂存目标 shot、Picture 内归一化锚点和屏幕坐标；布局更新后通过 scroll 补偿恢复同一屏幕焦点。Z + wheel / pen-mouse horizontal drag 在指针位于任一 selected Picture 内时使用指针细节点，否则使用 primary selected Picture 中心；目标不可见时回退到指针下方或视口中心附近的可见 Picture。补偿只使用 `.workspace-board-scroll` 的原生横纵滚动；到达滚动边界时把锚点收敛到滚动视口内缩 16px 的安全区域，不再平移整个 board。

Reason: 缩放会改变卡片宽度、网格列数和日式分镜行高；只更新 Zoom 会让正在绘制的 shot 跳到另一行甚至离开视口。强行用 CSS translate 吸收滚动边界剩余量会把第一列或末列推到工具栏/侧栏下方，因此可见安全区优先于边界处的绝对像素锁定。锚点是瞬时导航状态，不进入项目、preload、Save、TIFF 或 `.storyboard-workbench` 数据。

## Animation Mode Uses A Stable Dark Frame

动画模式主画面只渲染当前 storyboard，并把当前 storyboard 的真实画幅按比例居中放入深色 frame。frame 跟随当前 shot 的真实比例和可用空间适配，图片本身不拉伸；timeline 仍显示全部 shot 缩略图用于跳转。

Reason: 线性播放时用户注意力应集中在当前画面；不挂载非当前 storyboard 可以避免其他卡片的 header、z-index 或滚动几何干扰 timeline。混合 16:9、1.85:1、9:16、2.39:1、1.43:1 时，按真实比例适配可以避免画面变形和裁切。

## Storyboard Display Uses Real Canvas Aspect Ratio

Storyboard 显示容器按每张 shot 的 `swb.canvasWidth/canvasHeight` 设置比例，不再使用固定比例容器。

Reason: 混合画幅项目中，16:9、1.85:1、2.39:1、1.43:1 都不应出现额外黑边或裁切；绘制坐标也必须和真实画布尺寸一致。

## Onion Skin Is Preview Only

动画模式的 Onion Skin 只在 renderer 中叠加前后帧作为绘制辅助，不写入 JSON、TIFF 或 Save 结果。

Reason: 洋葱皮是临时参考，不属于用户作品内容。

## Current Drawing Layers Are Bitmap-Based

当前普通 SWB 图层和 `Image` 层都使用 bitmap layer。JSON 保存 `shots[].layers` 元数据，像素源文件保存在 `.storyboard-workbench/layers/{shotId}/{layerId}.png`。Save 时由 Electron/sharp 合成可见 bitmap layers 并写入工作 TIFF。

Reason: Storyboard Flow 更接近像素绘制工具而非矢量绘图工具；统一 bitmap layer 能减少 Image 层和普通图层的行为差异。

Undo / redo for bitmap drawing stores command-level JSON snapshots plus the affected layer PNG data URLs. The history remains capped to avoid unbounded memory growth.

Reason: bitmap layer pixels are no longer recoverable from JSON alone, so undo must restore both metadata and internal layer assets.

## Image Layer Behaves Like A Normal Layer In UI

`Image` 层可选中、绘制、擦除、显隐、重排；如果当前 shot 还有其他图层，选中 Image 时 `Delete current layer` 会删除 Image layer metadata 和内部 `layer-image.png`。如果只剩一个 Image layer，删除按钮禁用。删除 Image layer 不会立刻移动或删除真实原图；真实文件仍只在 Save/import 边界处理。

Reason: 原文件已有 Archive 和 Save 边界保护，用户在绘图时应获得所见即所得的普通图层体验。

## Bitmap Selection Is A Transient Active-Layer Tool

Select 工具的 lasso / rectangle 选区只作用于当前 active bitmap layer。选区状态不写入 `storyboard.project.json`；移动、角点缩放或通过顶部手柄围绕选区中心旋转后，只把像素结果写回当前 layer PNG，并通过 bitmap layer snapshot 进入 undo/redo。旋转拖动期间由 Renderer canvas 实时预览；松手提交后继续保留变换后的临时选区。

Reason: V1 提供接近 Photoshop 的基础选区移动/缩放/旋转体验，同时避免跨图层、保存选区、羽化、魔棒、自由变形等复杂状态污染内部项目格式。

Selection transform hit testing converts a visible screen-space handle target into canvas coordinates.

Reason: storyboard images can be much larger than their displayed size. A fixed canvas-space radius makes corner scale handles effectively unclickable on high-resolution images.

## Gaussian Blur Is An Undoable Bitmap-Layer Edit

Blur 工具对当前 visible/unlocked bitmap layer 应用 `1–50px` Gaussian blur。Select 套索点按 shot + active layer 暂存在 Renderer；从 Select 切到 Blur 时保留选区，Apply 先生成整层模糊副本，再通过套索 clip 蒙版清除选区内原像素并写入模糊像素。不能用普通 `source-over` 直接叠加，否则透明 paint layer 的清晰笔迹会保留在模糊光晕下方。无有效选区时才模糊整层。半径和选区都只属于 Renderer 临时状态；Apply 后像素写回现有 layer PNG，并通过 bitmap layer snapshot 进入 undo/redo，不新增 project、preload、TIFF 或 `.storyboard-workbench` metadata 字段。

Reason: 模糊是像素编辑而不是项目结构。保持参数与选区为临时工具状态，可以复用现有 bitmap 历史与 Save 边界，避免为了一个破坏性滤镜扩展磁盘格式；按 active layer 关联选区也避免切层后把旧蒙版误用到另一层。

## Storyboard Matte Mode Is Explicit

顶部遮幅菜单只提供 `expanded` 和 `embedded` 两种显式模式，不做像素自动识别，并把一次选择作为场景级事务应用到当前 active storyboard 列表。`expanded` 把每张 storyboard 的既有 bitmap 内容层画布上下各增加 `75px`，原内容整体下移 `75px`，新增区域保持透明；`embedded` 保持既有画布和内容层尺寸。两种模式都会为每张图创建独立的透明 `Matte Overlay` PNG：中间透明、上下各 `75px` 为不透明黑色，layer 固定锁定在普通内容层上方。选择结果仍分别保存在 `shot.presentation.matte`，并随 SWB TIFF XMP 快照写入。

台词按钮只在整场 matte 已配置时启用，并作为场景级开关。开启时，它为每个 active storyboard 创建锁定的 `Dialogue Overlay` bitmap layer，把该 shot 按顺序排列的非空 Dialogue 合并成单行白字放在底部遮幅左侧；没有台词的 shot 仍创建透明 overlay，使开关状态保持一致。再次点击会移除整场 Dialogue Overlay。系统图层顺序固定为普通内容层、`Matte Overlay`、`Dialogue Overlay`，因此画笔内容会被遮幅盖住，而台词仍显示在黑边上。整场遮幅或台词切换各自作为一个 bitmap snapshot Undo/Redo 事务；真实工作 TIFF 像素仍只在 Save 时写入。

遮幅按钮在关闭状态打开模式菜单，在开启状态直接关闭整场。关闭 `expanded` 会按保存的 `sourceHeight` 裁掉内容层上下 padding 并移除 Matte/Dialogue system layers；关闭 `embedded` 只移除 system layers，不尝试删除原图自带的黑色像素。关闭操作是单个 bitmap snapshot Undo/Redo 事务，任一裁切或删除失败时恢复全部资产。Add Shot、显式 Import 完成及 Pending restore 会继承 active storyboard 列表当前的统一 matte mode 和 scene dialogue overlay 开关；若 active scene 已关闭，从 Pending 恢复的旧 matte shot 会同步关闭。Pending 和 pending-deleted 项本身不被场景按钮直接改写。

场景遮幅/台词资产事务、bitmap 写入、autosave 和最终 Save 共用 renderer 侧的串行资产边界。事务等待期间若项目对象已经被其他编辑替换，操作必须放弃提交并恢复已修改的 PNG，不能用旧 snapshot 覆盖新项目；Add Shot 则把已生成的 shot 重新合并到最新项目后再继承场景显示状态。若原操作失败后连资产回滚也失败，workspace 进入 recovery-required 状态并阻止 autosave、Save 和后续场景显示事务，直到用户明确重新打开 workspace。

Reason: 一个文件夹代表一个场景，因此遮幅选择应统一作用于整场，而不是让 shot 逐张进入不一致状态。软件新增遮幅和导入图片自带遮幅具有不同画布语义，不能自动猜测；显式模式避免重复扩展。独立锁定的 Matte Overlay 保证浅色绘画不会覆盖黑边，同时真实 resize 仍只发生在内部 bitmap layer assets 上，使 Renderer 和现有 TIFF Save 继续使用统一画布尺寸。

## Keyboard Shortcuts Are Fixed For Now

快捷键由 SWB 当前版本固定指定，工具栏齿轮只显示可用快捷键清单，不提供录制、清空或保存自定义快捷键的入口。Renderer 直接使用 `defaultKeyboardShortcuts`；Electron 不再暴露 `settings:getKeyboardShortcuts` / `settings:setKeyboardShortcuts`，也不读写 `keyboard-shortcuts.json`。

Reason: 发布前先保持快捷键行为一致，避免部分动作开放自定义、部分动作必须固定造成混乱。发布后根据用户反馈再决定哪些快捷键可以配置，哪些必须保持固定。

## Layer Drawer Opens By Click, Not Pointer Drag

当前 per-shot 图层抽屉通过右侧小把手点击打开/关闭。实验性的按住拖动推入/拉出交互已移除；图层本身的行拖动排序和横向 opacity 拖动保留。

Reason: 抽屉拖动需要更明确的遮挡和动画模型，否则容易出现窗口浮在画面上或被裁切的错觉。生产工具优先保持干净、稳定、可预期的点击交互。

## Photoshop Interop Stays Separate From Internal Working Data

SWB 内部工作格式继续使用 `.storyboard-workbench/layers/*.png` 加 `storyboard.project.json`。Photoshop layered TIFF 是 Save/Export 的交换写入格式，不替代内部 autosave 数据模型。当前 `Save` 会把多 bitmap layer shot 写回当前场景文件夹中的 Photoshop-readable layered TIFF；单层 shot 仍保存为普通单层 TIFF。主界面隐藏 `Export TIFF`，但底层 export API 仍可另存一份 Photoshop-readable layered TIFF 到 `Photoshop TIFF Export/YYYYMMDDTHHMMSS/`，用于 smoke 和开发调试；现有 `Import` 会把 Photoshop layered TIFF 的 raster layers 吸收到 SWB-owned bitmap layer assets，并归档源 TIFF。

Reason: Photoshop PSD/TIFF 图层格式适合作为交换格式，但不适合作为 V1 的内部事务日志。PNG layer assets + JSON 更容易做 autosave、undo/redo、迁移和安全恢复。

## Save And Export Share Bitmap Layer Ordering

Electron Save and Photoshop TIFF export must use the same bitmap layer filtering, sorting, and defaulting helper.

Reason: Save and export both serialize SWB bitmap layers into external TIFF outputs. Keeping layer eligibility and order in one helper reduces drift without changing the Save boundary or treating Photoshop TIFF as the internal working format.

## Storyboard Script Markdown Is A Mirror

Each shot may store `scriptText` in project JSON. The root `storyboard-script.md` file is a human-editable ordered-list mirror of shot order and script text, not the primary project state. App edits autosave JSON and rewrite the Markdown mirror; external Markdown edits are absorbed only when the user clicks `Import`.

Reason: JSON remains the transactional app source of truth, while the Markdown file gives users a simple text workflow in tools like Obsidian or Typora. Explicit Import prevents silent external text changes from reordering or creating shots without user intent.

## Markdown Storyboard Bootstrap Creates A New Project Only

拖入或选择 numbered-list Markdown script 可以在空目标文件夹里创建一个新的 SWB project。每个 ordered-list item 生成一个 blank shot，item 正文写入该 shot 的 `scriptText`。

Reason: 这是从文字分镜到 storyboard 结构的最小可用桥梁。它避免追加、覆盖、合并等高风险选择，也为未来 AI 只输出同类 Markdown 留出清晰边界。

## Parked Shots Are Project State, Not Save Output

`project.parkedShots` 保存右侧待定区的完整 shot 数据。Parked shots 保留 image/layer assets 并写入 JSON，但不参与 root TIFF Save 输出、文件名同步、Timeline 或 `storyboard-script.md`，直到它们被恢复回 `project.shots`。

Reason: 待定区是创作过程中的临时搁置区，应保留内容但不改变主工作区顺序和交付文件夹输出。

## Option / Alt Drag Copy Is Retired

Option/Alt drag 不再复制 storyboard、layer 或 dialogue item。按住 Option/Alt 拖动时仍走普通移动/排序逻辑。

Reason: copy-on-drag 的 storyboard 占位动画与源卡保留语义成本过高。复制入口改为后续 Command/Ctrl+C 和 Command/Ctrl+V，保持拖拽交互单一。

## Keyboard Copy / Paste

`Cmd+C` / `Ctrl+C` 和 `Cmd+V` / `Ctrl+V` 是复制入口。选中 storyboard 时，粘贴会复制该 storyboard 并插到当前 storyboard 后方。选中 layer 时，粘贴会复制该 layer 并插到当前 layer 下方。

Reason: 复制应是明确的离散命令，而不是拖拽过程中的隐藏模式。键盘复制粘贴复用现有资源复制 helper，并保持 Save 仍是最终 TIFF/文件名同步边界。

## Delete Targets The Last Selected Object Type

Delete/Backspace 作用于 renderer 中最后被选中的对象类型：点击图层行后删除当前 active unlocked layer；点击 storyboard card 后删除当前选中的 storyboard group。

Reason: 用户会期待 Delete 删除“刚刚选中的东西”。该状态只存在 renderer，不把瞬时 UI focus 写入项目 JSON。

## Merge Button Is Contextual

图层抽屉的 `Merge` 按钮和 `Cmd/Ctrl+E` 使用同一个动作。单选图层时执行 active layer 向下合并；多选两层及以上时，把选中的 visible/unlocked layers 合并到选中组最下面的图层。Merge visible 可以把 locked visible layers 烘焙进新 merged layer，但保留这些 locked source layers 并自动隐藏。

Reason: 同一个命令应匹配当前图层选择状态，而不是让用户记两套合并入口。保留 locked source layers 可以让 Merge visible 有用，同时不删除受保护内容。

## Import Also Handles External Root Images

When the app window regains focus, Electron may scan the current root folder for newly added supported image files. It only builds image records for paths that are not already in `project.shots` and not pending deletion. Newly detected images become `non-swb` shots and require explicit `Import`.

Reason: Finder/Bridge-style workflows need the app to notice externally added images, but focus checks must stay cheap and must not resurrect shots that the user deleted before Save.

## Deleted Storyboards Go To System Trash On Save

Pressing Delete/Backspace removes selected shots from the app state and records their root image paths in `pendingDeletedShots`. The files are moved to the system Trash during `Save` with Electron `shell.trashItem()`. They are not moved to `Archive`; `Archive` remains reserved for original files preserved by Import. Internal layer assets for deleted shots are intentionally left alone for now.

Reason: Users expect manual storyboard deletion to behave like Finder/Bridge deletion, where the system Trash is recoverable. Mixing intentional deletes into `Archive` would pollute the Import backup area.

## AI Draft Is Candidate-First And Additive

AI image generation is an internal feature module, not a full external plugin system. Generation creates candidates first; Apply adds a visible top bitmap layer named `AI Draft`. It does not replace base art, does not synchronize real file names, and does not write final working TIFF pixels. `Save` remains the only final TIFF write boundary.

Reason: AI output should be reviewable and reversible like an extra draft layer. Keeping it out of Save / Import / TIFF naming rules reduces the risk that generation experiments corrupt delivery files.

## AI Provider Settings Are Local GUI Settings

OpenAI and Seedream credentials are configured through the app GUI and stored as local app-level credentials/settings. They are not read from user-facing environment variable fallbacks and are not written into `storyboard.project.json`, `.storyboard-workbench/`, AI resource metadata, or candidate metadata. ComfyUI stores local server/workflow settings at app level and does not store secrets in the project.

Reason: The target users are artists who expect GUI setup. Keeping credentials out of project data makes shared project folders safer.

## AI Resources Are A Project Reference Library

`AI Resources/` is a visible project folder for reference images. Each resource can have sidecar role/note metadata. Resources are available to every shot by default. `project.ai.shotResourceExclusions` records only per-shot resources the user has manually disallowed.

Reason: Most references are reusable across a scene, so default-on is simpler. Recording only exclusions keeps the project metadata small while preserving user intent when a specific shot should not use a reference.

## AI Panel Uses Controller And Client Boundaries

`AiDraftPanel.tsx` is the AI side panel composition and presentation surface. Provider settings, resource management, single-candidate flow, batch-candidate flow, and the renderer-safe AI API adapter live in focused renderer modules: `useAiDraftController.ts`, `useAiResourcesController.ts`, `useAiCandidateController.ts`, `useAiBatchGenerationController.ts`, and `aiClient.ts`.

Reason: AI work now has enough internal separation for provider, resource, candidate, and UI work to happen in separate slices. Further splitting should follow real pain points, not line count alone. The panel may keep small UI dispatch helpers such as single-vs-batch button routing, while direct `window.storyboard.ai` calls should stay behind `aiClient.ts`.

## Batch AI Generation Uses Fixed Contact-Sheet Templates

Batch AI generation groups selected shots in current storyboard order. The renderer offers non-persistent batch size `1 / 4 / 16`, defaulting to `4`. Each group makes one provider call, produces a contact sheet, and crops output back into per-shot candidates. Remainder groups use adaptive layouts from 1-up through 4x4.

Reason: Batch generation should stay predictable and testable while giving users control over provider-call granularity. Fixed/adaptive templates avoid brittle computer-vision panel detection and keep provider differences isolated behind the existing candidate flow.

## ComfyUI Provider Uses User-Run Local API Workflows

The ComfyUI provider only connects to a user-run local ComfyUI server. It accepts API-format workflow JSON exported from ComfyUI, validates required placeholders, uploads input images, queues `/prompt`, waits on `/ws`, reads `/history`, downloads `/view`, and returns an image buffer to the same candidate pipeline as other providers. It does not install, start, update, or manage ComfyUI or models.

Reason: Local generation can reduce API cost, but managing a full ComfyUI installation is a separate product surface. The MVP should only bridge to workflows users have already made work inside ComfyUI.

## Layered TIFF Save Writes Once

多图层 TIFF 的 Save 只写一次最终 Photoshop-readable TIFF。Electron 把 SWB metadata 传给 Python writer；Python writer 在生成最终 composite 后计算 `baseFingerprint`，再把 SWB XMP 和 Photoshop layer records 一起写入最终 TIFF。

Reason: 之前的两遍写入是为了先得到最终 TIFF fingerprint，再第二次写入 XMP。把 fingerprint 计算放进最终 writer 后，可以保留 SWB metadata 和 Photoshop layers，同时少做一次大 TIFF 写入。

## Photoshop TIFF Python Dependencies Resolve From Stable Locations

Photoshop TIFF import/export Python deps 的解析顺序是 `SWB_PYTHON_DEPS_DIR`、packaged resources `python-deps/photoshop-tiff`、local dev vendor `vendor/python/photoshop-tiff`，最后才 fallback 到旧 spike 目录 `/private/tmp/psdtags-spike-deps`。

Reason: 临时 spike 目录不适合作为长期默认依赖来源。保留 fallback 保护现有开发环境，同时让开发目录和未来打包资源目录成为稳定路径。

## Locked Bitmap Layers Protect Content But Not Visibility

Locked bitmap layer 仍可被选中，也可显示/隐藏；但不能绘制、擦除、Blur、Select transform、Clear、Delete、重命名、调整 opacity / blend mode 或排序。

Reason: 锁定的核心目的是避免误改像素和图层属性。显示/隐藏属于查看状态，允许切换可以保持接近 Photoshop 的图层管理体验。

## Legacy Strokes Are Migration Input

旧项目中的 `sketchLayers`、`imageLayerEdits`、`baseVisible` 和 `activeLayerTarget` 只作为一次性迁移输入。打开旧项目后，Electron 会把旧 stroke 数据 rasterize 到内部 PNG layer assets，renderer 主流程不再依赖这些字段。

Reason: 迁移必须保护旧项目可见结果，同时避免新代码继续扩展两套绘图主数据。

## Storyboard Script Same-Length Imports Are Positional

当 `storyboard-script.md` 的条目数和当前 shot 数相同，Import 按列表位置更新现有 shot 的 `scriptText`，不根据文字内容匹配并创建新 shot。只有 Markdown 条目多于当前 shot 数时，额外条目才会创建新的 blank shot。

Reason: `storyboard-script.md` 是用户可编辑的文字镜像。用户修改某个编号下的文字时，预期是更新对应 shot 的脚本文字，而不是因为文字变成新内容就生成新的 storyboard。

Non-goal: bitmap layer 重构不代表完整 Photoshop 图层 round-trip。Photoshop layered TIFF import/export 已经产品化为 raster layer 交换路径；PSD-first 和复杂 Photoshop 图层完整保真仍是待验证方向。

## Current Scope Avoids Heavy Non-Core Features

当前 scope 刻意不包含 PDF/image-sequence export、SQLite、云同步、PSD-first 工作流和复杂绘图工具。AI Draft 已进入 MVP，但仍必须保持 candidate-first、local-first、Save 边界不变。

Reason: 产品目标是一个可用的最小分镜排列工具，后续可扩展。
