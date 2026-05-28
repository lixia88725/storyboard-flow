# Storyboard Workbench MVP

Storyboard Workbench 是一个本地优先的故事板工作台。V1 聚焦：打开一个本地图像文件夹、排序 storyboard、移动台词、绘制修改、管理轻量图层，并在需要时把软件内顺序和画面同步回真实 TIFF。

## Scripts

```bash
npm install
npm run test
npm run typecheck
npm run build
npm run smoke:bitmap
npm run dev
```

## Workflow

- 一个本地图像文件夹就是一场戏。
- 顶部地址栏输入或选择最近文件夹后，应用扫描 `.png`、`.jpg`、`.jpeg`、`.tif`、`.tiff`。
- 内部状态自动保存到当前文件夹的 `.storyboard-workbench/storyboard.project.json`。
- `Save` 是唯一会同步真实文件名和写工作 TIFF 像素的操作。

## Save

`Save` 会执行两件事：

- 按软件内 storyboard 顺序安全同步真实图片文件名。
- 把当前可见 SWB 绘制结果烘焙到工作 TIFF。

当前命名规则：

```text
项目名_场号_stb_艺术家名_版本号_0010.ext
项目名_场号_stb_艺术家名_版本号_0020.ext
```

序号按 10 递增，方便后续手动插入中间号位。真实重命名前会先做 preflight，避免覆盖或临时文件冲突。

## Layers And Drawing

当前绘图系统以 bitmap layer 为主数据：

- 图层元数据保存在 `.storyboard-workbench/storyboard.project.json` 的 `shots[].layers`。
- 每个可编辑图层是一张 PNG 工作层：`.storyboard-workbench/layers/{shotId}/{layerId}.png`。
- 画笔、橡皮、清空和删除图层只写 `.storyboard-workbench/` 内部工作数据。
- Undo / redo 会恢复相关 layer PNG snapshot 和 JSON metadata。
- Save 时由 Electron/sharp 合成可见 bitmap layers 并写入工作 TIFF。

图层面板支持新增、删除、重命名、显隐、opacity、blend mode 和拖动排序。`Image` 层固定在最底部，但在 UI 中可选中、绘制、擦除；选中 `Image` 后点击 `Delete current layer` 会删除当前可见底图内容并露出白底，不会立刻修改真实文件。

`npm run smoke:bitmap` 会启动本地 Electron，并通过 CDP 验证普通 PNG 文件夹打开后，Image layer 绘制会改变内部 PNG hash，undo / redo 会恢复预期 hash，Save 会生成 SWB-owned TIFF，重开后仍从内部 layer PNG 恢复可编辑结果。

## SWB Format

非 SWB 图片可导入为 SWB-owned TIFF。导入会把原文件移动到 `Archive/YYYY-MM-DD-HHMMSS/`，工作 TIFF 由 Storyboard Workbench 管理。

`.storyboard-workbench/storyboard.project.json` 是主数据；TIFF XMP metadata 只是便携快照。兼容的外部 TIFF 像素编辑可以被接受为新的 base，但 V1 不承诺 Photoshop 图层 round-trip。

## Storyboard And Animation Mode

- `Add Shot` 可创建白底 TIFF，支持 `16:9`、`2.39:1`、`1.43:1 IMAX`。
- Storyboard 按真实画布比例显示，混合画幅不会额外加黑边。
- Zoom 到单张 storyboard 填满工作区时进入动画模式，底部显示时间线。
- 动画模式支持左右键线性播放、时间线点击跳转，以及 Onion Skin 前后帧参考。

旧的 stroke 项目打开后会一次性生成 bitmap layer metadata 和内部 PNG layer assets。旧字段只作为迁移输入保留，主绘图流程不再依赖 `sketchLayers` / `imageLayerEdits`。

## MVP Non-Goals

- AI prompt fields or AI export.
- PDF or image sequence export.
- SQLite migration.
- Cloud sync or collaboration.
- Photoshop layer round-trip.
- Full Photoshop-compatible multi-layer TIFF writing.
