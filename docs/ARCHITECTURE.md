# 架构与数据契约

## 运行链与职责

源码按六个概念根组织：`src/workbench` 负责工作台布局和界面接线，`src/storyboard` 负责故事板组织、Pending、动作与对白的模型及界面，`src/drawing` 负责画布与图层，`src/session` 负责编辑状态、队列和历史，`src/project-files` 负责项目文件、资产与 TIFF，`src/platform` 负责 Electron、操作系统和桥接。各根内按运行环境区分，避免浏览器引入 Node 实现。

```text
flowEditorEntry → flowEditor preload → FlowEditor → Workbench / SketchPad / LayerPanel
                                           ↓
                                     session/core
                                     ↙          ↘
                                storyboard    drawing
                                           ↓ IPC
                           flowEditorRuntime / flowWorkspace
                            ↙                       ↘
                    persistence / depot       TIFF Save / Refresh
```

| 职责 | 代码入口 |
| --- | --- |
| 启动、目录选择、窗口/IPC、认证关闭 | `src/platform/main/flowEditorEntry.ts` |
| 桥接 | `src/platform/preload/flowEditor.ts`、`flowEditor.cjs`、`src/platform/contracts/flowEditor.ts` |
| Session接线、UI准入、项目切换 | `src/workbench/renderer/FlowEditor.tsx` |
| 布局、选择、框选、排序 | `src/workbench/renderer/Workbench.tsx`、`src/storyboard/renderer/` |
| 绘画/图层 | `src/drawing/renderer/SketchPad.tsx`、`src/drawing/renderer/LayerPanel.tsx`及控制器 |
| 项目/图像编辑、历史、队列、像素工具 | `src/session/core/`、`src/storyboard/core/`、`src/drawing/core/` |
| 不可变资产与checkpoint | `src/project-files/main/persistence/` |
| TIFF编解码 | `src/project-files/main/formats/` |
| Save、命名、Pending/Trash、Refresh | `src/project-files/main/flowTiffSave.ts`、`flowOutput*`、`flowImageReconciliation.ts` |
| Runtime拥有者、项目切换 | `src/project-files/main/flowWorkspace.ts`、`src/project-files/main/flowEditorRuntime.ts` |
| 原生保护、旧恢复拒绝 | `src/project-files/main/managedSourceSave.ts`、`src/project-files/main/workspacePhysicalWriterGate.ts`、`src/project-files/main/layerFileOperationQueue.ts` |
| 资源定位与打包 | `src/platform/main/flowRuntimePaths.ts`、`src/platform/main/packageResources.ts`、`scripts/package-*.mjs` |

旧运行树已退役。共享 `src/drawing/contracts/types.ts`与 `src/drawing/contracts/projectOps.ts`仍服务画布/图层，不能仅凭旧类型名删除。`MediaSourceContext`显式提供资产读取，不回落旧bridge；历史前端不参与构建。

`renderer/`放界面与浏览器实现，`main/`放Node/Electron实现，`core/`放不依赖界面和文件系统的编辑规则，`contracts/`放数据与接口约定。Session通过Storyboard和Drawing的公开编辑接口组织操作；历史与键入分组归Session，不引用Storyboard内部实现。公共项目校验与位置辅助位于 `src/project-files/contracts/projectModel.ts`。

构建后的Electron入口为 `dist-electron/platform/main/flowEditorEntry.js`，界面产物在 `dist/`；这些是生成目录，不是额外业务模块。根目录原 `electron/` 已搬空清除。

Pending 与活动故事板共用 `workspace/ShotCard` 卡片外壳、`useMarqueeSelection` 框选与 `useBoardSorting` 二维插入实现。两桌分别持有选择、顺序与滚动几何；Pending 仅呈现静态画面和台词，不挂载编辑画布。成员移动仍通过既有 Session 的 `moveShots`，不改变 `shots` / `parkedShots` 或文件事务格式。

## 名称与数据

