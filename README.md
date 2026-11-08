# Storyboard Flow

[中文](#中文) · [English](#english)

## 中文

Storyboard Flow 是一个本地分镜工作台，帮助你在故事还清晰的时候把它画下来，再通过调整镜头顺序打磨叙事。你可以先用三张草图画出“听见敲门声、走到门边、看见来人”，然后把最后一张移到最前面，看看提前揭晓来人会不会让这段戏更有意思。

**从整段故事到一个镜头**

- **左栏看整段。** 直接在缩略图上画草图，记下动作和对白。框选几张分镜就能整组移动；普通网格和日式分镜表显示的是同一套镜头。拿不准的镜头可以先放进 Pending 备用区，之后再移回来。
- **右栏画细节。** 选中一个镜头，打开洋葱皮，参照前面镜头里人物的位置，在单独的图层上画下一个姿势。画布上的修改会同步出现在左栏缩略图中。

**常用操作。** B 画笔、E 橡皮、L 选区、K 模糊；按住 E 临时擦除，松开恢复原工具，短按则保持橡皮。普通网格与日式分镜共用尺寸滑杆，切换视图保留大小；Pending 有独立的尺寸滑杆。

**在 macOS 上从源码启动**

安装 Node.js 22.12 或更高的 22.x 版本，以及 Python 3。在仓库根目录运行以下命令，安装应用依赖和分层 TIFF 工具：

```sh
npm ci
npm run setup:photoshop-tiff-deps
```

扩展 TIFF/PSD 读取及打包还需显式准备 Rust 1.99.1，再运行 `npm run setup:photocraft` 和 `npm run build:photocraft`，详见[组件说明](native/photocraft/README.md)。启动器不会自动安装这些依赖。图片发动机替换仍在施工，组件准备和当前平台限制见[开发说明](docs/DEVELOPMENT.md#原生工作台施工验证)与[当前进度](docs/CURRENT.md)。

然后双击 `启动 Storyboard Flow.command`。启动器会构建并打开工作台；首次使用时，可以打开已有 Flow 项目，或从 JPEG、PNG、受支持的 TIFF 创建一个独立项目。来源文件保留在原处。开发时可用 `npm run dev` 启动热更新。

新图片引擎有独立入口 `试用新版 Storyboard Flow.command`，沿用先构建再启动，使用独立的最近项目与布局配置，不替换普通启动器。试用准备状态和限制见[当前进度](docs/CURRENT.md)。

**什么时候点「保存」？** 草图、排序和对白会自动暂存在项目文件夹中（状态栏显示「已自动暂存」）。准备让外部绘画工具看到这次修改时，再点「保存」：点顶栏中央的项目名可以编辑命名信息。保存时按项目名、场次、作者和版本同步工作图与文件名、更新 Pending 位置，并将已删除镜头对应的工作图移到系统废纸篓。点故事板工具栏「新建板」旁的「添加板」时，只会立即写入新加入 Pending 的那批图片。其他画稿仍需显式保存。 在其他工具里改过受支持的 TIFF 后，回到工作台点顶部的文件夹向内箭头图标取回改动。需要独立副本时，先在访达/资源管理器里复制项目文件夹，再用「打开」打开副本。分层 TIFF 交换支持部分图层特性，不保证完整保留 Photoshop 的所有效果。

## English

Storyboard Flow is a local storyboard workspace for sketching a scene while it’s fresh and refining it through shot order. Sketch three beats: someone hears a knock, walks to the door, and sees who’s there. Now move the last board to the front. Does the scene work better when the audience already knows who’s waiting?

**From sequence to shot**

- **Shape the sequence on the left.** Draw directly on thumbnails and jot down action and dialogue. Drag a selection box around several boards to move them together. Switch between the thumbnail grid and a Japanese-style storyboard sheet, or set a shot aside in Pending until you find a place for it.
- **Refine a shot on the right.** Select a board and use onion skinning to see where a character stood in earlier shots. Sketch the next pose on its own layer. Changes on the canvas appear in the thumbnail, so you can judge the new pose in context.

**Quick controls.** B selects Brush, E Eraser, L Selection, and K Blur. Hold E to erase temporarily and release to return; tap E to keep the eraser selected. Grid and Japanese sheet views share a size slider and retain its value when switching. Pending has its own size slider.

**Run from source on macOS**

With Node.js 22.x (22.12 or later) and Python 3 installed, run these commands from the repository root to install the app dependencies and layered TIFF tools:

```sh
npm ci
npm run setup:photoshop-tiff-deps
```

Double-click `启动 Storyboard Flow.command` to build and launch the app. On first launch, open an existing Flow project or create a separate project from JPEG, PNG, or supported TIFF images. Source files stay where they are. For development with hot reload, run `npm run dev`.

Extended TIFF/PSD reading and packaging require the explicitly prepared Rust 1.99.1 component; see the [native setup and compatibility limits](native/photocraft/README.md). Complex sources remain protected; normal Save writes Flow TIFF, while the separate PSD export supports only the documented RGB8/sRGB PSD subset.

The separate `试用新版 Storyboard Flow.command` launcher uses isolated trial settings for the new image engine. Readiness and limits are tracked in [CURRENT](docs/CURRENT.md).

**When should I use Save?** Flow automatically checkpoints sketches, shot order, and dialogue in the project folder (the status bar reads "已自动暂存"). Choose **Save** when you want your edits to reach the working image files. It applies the naming rule to filenames, updates pixels and Pending locations, and sends working images for deleted shots to the system Trash. Click the centered project title to edit the naming fields. **添加板** beside **新建板** in the storyboard toolbar writes only the newly added images to Pending. After editing a supported TIFF in another tool, click the folder-with-inward-arrow icon in the header to pull the changes back. For an independent copy, duplicate the project folder in Finder/Explorer and open the copy with **Open**. Layered TIFF exchange supports a subset of layer features; full Photoshop fidelity is not guaranteed.

## 文档 · Documentation

项目文档以中文维护。 / The project guides below are in Chinese.

[产品设计 · Design](docs/DESIGN.md) · [架构 · Architecture](docs/ARCHITECTURE.md) · [开发与验证 · Development](docs/DEVELOPMENT.md) · [当前进度与已知限制 · Status and limitations](docs/CURRENT.md) · [协作规则 · Contributor guidelines](AGENTS.md)

项目自有代码采用 [MIT 许可证](LICENSE)，第三方依赖保留各自许可。 / Original project code is licensed under [MIT](LICENSE); third-party dependencies retain their own licenses.
