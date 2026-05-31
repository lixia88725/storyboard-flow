# Storyboard Workbench MVP

Storyboard Workbench 是一个本地优先的故事板工作台。V1 聚焦：打开一个本地图像文件夹、排序 storyboard、移动台词、绘制修改、管理轻量图层，并在需要时把软件内顺序和画面同步回真实 TIFF。

## Scripts

```bash
npm install
npm run test
npm run typecheck
npm run build
npm run smoke:bitmap
npm run check:preload
npm run dev
```

## Developer Map

如果是接手开发，先读 `AGENTS.md`、`decisions.md`、`context-handoff.md` 和 `todo.md`。常用入口：

- `src/shared/projectOps.ts`：项目数据、排序、重命名计划、bitmap layer metadata 等纯逻辑。改项目行为时优先在这里补单测。
- `electron/main/main.ts`：Electron IPC、文件扫描、Import、Save 编排、TIFF metadata 和 bitmap asset 初始化。
- `electron/main/bitmapLayerOrdering.ts`：Electron Save / Photoshop export 共用的 bitmap layer 排序和默认值规则。
- `electron/main/storyboardScript.ts`：`storyboard-script.md` 的序列化、解析和 Import 计划 helper。
- `electron/main/photoshopTiffExport.ts` / `electron/main/photoshopTiffImport.ts`：Photoshop layered TIFF 交换路径。
- `electron/preload/preload.ts` 和 `electron/preload/preload.cjs`：renderer-safe API。改其中一个后跑 `npm run check:preload`。
- `src/renderer/App.tsx`：主 UI 状态、工具栏、Save/Import/autosave wiring、全局选择状态和项目历史。它仍是协作热点，优先做小步改动。
- `src/renderer/ShotCard.tsx`：每张 storyboard card 的展示、台词卡、script 背面、懒渲染占位，以及卡片内组合 `SketchPad` / `LayerPanel`。
- `src/renderer/SketchPad.tsx`：bitmap drawing、eraser live preview、bitmap Select transform、Onion Skin overlay 和 Konva stage wiring。改这里先跑 renderer tests，再跑 build/smoke。
- `src/renderer/LayerPanel.tsx`：per-shot layer drawer UI、layer row gestures、visibility sweep、opacity/reorder controls。
- `src/renderer/sketchRendering.ts`、`sketchGeometry.ts`、`activeTargets.ts`、`keyboardShortcuts.ts`、`animationViewport.ts`：renderer helper，适合先补单测再接入 UI。
- `scripts/electron-bitmap-smoke.mjs`：端到端 Electron/CDP smoke，覆盖 Save safety、bitmap drawing、layer panel、Photoshop round trip、animation 和 legacy migration。

## Workflow

- 一个本地图像文件夹就是一场戏。
- 顶部地址栏输入或选择最近文件夹后，应用扫描 `.png`、`.jpg`、`.jpeg`、`.tif`、`.tiff`。
- 内部状态自动保存到当前文件夹的 `.storyboard-workbench/storyboard.project.json`。
- 分镜脚本文字同步到根目录 `storyboard-script.md`；软件内编辑会自动写入，外部修改需要点击 `Import` 导入。
- `Save` 是唯一会同步真实文件名和写工作 TIFF 像素的操作。
- 选中 storyboard 后按 Delete/Backspace 会先在软件内移除卡片；点击 `Save` 后对应根目录图片进入系统垃圾箱，不进入 `Archive`。

## Save

`Save` 会执行两件事：

- 按软件内 storyboard 顺序安全同步真实图片文件名。
- 把当前 SWB 图层状态写入工作 TIFF：单层 shot 保存为普通单层 TIFF；多 bitmap layer shot 保存为 Photoshop-readable layered TIFF，并保留 SWB XMP metadata。

当前命名规则：

```text
项目名_场号_stb_艺术家名_版本号_0010.ext
项目名_场号_stb_艺术家名_版本号_0020.ext
```

