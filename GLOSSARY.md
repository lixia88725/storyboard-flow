# Storyboard Flow

本地优先的 Electron 分镜工作台：在一个图片文件夹里排列分镜图、在分镜间移动台词、绘制编辑并管理轻量图层。本文件只定义项目语言；规则见 `AGENTS.md`，决定理由见 `decisions.md`。

## Language

### 产品与项目

**Storyboard Flow**:
产品名，用于界面文案、文档和面向 GitHub 的文字。
_Avoid_: Storyboard Workbench（旧名，只作为磁盘格式的内部兼容名保留）

**SWB**:
旧产品名遗留下来的磁盘格式与元数据命名空间的内部兼容名（含 `.storyboard-workbench`），不是产品名，不随更名迁移。
_Avoid_: 在新的面向用户文字中使用

**Project**:
以一个场景图片文件夹为边界的工作单位。

**Shot**:
Project 中的一格分镜，对应场景文件夹里的一张图片，带有自己的元数据和图层。

**Dialogue**:
附属于 Shot 的台词，可在 Shot 之间移动。

**Bitmap layer**:
Shot 上可编辑的像素图层。`Image` 层也是一种 Bitmap layer。
_Avoid_: Sketch layer、stroke（旧的笔画数据只作为迁移输入）

**Working TIFF**:
SWB 拥有并随 Save 更新的 Shot 图片文件，是用户在 Finder／Bridge 中看到的实际交付图像。

### 保存与导入

**Autosave**:
自动写入内部状态和元数据，不改用户文件名。
_Avoid_: 把它和 Save 混称

**Save**:
用户显式触发的动作，是真实图片文件名同步的唯一边界；被删除的 Shot 也在此时移入系统 Trash。

**Import**:
用户显式触发的动作，把外部来源纳入 Project：非 SWB 图像、外部编辑过的 TIFF、Markdown 分镜脚本的修改。非 SWB 图像转换时，原文件备份进 Archive。

**Archive**:
只保存 Import 时留下的原始文件备份的文件夹。
_Avoid_: 用它指待定区或被删除的图片

**Trash**:
被删除 Shot 的去向：Save 时移入系统垃圾箱，可恢复。
_Avoid_: Archive

### 待定区

**Pending**:
用户停放备用 Shot 的可见文件夹和界面区域，在 Finder／Bridge 中可直接查看。
_Avoid_: Archive

**Parked shot**:
停放在 Pending 中的 Shot。不参与 Save 输出、文件名同步、Timeline 和 `storyboard-script.md`，直到恢复回 Project。
_Avoid_: 把停放说成删除或归档

### 其他

**Storyboard script**:
根目录的 `storyboard-script.md`，是各 Shot 顺序与台词文字的 Markdown 镜像，不是主状态；外部修改只在 Import 时被吸收。

**Onion Skin**:
动画模式下叠加前后帧的绘制辅助，只用于预览，不写入任何文件。

**Merge**:
图层合并动作：单选图层时向下合并，多选时合并到选中组最下面的图层。