产品 `Storyboard Flow`，代码 `Flow/flow`，环境变量 `FLOW_*`。TIFF使用 `app: "Storyboard Flow"`、`format: "flow-tiff"`、XMP `flow:metadata`、命名空间 `https://storyboard-flow.local/ns/1.0/`。受管子项目标记为 `.storyboard-flow-project`。checkpoint位于 `.storyboard-flow/checkpoints/`：`project.json`、`assets/<sha256>.png`、`versions/<revision>.json`。旧目录/恢复数据不迁移、不自动删。

现行类型权威为 `src/platform/contracts/refactorV1.ts`及 `flowWave2.ts`。项目数组决定活动/Pending/对白顺序；图层自底向上。图层至少一层、尺寸匹配画布，opacity有限且在[0,1]，支持normal/multiply/screen。普通ID为受限ASCII，assetId为编码PNG字节SHA-256；不是像素内容hash。对白保留Unicode，不偷偷规范化。

Project中无绝对路径、DOM、data URL或像素buffer。未知版本/字段和非法引用拒绝，不静默丢信息。删除成员可保留未引用image以支持历史；资产、版本和原件不自动GC。

## Session与资产

Session是唯一可写作品权威；输入在异步边界前验证/快照，返回对象与调用方不共享可变数据。纯编辑失败/no-op不入历史，新编辑清redo；Undo/Redo恢复内容并产生新项目revision。历史保留资产引用而非像素副本，重开不恢复前进程撤销栈。

像素制作→真实depot入库→核心图像替换→历史安装。操作ID由Session产生，校验收据的session/operation/尺寸/asset身份，不接受renderer伪造完成结果。像素坐标不重复缩放；隐藏/锁定目标按核心规则拒绝。depot只读初始合法checkpoint引用或本会话成功入库资产，读取复核绑定/hash，成功重试也复查存在与完整性。

重型编辑有界排队，文字捷径遵守队列屏障，实际安装顺序决定Undo顺序。checkpoint去抖、最多一个在途及一个最新待存目标；r回执仅确认r，不确认其后的r+1。失败不回滚用户内容、不热循环假重试。freeze停止新编辑准入，等待已接纳操作与最新checkpoint；失败保持受保护状态，重试成功才可继续，超时不是取消。

checkpoint先验证/发布不可变资产和版本，再发布head。相同revision仅在逻辑内容相同才幂等；旧head不能覆盖新head。根目录/符号链接/临时路径/尺寸/哈希必须验证。预算是局部准入，不是全进程内存封顶；超限拒绝，不删历史腾空间。

## 对白提交与撤销

连续键入折叠要求同token、同目标、合法纯文本变化且间隔严格小于800ms；800ms断组。实现入口为 `src/session/core/grouping.ts` 与 `src/storyboard/renderer/dialogueBlocks/`。

IME候选只留本地，确认后提交。每个编辑器独立持有未确认提交义务；其他实例成功、卸载或超时都不能代为解除。失败保留最新意图供重试，旧回执不能清掉新请求；成功与宿主回显之间仍须保留用户回退意图。关闭在freeze后复检义务。具体状态机见 `dialogueCommitState.ts` 和 `dialogueBlocks/commitQueue.ts`。

## TIFF导入

“打开”只加载已有 Flow checkpoint，不会初始化用户选择的图片目录。由“创建”从多个文件或一个文件夹读取素材；文件夹只扫描直属 JPEG、PNG、受支持的 TIFF 并自然排序。主进程持有来源绝对路径，汇总需要跳过或降级的素材供一次确认。在目标父目录内准备独立暂存项目、新身份、资产和已发布的 TIFF 绑定，再独占发布到新目录。失败时保留无法安全清除的暂存现场，不删除来源或覆盖已有项目。

“添加图片”复用读取和转换，但只把本批新板追加到现有项目的 Pending。Session 先把旧状态暂存，主进程按操作 ID 写事务日志，独占创建该批文件并保存新 checkpoint，Session 将整批安装为一步撤销。返回结果未知时仅能用同一操作重试；不会重复弹出选择器。Windows 当前不提供此入口。取消在事务意图写入前生效；写入意图后，应用须完成该批或在下次打开时恢复。恢复只认可已登记、身份与摘要均匹配的输出；遇到外来或无法确认的文件时保留现场，另取未占用名称。

