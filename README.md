# Storyboard Workbench MVP

本项目是一个本地优先的故事板编排原型。V1 聚焦三件事：故事板排序、台词跨故事板移动、图片草图批注。

当前工作流采用地址栏文件夹入口：粘贴一个本地图像文件夹路径就是打开一场戏。应用会读取文件夹内图片，并在该文件夹下保存排序、台词和草图元数据。

## Scripts

```bash
npm install
npm run test
npm run typecheck
npm run build
npm run dev
```

## Workspace Files

在顶部地址栏粘贴图片文件夹路径并按 Enter 后，应用会扫描 `.png`、`.jpg`、`.jpeg`、`.tif`、`.tiff`。打开过的文件夹会出现在 macOS `File > Open Recent` 和地址栏旁的 `Recent` 下拉中。

点击 `Add Shot` 会在当前文件夹生成一张新的 1920x1080 白底 TIFF，并插入到当前选中 Shot 后方。拖拽排序、台词、草图会自动保存到当前图片文件夹下的 `.storyboard-workbench/storyboard.project.json`，所以不点击 `Save` 也能在重新打开后恢复软件内部状态。

点击 `Save` 只负责按软件内顺序把图像重命名为 `001_original.ext` 这种格式，让 Finder/Bridge 的文件名顺序和软件一致。TIFF preview 会生成到 `.storyboard-workbench/previews/` 目录。

## MVP Scope

V1 不包含 AI 字段、导出、SQLite、Photoshop 集成、云同步或复杂绘画工具。
