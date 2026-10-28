# Storyboard Flow — 架构速查

直接维护本文件；不再由教学图生成器生成。这里描述主树实际职责和读写链，不维护进度/测试计数，也不是安全认证。[当前状态](../../context-handoff.md)、[剩余工作](../../todo.md)、[规则](../../AGENTS.md)与[决定理由](../../decisions.md)各有单一入口。

## 整体关系

```text
React界面/控制器 → normal Save owner/bitmap queue → preload显式接口
                                                    ↓ IPC
shared项目规则 ← Project/结果 ← Electron main/handlers/runtime/service
                                                    ↓
                       JSON + 内部PNG + Markdown + TIFF/Archive/Pending
```

一个图片文件夹是项目边界。JSON保存结构，内部PNG保存可编辑像素，工作TIFF用于输出/交换；只有JSON不是完整作品备份。队列、ACK或框架不自动提供跨文件事务/crash保证。

## 按问题定位代码

| 关注点 | 主要入口与边界 |
|---|---|
| 顶层状态和实际接线 | `src/renderer/App.tsx`组合Project、工作区、selection、Save/Import、History和各controller；card/canvas/layer drawer分别在ShotCard/SketchPad/LayerPanel，JapaneseStoryboardView共享底层项目与交互规则。 |
| 正常保存状态所有者 | `src/renderer/normalSaveAppAdapter.ts`桥接App与`normalSaveProjectOwner.ts`；`src/shared/pendingBake.ts`管理持久待输出revision。App只有正常路径，不再提供旧模式开关。 |
| 工作区生命周期政策 | `src/renderer/workspaceSession.ts`集中History/绘画不同准入条件、render identity、Add/Paste目的地快照以及owner/recovery状态来源；真实epoch/权限/effect仍由owner承担，不统一不同scope或提供通用事务。 |
| 项目纯规则 | `src/shared/types.ts`与`projectOps.ts`，不再维护孤立的`src/model`或旧stroke编辑器；旧stroke数据与migration reader仍保留。`electron/shared/`放两编译目标共用纯规则（pendingBakeRules、manualImageImportRules、standaloneLayeredInput），共用认证原语但保调用方政策差异，不承担文件effect。 |
| 像素与历史 | `bitmapLayerPaintingController.ts`、`bitmapLayerActions.ts`、`projectHistoryController.ts`、`bitmapLayerWriteQueue.ts`；History同时保存Project/selection和PNG快照。首写前归属保护不等于完整写后补偿。 |
| IPC边界 | `electron/preload/preload.ts`、实际CJS`preload.cjs`、`src/renderer/global.d.ts`同步；`electron/main/ipc/`→各AppRuntime/Service。contextIsolation开启、nodeIntegration关闭，但不能称完整文件系统沙箱。 |
| 磁盘编排 | `electron/main/main.ts`保留打开/Save/Import/TIFF高风险组合；`saveRecovery.ts`、`fileRenames.ts`、`importRecovery.ts`、`importPaths.ts`负责限定恢复与路径预留，不是一般原子事务。 |
| Add与Merge清源 | `layerAssetService.ts`提供旧writePng和独立createLayerPng；`layerAppRuntime.ts`/`ipc/layerHandlers.ts`接线；`mergeSourceCleanup.ts`核durable Project、History/引用、目标与来源身份再清源。 |
| 正常Open/外来预览 | `electron/shared/workspaceFormat.ts`在普通编辑观察前识别不支持的旧测试项目，不冻结当前工作区；`normalOpenPreviewService.ts`与`electron/shared/standaloneLayeredInput.ts`负责外来预览。旧TIFF等价证明已退役；显式Import才建立外来图片本地资产/身份。 |
| TIFF与Python | `photoshopTiffExport.ts`/`photoshopTiffImport.ts`、`scripts/photoshop-layered-tiff-{export,import}.py`和pythonRuntime；sharp与既有Python raster TIFF交换，不代表真实Photoshop全保真或平台打包通过。 |
| Pending | renderer `storyboardDragEndController.ts`仅经必需域操作→normal adapter/owner→`pendingShotFileController.ts`→main Pending service/transaction；App不再装配旧文件回移/History reset后备路径。停车前物化当前TIFF再移动/持久化；load兼容仍归adapter。非空目的场景继承取ACK后最新peer设置，空板保自身黑边/对白。Pending不是Archive，journal不认证整套像素原子化。 |
| 产品边界 | 内置AI生成、Provider/凭据设置、候选Apply/拖入已移除；普通Pending由`ParkingShelf.tsx`/`rightSidebarController.ts`与正常停车/恢复链负责，无AI加载或接口。 |
| 构建与发布 | `package.json`、`scripts/check-preload-sync.mjs`、`scripts/electron-bitmap-smoke.mjs`和`.github/workflows/release.yml`；push main有公开发布副作用，不是无副作用备份，执行需授权。 |

