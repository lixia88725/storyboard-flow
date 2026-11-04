# Storyboard Flow

[中文](#中文) · [English](#english)

## 中文

Storyboard Flow 是一个本地分镜工作台，帮助你在故事还清晰的时候把它画下来，再通过调整镜头顺序打磨叙事。你可以先用三张草图画出“听见敲门声、走到门边、看见来人”，然后把最后一张移到最前面，看看提前揭晓来人会不会让这段戏更有意思。

**从整段故事到一个镜头**

- **左栏看整段。** 直接在缩略图上画草图，记下动作和对白。框选几张分镜就能整组移动；普通网格和日式分镜表显示的是同一套镜头。拿不准的镜头可以先放进 Pending 备用区，之后再移回来。
- **右栏画细节。** 选中一个镜头，打开洋葱皮，参照前面镜头里人物的位置，在单独的图层上画下一个姿势。画布上的修改会同步出现在左栏缩略图中。

**在 macOS 上从源码启动**

安装 Node.js 22.12 或更高的 22.x 版本，以及 Python 3。在仓库根目录运行以下命令，安装应用依赖和分层 TIFF 工具：

```sh
npm ci
npm run setup:photoshop-tiff-deps
```

然后双击 `启动 Storyboard Flow.command`。启动器会构建并打开工作台；首次使用时，选择已有的 Flow 项目或受支持的 TIFF 文件夹。开发时可用 `npm run dev` 启动热更新。

**什么时候点「保存 TIFF」？** 草图、排序和对白会自动暂存在项目文件夹中。准备让外部绘画工具看到这次修改时，再点「保存 TIFF」：它会同步工作图、文件名和 Pending 位置，并将已删除镜头对应的工作图移到系统废纸篓。在其他工具里改过受支持的 TIFF 后，可回到工作台手动刷新。分层 TIFF 交换支持部分图层特性，不保证完整保留 Photoshop 的所有效果。

## English

Storyboard Flow is a local storyboard workspace for sketching a scene while it’s fresh and refining it through shot order. Sketch three beats: someone hears a knock, walks to the door, and sees who’s there. Now move the last board to the front. Does the scene work better when the audience already knows who’s waiting?

**From sequence to shot**

- **Shape the sequence on the left.** Draw directly on thumbnails and jot down action and dialogue. Drag a selection box around several boards to move them together. Switch between the thumbnail grid and a Japanese-style storyboard sheet, or set a shot aside in Pending until you find a place for it.
- **Refine a shot on the right.** Select a board and use onion skinning to see where a character stood in earlier shots. Sketch the next pose on its own layer. Changes on the canvas appear in the thumbnail, so you can judge the new pose in context.

**Run from source on macOS**

With Node.js 22.x (22.12 or later) and Python 3 installed, run these commands from the repository root to install the app dependencies and layered TIFF tools:

```sh
npm ci
npm run setup:photoshop-tiff-deps
```

Double-click `启动 Storyboard Flow.command` to build and launch the app. On first launch, choose an existing Flow project or a folder of supported TIFFs. For development with hot reload, run `npm run dev`.

**When should I use Save TIFF?** Flow automatically checkpoints sketches, shot order, and dialogue in the project folder. Choose **Save TIFF** when you want your edits to reach the working image files. It updates pixels, filenames, and Pending locations, and sends working images for deleted shots to the system Trash. After editing a supported TIFF in another tool, refresh it manually in Flow. Layered TIFF exchange supports a subset of layer features; full Photoshop fidelity is not guaranteed.

## 文档 · Documentation

项目文档以中文维护。 / The project guides below are in Chinese.

[产品设计 · Design](docs/DESIGN.md) · [架构 · Architecture](docs/ARCHITECTURE.md) · [开发与验证 · Development](docs/DEVELOPMENT.md) · [当前进度与已知限制 · Status and limitations](docs/CURRENT.md) · [协作规则 · Contributor guidelines](AGENTS.md)

项目自有代码采用 [MIT 许可证](LICENSE)，第三方依赖保留各自许可。 / Original project code is licensed under [MIT](LICENSE); third-party dependencies retain their own licenses.
