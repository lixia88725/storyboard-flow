import fs from "node:fs";
import path from "node:path";

const outputPath = process.argv[2];

if (!outputPath) {
  throw new Error("Usage: node scripts/generate-release-readme.mjs <output-path>");
}

const version = requiredEnv("STORYBOARD_FLOW_VERSION");
const releaseUrl = requiredEnv("release_url");
const windowsUrl = requiredEnv("windows_url");
const macosAppleSiliconUrl = process.env.macos_arm64_url ?? "";
const macosIntelUrl = process.env.macos_x64_url ?? "";
const generatedAt = new Date().toISOString().slice(0, 10);

const macDownloadRows = [
  macosAppleSiliconUrl
    ? `| macOS Apple Silicon | [下载 / Download](${macosAppleSiliconUrl}) | 未公证的 .app zip；首次打开可能需要在系统设置中允许。 / Unnotarized .app zip; first launch may require allowing it in System Settings. |`
    : "",
  macosIntelUrl
    ? `| macOS Intel | [下载 / Download](${macosIntelUrl}) | 未公证的 .app zip；首次打开可能需要在系统设置中允许。 / Unnotarized .app zip; first launch may require allowing it in System Settings. |`
    : ""
].filter(Boolean);

const readme = `# Storyboard Flow

Storyboard Flow 是一个给分镜工作用的本地桌面软件。你可以把一个装满 storyboard 图片的文件夹打开，在里面排序、写文字、画修改、管理图层，最后再把确认好的顺序和画面安全同步回真实文件。

Storyboard Flow is a local desktop app for storyboard work. Open a folder of storyboard images, arrange the order, write notes, draw revisions, manage layers, and safely sync the approved order and artwork back to real files when you are ready.

## 立即下载 / Download

当前版本 / Latest version: **${version}**

| 平台 / Platform | 下载 / Download | 说明 / Notes |
| --- | --- | --- |
| Windows x64 | [下载 / Download](${windowsUrl}) | 便携 zip，解压后运行。 / Portable zip; unzip and run. |
${macDownloadRows.join("\n")}

所有版本和文件也可以在 [GitHub Releases](${releaseUrl}) 查看。

All versions and release files are also available on [GitHub Releases](${releaseUrl}).

## 它解决什么问题 / What It Solves

很多 storyboard 工作一开始只是一个普通文件夹：里面有很多图片，顺序会变，文件名会变，还要临时写说明、画修改、给别人看。只用 Finder、Bridge 或普通看图软件时，这些信息很容易散掉。

Storyboard Flow 把这些事放进一个简单的本地工作台：图片还在你的文件夹里，但你可以在软件里清楚地整理顺序、补充文字、做简单绘制和图层修改。等你确认以后，再点击 Save，把结果同步回文件名和 TIFF。

Storyboard work often starts as a normal folder full of images. The order changes, filenames need to match, notes get added, and quick visual edits are needed. Finder, Bridge, or a basic image viewer can make that information easy to lose.

Storyboard Flow gives that folder a simple local workspace. Your images stay in place, while the app helps you arrange, annotate, draw, and manage lightweight layers. When the result is ready, Save syncs the final order and TIFF output.

## 适合谁 / Who It Is For

- 分镜师、导演、剪辑、动画团队，或者任何需要整理大量 storyboard 图片的人。
- 想继续用“一个文件夹就是一个项目”的工作方式，但希望排序、文字和绘图都在同一个地方完成的人。
- 需要把最终顺序变成清楚文件名，并把图层结果写回 TIFF 的人。

- Story artists, directors, editors, animation teams, or anyone organizing many storyboard images.
- People who want to keep the "one folder is one project" workflow, but need ordering, notes, and drawing in one place.
- Teams that need final order reflected in clear filenames and TIFF output.

## 基本工作流程 / Basic Workflow

1. 打开一个装有 storyboard 图片的本地文件夹。
2. 在 Storyboard Flow 里拖拽排序、移动台词、编辑每张图的文字说明。
3. 用画笔、橡皮、选区和图层做临时修改。
4. 需要时使用 AI Draft 生成候选图，确认后再添加为新图层。
5. 确认结果后点击 Save，同步真实文件名并写入最终 TIFF。

1. Open a local folder containing storyboard images.
2. Drag to reorder shots, move dialogue, and edit per-shot script text.
3. Use brush, eraser, selection tools, and layers for quick revisions.
4. Optionally use AI Draft to generate candidates, then apply approved results as new layers.
5. Click Save when ready to sync real filenames and write final TIFF output.

## 当前能力 / Current Features

- 打开本地图像文件夹，自动建立本地项目状态。
- 拖拽排序 storyboard，移动台词，编辑每张图的文字说明。
- 画笔、橡皮、选区移动/缩放、图层显隐、锁定、透明度和合并。
- 支持 Photoshop-readable layered TIFF 交换路径。
- 支持 AI Draft 候选图：生成结果先作为候选，确认后才添加为新图层，不直接覆盖原图。
- Save 是唯一会同步真实文件名和写入最终 TIFF 的动作。

- Open a local image folder and keep project state beside the images.
- Drag to reorder storyboards, move dialogue, and edit per-shot script text.
- Brush, eraser, selection move/scale, layer visibility, lock, opacity, and merge.
- Photoshop-readable layered TIFF exchange path.
- AI Draft candidate flow: generated images stay as candidates until applied as a new layer, without replacing original artwork directly.
- Save is the only action that syncs real filenames and writes final TIFF pixels.

## 安装提示 / Install Notes

### Windows

下载 Windows zip 后解压，运行里面的 Storyboard Flow 可执行文件。如果 Windows SmartScreen 提示未知发布者，请确认下载来源是本仓库的 Release 页面。

Download the Windows zip, unzip it, and run the Storyboard Flow executable inside. If Windows SmartScreen warns about an unknown publisher, make sure the file came from this repository's Release page.

### macOS

当前 macOS 版本是 Apple Silicon .app zip，尚未公证。首次打开时，如果系统拦截，请在系统设置的隐私与安全性中允许打开。

The current macOS build is an Apple Silicon .app zip and is not notarized yet. On first launch, macOS may require you to allow it from Privacy & Security settings.

## 重要说明 / Important Notes

- 这是测试期版本，适合小范围试用和反馈。
- 当前不是静默自动更新；软件会提示新版本，但需要你手动下载替换。
- macOS 版本尚未 notarize，Windows 版本也可能出现未知发布者提示。
- 如果你在正式项目中试用，建议先复制一份项目文件夹作为备份。

- This is a tester release intended for small-scale use and feedback.
- Updates are not installed silently. The app can notify you about a new version, but you download and replace it manually.
- The macOS build is not notarized yet, and Windows may show an unknown publisher warning.
- For important production work, make a copy of the project folder before testing.

## 更新方式 / Updates

Storyboard Flow 会检查这个仓库中的 \`update.json\`。有新版本时，软件会在右下角提示；点击 Download 会打开 Release 页面，由用户手动下载和替换。

Storyboard Flow checks \`update.json\` in this repository. When a newer version is available, the app shows a notice in the lower-right panel. Download opens the Release page so you can update manually.

## 数据安全 / Data Safety

Storyboard Flow 是本地优先工具。项目数据保存在你打开的图片文件夹旁边，图片文件不会上传到云端。自动保存只保存项目状态，不会悄悄改你的真实图片文件名；只有点击 Save 才会同步真实文件名和写入最终 TIFF。

Storyboard Flow is local-first. Project data is stored beside the image folder you open, and image files are not uploaded to the cloud. Autosave stores project state only and does not silently rename your real image files; real filenames and final TIFF pixels are updated only when you click Save.

---

README 自动生成于 / Generated on ${generatedAt}.  
发布页 / Release page: ${releaseUrl}
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, readme, "utf8");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