表中renderer/main简名分别相对`src/renderer/`、`electron/main/`。改代码先追定义和实际调用方，不把路径表当许可或完整调用图。

## 关键读写链

### 编辑 → autosave → 重开 → 显式Save

1. 画笔/图层操作经bitmap queue处理内部PNG与History，owner记录相关待输出义务；纯metadata也有正常autosave接线。
2. adapter→preload→main内部持久化Project/必要Markdown与正常义务；autosave不做正式文件名同步，metadata ACK不能冒TIFF已完成。
3. 正常Open加载和校验实际资产/持久义务。来源未知、future/corrupt、缺资产或冲突不靠猜测变成synced。
4. 显式Save按capture/token/output证据与required最新Project持久化完成核验，才退休义务、呈现Saved/交Close。具体错误和未知effect保留保护；进度不证明成功。

### create-only Add与成功Merge

- Add记录pre-absence History，真实create-only PNG ACK前不发布descriptor/History。失败或可能已写保残留和明确未完成；此路径不改变旧PNG replacement。
- Merge目标完整→安全Project publication→required JSON/MD durable→History源快照/target absence自足→原queue内精确清源。部分unlink失败保durable结果及剩源；epoch已换跳cleanup。read→unlink非跨进程原子identity操作。

### Open与Import

正常编辑Open可能生成preview或执行限定恢复，不能当严格只读。外来有限layered TIFF可提供preview/Import入口，但无ownership/H0/synced；cache hit也做准入，异步结束重查前提。旧测试项目不再做等价证明或自动认证缺失状态。普通打开失败走状态提示，不污染当前Save状态；只读恢复不要求编辑格式预检。显式Import按实际来源归档/提层/required持久化，不采信外来XMP路径为本地权限。

独立图片浏览由 `FolderImageBrowser.tsx` → preload → `ipc/folderImageBrowserHandlers.ts` → `folderImageBrowserService.ts` 承担：旧/不可编辑项目在工作区 observation 前进入只读浏览，正常Open失败也可退回根目录图片；不替换当前编辑slot，不写来源缓存。PNG/JPEG/TIFF/WebP/GIF/AVIF 的合成预览在内存生成。显式 Import 选择新目的地并创建唯一子目录，顺序复制为PNG，再在staging slot运行现有图片Import；只有成功才发布新项目。旧图层/对白/脚本不迁移。新目录准备仍检查物理写入目的地；TIFF preparation 的目录创建使用 `mkdirObserved` 通知既有观察器，不放松当前项目identity校验。

## 数据位置与保留边界

```text
<场景目录>/
  .storyboard-workbench/storyboard.project.json       Project与持久义务
  .storyboard-workbench/layers/<shot>/<layer>.png     可编辑资产，不是缓存
  .storyboard-workbench/previews/                    派生预览缓存
  storyboard-script.md                              文字镜像/显式Import输入
  *.tiff                                            工作输出/外部交换
  Archive/<timestamp>/                              Import原件备份
  Pending/                                          停放普通故事板TIFF
```

内部兼容名字`.storyboard-workbench`/SWB不随产品更名迁移。停车、Import/Create等既有TIFF路径是旧Save-only广义措辞需要澄清的例外，本文只描述已存在行为，不扩大写权限或改产品契约。

## 未启用与尚无保证

另行冻结的 origin foundation/broker/History 实验未全面接入正式入口，不是本次启用授权。一般多资产补偿、旧PNG短写/访问控制、provisional清理、partial/crash/跨进程保证、真实外部能力与平台打包未全面认证，活动待办在TODO。

历史教学章节、示例流量和旧交互图不随公开源码分发，不是运行依赖。未来按实际职责/接线变化维护本页，进度只更新主交接，历史失败不改写成PASS。