序号按 10 递增，方便后续手动插入中间号位。真实重命名前会先做 preflight，避免覆盖或临时文件冲突；如果两阶段重命名、SWB 导入移动或后续 metadata 写入中途失败，会尽力把已移动的文件恢复到原路径。

## Layers And Drawing

当前绘图系统以 bitmap layer 为主数据：

- 图层元数据保存在 `.storyboard-workbench/storyboard.project.json` 的 `shots[].layers`。
- 每个可编辑图层是一张 PNG 工作层：`.storyboard-workbench/layers/{shotId}/{layerId}.png`。
- 画笔、橡皮、清空和删除图层只写 `.storyboard-workbench/` 内部工作数据。
- Select 工具支持 V1 lasso / rectangle 选区，对当前 active bitmap layer 做移动和角点缩放；选区本身不写入项目文件，提交后的像素结果写回当前 layer PNG。
- Undo / redo 会恢复相关 layer PNG snapshot 和 JSON metadata。
- 新增图层进入 undo 时会记录新增 layer PNG 的空快照；如果 autosave 已创建内部 PNG，Undo 会删除该 orphan asset，Redo 会恢复它。
- Save 时由 Electron 写入工作 TIFF：单层内容走 sharp 单层 TIFF；多 bitmap layer shot 走 Photoshop-readable layered TIFF，包含图层顺序、名称、显隐、opacity 和 blend mode。

图层面板是每张 storyboard 右侧的 click-toggle 抽屉，支持新增、删除、重命名、显隐、lock、opacity、blend mode 和拖动排序。图层行纵向拖动用于排序，横向拖动用于调整 opacity；顶部独立 opacity slider 已移除。隐藏图层不会成为 active 绘制目标。锁定图层仍可选择和显隐，但不能绘制、擦除、选区变换、清空、删除、重命名、调整 opacity / blend mode 或排序。`Image` 层在 UI 中可像普通图层一样选中、绘制、擦除、重排；如果当前 shot 有多个图层，选中 `Image` 后点击 `Delete current layer` 会移除 Image layer 和内部 PNG asset。每个 shot 至少保留一个图层，所以只剩一个 `Image` 层时删除按钮会禁用。

工具栏顶部的齿轮按钮可配置本机快捷键，覆盖 Brush、Eraser、Select、Clear layer、Save、Add Shot、Onion Skin、左右切帧、Undo 和 Redo。快捷键设置写入 Electron `userData`，不是项目文件的一部分。`Escape` 默认用于 Clear layer；当菜单打开时，`Escape` 优先关闭菜单。

`npm run smoke:bitmap` 会启动本地 Electron，并通过 CDP 验证普通 PNG 文件夹打开后，Image layer 和普通 paint layer 的绘制、擦除、清空/删除、undo / redo、opacity、blend mode、拖动排序、图层缩略图、Select 移动/缩放、Add Shot、Save safety、Save 写入 Photoshop-readable layered TIFF、快捷键持久化、混合画幅动画模式、Onion Skin 和重开恢复；它也覆盖旧 stroke 项目的 bitmap migration、Photoshop layered TIFF export/import round trip，并检查内部 layer PNG 没有 metadata 未引用的 orphan asset。

## Photoshop Layered TIFF Export

`Save` 是正式写入入口：有多个 bitmap layer 的 shot 会直接写回当前场景文件夹中的 Photoshop-readable layered TIFF；只有单层内容的 shot 继续保存为普通单层 TIFF。主界面不再显示 `Export TIFF` 按钮，以降低用户心智负担；底层 export API 仍保留给 smoke 和开发调试使用，可另存 Photoshop-readable layered TIFF 到 `Photoshop TIFF Export/YYYYMMDDTHHMMSS/`。

现有 `Import` 操作也会检测 Photoshop layered TIFF，并把 raster Photoshop layers 转换成 SWB-owned bitmap layers。源 TIFF 会移动到 `Archive/YYYY-MM-DD-HHMMSS/`，SWB 继续使用 `.storyboard-workbench/layers/*.png` 和 `storyboard.project.json` 作为内部工作数据。

