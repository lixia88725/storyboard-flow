# 故事板工作台 MVP PRD

## 目标

V1 只做一个可用的本地故事板编排原型，让创作者可以通过文件夹路径打开本地图像文件夹、调整故事板顺序、移动台词，并在图片上绘制草稿批注。

## 核心功能

1. 故事板排序：用户可以拖动故事板卡片，自由调整顺序。
2. 台词移动：台词是独立对象，可以从一个故事板拖到另一个故事板。
3. 草图批注：用户可以在每张图上绘制简单草稿，并随项目保存。
4. 文件夹工作区：用户粘贴图像文件夹路径即可开始工作。
5. 新增空白图：用户可以在当前文件夹生成新的 16:9 TIFF 故事板图像。
6. 自动保存：软件内部排序、台词和草图实时写入元数据 JSON。
7. 文件同步：保存时按软件内顺序重命名图像，让文件夹排序与软件排序一致。
8. 最近文件夹：macOS 菜单和地址栏下拉都能快速打开最近工作区。
9. 视图缩放与多选：用户可以缩小故事板卡片查看全局，并框选多张 Shot 成组移动。
10. 动画模式：当单张故事板接近填满视窗时，底部时间线出现，用户可以按顺序播放或点击跳转到任意故事板。
11. 快捷键：故事板模式下方向键按视窗网格移动选择；动画模式下左右键线性切换故事板；`B` 选择画笔，`E` 选择橡皮。
12. 画笔颜色与透明度：用户可以用 web 颜色选择器选择画笔颜色，并调整不透明度。

## 暂不实现

- AI prompt 字段与 AI 导出。
- PDF / 图片序列导出。
- SQLite 数据库。
- Photoshop 打开、文件监听、图层同步。
- 多人协作、云同步。
- 复杂绘画系统。

## 数据模型

```ts
type Project = {
  id: string;
  name: string;
  shots: Shot[];
  dialogues: Dialogue[];
  createdAt: string;
  updatedAt: string;
};

type Shot = {
  id: string;
  imagePath: string;
  previewPath?: string;
  fileName: string;
  sourceFileName?: string;
  order: number;
  sketchData: SketchStroke[];
};

type Dialogue = {
  id: string;
  shotId: string;
  text: string;
  order: number;
};

type SketchStroke = {
  id: string;
  tool: "brush" | "eraser";
  color: string;
  size: number;
  points: number[];
  opacity?: number;
};
```

元数据固定保存到当前图片文件夹下的 `.storyboard-workbench/storyboard.project.json`，由应用自动维护。TIFF preview 保存到 `.storyboard-workbench/previews/`。点击 Save 时图像文件按 `001_original.ext` 格式重命名。

## 验收标准

- 地址栏粘贴包含 3-5 张图片的文件夹路径并按 Enter 后，故事板卡片正确显示。
- 拖动 Shot 顺序，不点击 Save，关闭、重新打开后软件内顺序不丢失。
- 在 Shot A 双击台词区输入台词，拖到 Shot B，不点击 Save，重新打开后仍属于 Shot B。
- 在每张图上绘制草图，不点击 Save，重新打开后草图恢复。
- 清空某张图草图，不影响其他 Shot。
- 点击 Add Shot 创建新的白底 16:9 TIFF，不清空当前故事板。
- 选中某张 Shot 后点击 Add Shot，新 Shot 插入到选中 Shot 后方。
- 点击 Save 后，文件夹内图像按软件顺序重命名为 `001_original.ext` 格式。
- 多次 Save 不重复叠加数字前缀。
- 最近打开的文件夹出现在 macOS File 菜单和地址栏 Recent 下拉中。
- 缩放滑杆可以改变卡片密度；框选多张 Shot 后能成组移动。
- 多选 Shot 拖拽时能清晰看到选中图像组成的堆叠预览，并能拖到目标 Shot 前或后。
- 当单张 Shot 接近填满工作区时，底部时间线出现；用户可以点击时间线缩略图跳转，也可以用左右键顺序切换。
- 在动画模式和放大视图中，画笔和橡皮都能继续绘制，不出现笔画中途断掉的问题。
- 画笔颜色和透明度随草图数据保存并恢复。
- TIFF 文件至少能通过 preview 显示，不要求保留 TIFF 图层或元数据。
