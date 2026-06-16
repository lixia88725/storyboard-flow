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

`Add Shot` 在当前场景文件夹创建白色 TIFF，支持 `16:9`、`2.39:1`、`1.43:1 IMAX` 预设。

Reason: 用户想在当前工作区内创建新分镜图，而非导入外部图片。

## Project Logic Belongs In Shared Pure Functions

排序、对白移动、草图更新、重命名规划等逻辑位于 `src/shared/projectOps.ts`。

Reason: 这些行为在 React UI 状态之外更易测试、更安全演进。

## Renderer Components Have Explicit Ownership Boundaries

`App.tsx` owns top-level project state, Save/Import/autosave wiring, global selection, shortcuts, menus, and history. `ShotCard.tsx` owns per-card presentation, dialogue cards, script back faces, lazy media placeholders, and card-local composition of `SketchPad` and `LayerPanel`. `SketchPad.tsx` owns bitmap stage behavior. `LayerPanel.tsx` owns the per-shot layer drawer.

Reason: The renderer was becoming too large for smooth collaboration. Keeping Save/Import/history in `App.tsx` while moving card, canvas, and layer drawer presentation into focused components reduces merge conflicts and lowers the risk of UI work accidentally touching filesystem boundaries.

## Parallel Work Uses Slice-Owned Worktrees

Future architecture work should split into slice-owned git worktrees instead of multiple people or agents editing the same aggregation files at the same time:

- App orchestration hooks: `src/renderer/App.tsx` and focused renderer hook files.
- Electron main services: `electron/main/main.ts`, `electron/main/ipc/`, and small main-side services.
- Preload contract: `electron/preload/`, `src/renderer/global.d.ts`, and `scripts/check-preload-sync.mjs`.
- CSS theme cleanup: `src/renderer/styles.css` and `src/renderer/styles/`.
- AI controller/client: `src/renderer/ai/`, `electron/main/ai*.ts`, and AI provider modules.

Each worktree should own one slice and avoid opportunistic edits outside that slice. Changes to Save / Import / TIFF / `.storyboard-workbench` behavior require a separate explicit plan and should not be bundled with renderer UI, CSS, or AI controller cleanup.

2026-06-15 worktree simulation:

- Created two local worktrees from the same `main` baseline: `sim/renderer-controller-slice` and `sim/css-slice`.
- Renderer controller work can stay limited to `src/renderer/App.tsx` plus focused controller/test files such as `src/renderer/rightSidebarController.ts`.
- CSS work can stay limited to `src/renderer/styles.css` and `src/renderer/styles/*`, with `src/renderer/styles.css` kept as the import-order manifest.
- The main remaining cross-slice seam is shell class naming: renderer controller slices may add class names such as `has-ai-panel-open`, while CSS slices style those classes. Add or rename shell classes deliberately and document them in the owning controller test before a CSS slice consumes them.
- Do not let a CSS slice make opportunistic TypeScript behavior edits, and do not let a renderer controller slice clean up theme overrides.

2026-06-15 Electron main service follow-through:

- Folder open / refresh read-side logic now has focused service boundaries: `folderScanService.ts`, `imageRecordsService.ts`, `knownImageChangesService.ts`, and `projectMetadataService.ts`.
- Blank shot TIFF creation is isolated in `blankShotService.ts`; `main.ts` should call it through the image IPC composition path instead of re-owning preset size and unique filename logic.
- User data glue is isolated in `userDataRuntime.ts`; settings and AI credential/settings stores should be composed there instead of adding more `app.getPath("userData")` wrappers to `main.ts`.
- Future Electron main service work should prefer read-side or settings/recent/AI glue slices. Do not move `saveWorkspace`, `importProjectToSwbFormat`, `writeSwbMetadataToTiffs`, or Photoshop TIFF writer orchestration without a dedicated Save/Import/TIFF migration plan.
- `main.ts` should remain the composition layer for protected Save/Import/TIFF flows and IPC registration, not a dumping ground for new isolated filesystem helpers.

2026-06-15 renderer autosave follow-through:

- Autosave persistence side effects now live in `workspaceAutosaveController.ts` as `persistWorkspaceProject`; `App.tsx` should keep only the thin adapter that supplies current paths, refs, and setters.
- Future autosave or workspace persistence cleanup should extend the controller and its focused tests before adding more save-state side effects directly to `App.tsx`.
- Keep explicit Save button behavior and Save-time TIFF/filename synchronization out of autosave controller work. Autosave may write metadata only; `Save` remains the only real filename sync and working TIFF write boundary.

2026-06-15 incremental worktree result:

- `sim/user-data-runtime` and `sim/persist-workspace-action` were created as independent worktrees from consecutive clean `main` baselines.
- The Electron slice touched only `electron/main/main.ts`, `electron/main/userDataRuntime.ts`, and `electron/main/userDataRuntime.test.ts`.
- The renderer slice touched only `src/renderer/App.tsx`, `src/renderer/workspaceAutosaveController.ts`, and `src/renderer/workspaceAutosaveController.test.ts`.
- Both slices cherry-picked back to `main` without conflicts because they did not share ownership files. This supports the rule that Electron glue extraction and renderer orchestration extraction can run in parallel when each slice stays inside its file boundary.
- The remaining risk is not merge conflict in these two slices; it is semantic drift around Save/Import/TIFF boundaries. Any slice touching `autosaveWorkspace`, external refresh, `importSwbFormat`, or Save status must state whether it is metadata-only or Save-boundary work before implementation.

2026-06-15 current worktree simulation:

- Created two current local worktrees from the same CSS baseline `dce395b`: `sim/current-renderer-radial` and `sim/current-electron-blank-shot`.
- Renderer menu orchestration slice changed only `src/renderer/App.tsx` and `src/renderer/radialToolMenuController.ts`.
- Electron low-risk service slice changed only `electron/main/main.ts`, `electron/main/blankShotService.ts`, and `electron/main/blankShotService.test.ts`.
- `git merge-tree --write-tree sim/current-renderer-radial sim/current-electron-blank-shot` completed with exit code 0, confirming these slices can merge without file conflicts.
- Rule adjustment: renderer menu/controller cleanup and Electron service extraction can proceed in separate worktrees when each slice avoids opportunistic edits outside its ownership area.

2026-06-16 slice follow-through:

- CSS cleanup ran as a sequence of CSS-only worktrees that absorbed Production Slate override files into their owning modules: pending shelf, board overlays, timeline/status, toolbar, shot card, and layer panel. Each slice avoided TypeScript and behavior edits, which kept visual cleanup separate from renderer/controller work.
- Renderer zoom orchestration ran in `sim/app-zoom-controller` and changed only `src/renderer/App.tsx`, `src/renderer/storyboardZoomController.ts`, and `src/renderer/storyboardZoomController.test.ts`.
- `App.tsx` dropped from 3004 to 2781 lines after moving zoom slider RAF scheduling, live preview CSS variables, board scroll helpers, and wheel zoom wiring into `useStoryboardZoomController`.
- Paste/reorder FLIP animation queueing now lives in `pasteAnimationController.ts`; `App.tsx` asks for a queued shot/layer animation instead of repeating clear/measure/ref assignment blocks around paste and reorder actions.
- The zoom slice cherry-picked cleanly after the CSS slices because it did not touch `src/renderer/styles/` and the CSS slices did not touch renderer behavior files.
- Rule adjustment: CSS theme cleanup can continue independently from renderer hook extraction as long as CSS slices treat `styles.css` as the import-order manifest and renderer slices treat shell/board class names as API-like names.
- Remaining renderer risk is now concentrated in DND/marquee, Save/Import wiring, history, and layer action orchestration. Prefer one controller at a time, with focused tests, before considering any broader `App.tsx` movement.

2026-06-16 current architecture follow-through:

- Electron AI app runtime moved into `electron/main/ai/appRuntime.ts`; `main.ts` now registers AI IPC through `createAiAppHandlers` instead of directly composing provider/settings/resource/candidate dependencies.
- External refresh app runtime moved into `electron/main/workspaceExternalChangesAppRuntime.ts`; `main.ts` now supplies only the app-specific image-record and storyboard-script helpers while the external-change service composition lives in a focused module.
- AI project apply side effects moved into `src/renderer/ai/aiProjectChangeController.ts`; `App.tsx` no longer owns the layer-change dirty-shot detection for AI candidate/resource apply flows.
- These slices were implemented in separate worktrees: `sim/electron-ai-app-runtime`, `sim/workspace-external-changes-runtime`, and `sim/ai-project-change-controller`, then cherry-picked back to `main` without conflicts.
- Rule adjustment: AI provider/main glue, Electron external-refresh glue, and renderer AI project-change glue can proceed in independent worktrees as long as provider behavior, candidate-first Apply, and Save/Import/TIFF boundaries are not changed.
- Current high-conflict files are smaller but still not “done”: `main.ts` remains the protected Save/Import/TIFF composition layer, and `App.tsx` still owns DND/marquee/history/layer-action orchestration. Future slices should keep using focused tests and avoid splitting code solely for line-count wins.

2026-06-16 Electron IPC runtime follow-through:

- `sim/image-app-runtime` moved `images:createBlankShot` app wiring into `electron/main/imageAppRuntime.ts`; `main.ts` now only registers the image IPC handler with `createImageRecords` injected from the protected app composition layer.
- `sim/settings-app-runtime` moved tool radial settings IPC wiring into `electron/main/settingsAppRuntime.ts`; user-data read/write behavior remains in `userDataRuntime.ts` and `userSettingsService.ts`.
- Workspace open/watch/script IPC wiring now lives in focused runtime modules: `workspaceOpenAppRuntime.ts`, `workspaceWatchAppRuntime.ts`, and `workspaceScriptAppRuntime.ts`.
- Workspace autosave/ensure-layer-assets IPC wiring now lives in `workspacePersistenceAppRuntime.ts`; `main.ts` still owns the underlying `ensureProjectLayerAssets` and `writeProjectFiles` helpers because Save/Import/TIFF paths also call them directly.
- Workspace copy-shot-assets IPC wiring now lives in `workspaceAssetAppRuntime.ts`; `main.ts` only injects the existing `uniquePath` helper because protected Save/Import paths still use it directly.
- Layer asset IPC wiring now lives in `layerAppRuntime.ts`; `main.ts` keeps only the layer helpers that protected Save/TIFF composition still calls directly.
- These slices had focused tests and cherry-picked back to `main` or landed as narrow follow-through changes without conflicts because they touched distinct runtime modules plus small adjacent lines in `main.ts`.
- Rule adjustment: Electron IPC runtime slices should keep `main.ts` as a thin registration/composition file and move only low-risk glue into domain runtime modules. If a slice needs `saveWorkspace`, `importProjectToSwbFormat`, Photoshop TIFF export/import, or `.storyboard-workbench` format changes, it is not a low-risk IPC runtime slice and needs a separate plan.
- Remaining Electron conflict risk is now concentrated in the protected Save/Import/TIFF orchestration and shared helper functions below those handlers. Continue extracting small read-side or settings-style composition only when the new module has a real domain owner and a focused test.

Reason: The highest-conflict files are still shared coordination points. Slice-owned worktrees reduce merge conflicts and keep architectural cleanup from accidentally crossing protected product/data boundaries.

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

Reason: Storyboard Flow 更接近像素绘制工具而非矢量绘图工具；统一 bitmap layer 能减少 Image 层和普通图层的行为差异。

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

Batch AI generation groups selected shots in current storyboard order. Full groups use a 4-up 2x2 contact sheet; the final remainder uses 1-up, 2-up horizontal, or 3-up horizontal templates. Provider output is cropped back by fixed ratios into per-shot candidates.

Reason: The first batch version should be predictable and testable. Fixed templates avoid brittle computer-vision panel detection and keep provider differences isolated behind the existing candidate flow.

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

Locked bitmap layer 仍可被选中，也可显示/隐藏；但不能绘制、擦除、Select transform、Clear、Delete、重命名、调整 opacity / blend mode 或排序。

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