如果用户在 Finder/Bridge 中向当前根目录新增图片，应用窗口重新获得焦点后会把新增路径追加为待 Import 的 `non-swb` shot，并点亮 Import 旁的黄色感叹号。该检测只处理新增图片，不重新解码所有已知图片，也不会把 pending deleted 的图片重新加回项目。

当前 Photoshop TIFF import/export 路径依赖 Python `psdtags + tifffile + imagecodecs + numpy`。依赖目录解析顺序是：`SWB_PYTHON_DEPS_DIR`、打包资源目录 `python-deps/photoshop-tiff`、开发目录 `vendor/python/photoshop-tiff`，最后才 fallback 到旧 spike 目录 `/private/tmp/psdtags-spike-deps`。开发环境可运行 `npm run setup:photoshop-tiff-deps` 安装到 `vendor/python/photoshop-tiff`。打包前运行 `npm run prepare:package-resources` 会把已安装的 `vendor/python/photoshop-tiff` 复制到 `dist-resources/python-deps/photoshop-tiff`；后续 installer/electron packager 配置必须把 `dist-resources` 内容放进 packaged app 的 resources 根目录，这样运行时的 `process.resourcesPath/python-deps/photoshop-tiff` 才能命中。`npm run smoke:bitmap` 会导出一组 Photoshop TIFF，用 `psdtags` 读回 layer names，并把其中一个导出的 layered TIFF 作为外部文件重新 Import，验证导入后的 SWB shot 有匹配数量的 bitmap layers、layer PNG assets 和 `swb.sourceKind: "photoshop-layered-tiff"`。

## SWB Format

非 SWB 图片可导入为 SWB-owned TIFF。导入会把原文件移动到 `Archive/YYYY-MM-DD-HHMMSS/`，工作 TIFF 由 Storyboard Workbench 管理。

`.storyboard-workbench/storyboard.project.json` 是主数据；TIFF XMP metadata 只是便携快照。兼容的外部 TIFF 像素编辑可以被接受为新的 base；Photoshop layered TIFF 是 Save/Export 的 Photoshop 交换写入格式，但不是 autosave 的内部事务格式。

`docs/photoshop-layered-tiff-spike.md` 记录了最初的格式 spike：Python `psdtags + tifffile` 可以生成 Photoshop 2026 识别为多图层的 Photoshop-style layered TIFF；sharp/libvips 标准 multi-page TIFF 不能被 Photoshop 当作图层打开。

下一阶段讨论方向是 PSD-first Photoshop interoperability：先验证 PSD raster layer import/export，再决定是否作为显式 Photoshop 交换工作流产品化。当前 PSD 支持尚未实现。

## Storyboard And Animation Mode

- `Add Shot` 可创建白底 TIFF，支持 `16:9`、`2.39:1`、`1.43:1 IMAX`。
- 工具栏 `文 / 图` 可在图片面和文字面之间切换；文字面编辑每张 shot 的分镜脚本。
- 根目录 `storyboard-script.md` 用标准 Markdown ordered list 表示当前 shot 顺序；空 shot 仍保留空条目，外部 MD 修改通过 Import 吸收。
- Storyboard 按真实画布比例显示，混合画幅不会额外加黑边。
- Zoom 到单张 storyboard 填满工作区时进入动画模式，底部显示时间线。
- 动画模式支持左右键线性播放、时间线点击跳转，以及 Onion Skin 前后帧参考。
- 动画模式主画面只渲染当前 storyboard，并放入稳定 dark matte frame；不同画幅图片在 frame 内居中显示，不被拉伸。

旧的 stroke 项目打开后会一次性生成 bitmap layer metadata 和内部 PNG layer assets。旧字段只作为迁移输入保留，主绘图流程不再依赖 `sketchLayers` / `imageLayerEdits`。

## MVP Non-Goals

- AI prompt fields or AI export.
- PDF or image sequence export.
- SQLite migration.
- Cloud sync or collaboration.
- Photoshop layer round-trip as a production feature.