新增 TIFF 的暂存字节按摘要保存在项目内的 `.storyboard-flow/pending-add/blobs/`，不自动删除。每批最多 512 MiB；开始前须能在 2 GiB 总额内预留整批空间，不足时拒绝追加并报告位置。取消不会删除此前已写入的私有暂存数据。

原件字节保留在 `.storyboard-flow/originals/`，后续Save不覆盖首份原件。TIFF原生层ID与XMP映射用于支持子集的身份，不靠名称/数组位置猜测。`portable/native/unverified`是验证级别；native存在不等于已与任意项目基线对应。外来不支持的PS结构安全拒绝。独立副本由用户在文件系统复制完整项目文件夹后经“打开”加载，软件不另设工作副本入口；不承诺PSD/全部图层保真或来源持续追踪。

## 显式Save、命名与删除

Save捕获点击时项目；输出期间新的笔画属于后续revision，不能错称已输出。自动暂存不改TIFF。所有候选先准备、预算/身份/碰撞校验后再发起效果；receipt必须对应捕获的projectId/revision。输出ledger记录物理完成状态，不能被Session Undo倒带。

活动板按项目/场景/stb/作者/版本/0010规则命名，步长10；设置是可撤销项目编辑，Save才改真实文件名。Pending保留绑定名且不消费活动板编号。预检拒绝占用目标名的外来文件和大小写碰撞；先暂存所有源名再发布最终名，处理循环/大小写改名，不覆盖别人文件。持久intent绑定设备/inode/摘要；恢复先完成旧intent，再解释新项目。未改像素/文本的成员移动复用TIFF字节；无无条件copy/unlink回退。

删除先改逻辑成员，Save才调用系统Trash。记录stage→ready→dispatching→confirmed，真实OS ACK和磁盘确认完成后才能退休输出；单凭文件缺失不是成功。无原件且从未发布的输出可标absent-unpublished，不能伪称Trash成功。部分Save可已有结算效果但不能返回全项目成功；缓存未持久ACK阻止正常Close/切项目直到重试。

进程若在Trash后、确认持久化前退出，dispatching+缺失仍是未知结果；不扫描私人Trash、不伪造ACK、不删除保留证据。当前恢复提示可要求用户系统“放回”后核验并重试。Undo后Save从保留资产重新生成，不从Trash读取。恢复账本、原件、空staging和tombstone不自动GC；原生硬链接/目录flush能力不足安全拒绝。

## 外部Refresh与项目切换

Refresh区分基线B、本地L、外部E；比较可信稳定图层身份及解码RGBA，而非PNG压缩字节。独立变化可合并，同层/身份不明冲突保留Pending；项目顺序/命名/对白/动作仍由项目拥有。刷新已输出图层映射回原身份，避免双重叠加；本地新增层保留。

Main绑定来源和基线、准备资产、记录before/after intent，验证after checkpoint后才接受来源摘要。重试完成已请求操作，不等于自动观察新文件。未完成Refresh阻止冲突的checkpoint/Save/Close，显式重试或重开恢复；已完成receipt支持丢回执重试。仅检查绑定TIFF，不发现新图、不跟踪外部改名、不合并同层像素。Save仍是写工作TIFF的唯一操作。

切项目先等Save、freeze当前Session，再准备目标；取消/同根/失败保留旧Session与历史。所有IPC携带当前session token，projectId或路径相同不代表旧回调仍授权。退休会话的读回调不得影响新UI或生成遗留URL。在途写入结算前不能认证关闭；对白义务在freeze之后仍须复检。

一个项目仅一个可写Session。默认启动锁不提供跨显式profile的任意并发写入保证。未知原生权限、旧恢复namespace和未结算效果仍是拒绝条件；不因旧恢复UI退役而绕过。
