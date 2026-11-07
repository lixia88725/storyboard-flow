# 架构与数据契约

## 原生图片发动机施工接点

本节为隔离施工树已落地的接点，不表示默认运行链已迁移；完整状态见 CURRENT。

`platform/main/imageEngineConnection` 独占一个原生子进程及单个在途请求，启动等待也占用容量。发送前快照输入；stdout 使用有界长度拆包，握手和响应核对 session/incarnation/workerEpoch/request/operation 身份。通道断裂只报告 unknown，不能证明原生操作取消，调用方仍负责结算。日志与图像协议分流，Main 不把二进制通道直接暴露给页面。握手 capabilities 显式标记 `recoveredCandidateAcceptAtInstalledVersion` 和 `strokePipelineV1`；缺省按不支持处理，不能凭 protocol=1 推断新恢复语义。

`drawing/renderer/image-engine/frames` 安装完整帧或连续增量，透明像素绝对覆盖，身份切换显式 reset。Canvas Adapter 只呈现该共享 FrameView，无第二份正式绘画计算。Main 到 renderer 当前为结构化克隆；只在脏区域复制，不宣称跨进程零拷贝。

连续绘画协议区分 `imageVersionRef` 已接纳前缀和 `pendingOperationIds` 未 durable-accepted 的完整笔链；`workingHeadOperationId` 等于待确认链尾，活动笔另用 previewId。pipeline 开始/结束提升 epoch，同 epoch 的 pipelineId 不变；pending 为空也不能替代项目 checkpoint/Save 成功判据。帧接收器只验证展示身份，不承担项目持久化认证。原生异步队列已实现：输入线程与持久化线程分开，四笔有界队列，失败冻结依赖链而不自动重试。Main 项目接纳与默认产品接线仍在施工。

项目 V2 在 `platform/contracts/imageProject.ts` 定义图片内容联合引用：source 指向固定来源及解释身份，native 指向 store/document/version/manifest 摘要；项目不保存另一份可写 PNG 图层树。后台 hydration 写持久派生索引，不改变项目引用、不产生用户 Undo；第一笔才由 source 引用变成新 native 版本，撤销可回到同一固定来源解释。

`session/core/snapshotHistory` 为 V1/V2 共用的唯一历史算法。新路径先 prepare 历史计划，Main 的 V2 store 发布可达 commit/head 后再 commit 同一计划；native accepted 是项目决定后的结算，不是项目提交权威。孤立 commit 文件不自动认领，未结算 native 决定单列恢复账本。当前重开继续沿用清空进程内 Undo 栈的行为，不声称已实现跨重启 Undo。

V2 store 的 writerAuthority 必须由 Main 注入；同进程 Map 与恢复目录保护都不等于跨进程锁。全项目恢复预算包括实际留存与工作进程预留，不能把各子模块的局部额度相加后仍声称受 8 GiB 总额保护。`platform/main/imageProjectLease` 通过独立原生 guard 持有固定 inode 的 OS 锁，同时持久记录 Main 身份。guard 异常退出关闭当前写门，但不发布正常释放；旧 Main 未确认退出时，新 guard 也拒绝接管，保护仍在途的文件副作用。正常 release 必须由调用方先排空义务，不能把锁失效当取消。当前仅本机 macOS 验证；默认产品入口尚未接入。

`platform/main/imageEngineWorkerOwner` 固定一个 Session 的原生 store 和执行程序。重启先同步隔离旧代请求及回包，确认自有旧进程退出并复核 writer lease 后才创建新代；并发重启合并，关闭或锁失效不能复活进程。每次协议准入同步检查 lease.held，文件写入/root 身份的异步复核仍属于 Main store，不给每批笔点增加一次磁盘检查。WorkerOwner 不清输入意图、不重放笔迹、不认领项目提交、不释放项目锁；新连接可用后仍须由 Main 按原账本恢复，不能直接开放用户绘画。

`platform/main/imageEngineOutput` 从 Main Session 的冻结快照取得目标原生引用，校验宿主导出回执的版本、文档、尺寸、格式、字节数、摘要和分层状态，再复核 Session 未变。仅返回捕获字节，不发布文件、不推进 head、不认证外部 Save。原生 export 只读取不可变版本，拒绝损失警告和无法保留的未知块；输出仍受独立传输预算约束。

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

工具按键由 `src/workbench/renderer/toolShortcuts.ts` 控制短按／长按及恢复状态，FlowEditor 在按键事件发生时检查 Session、绘画暂停、输出及手势准入；键盘不绕过关闭或输出保护。SketchPad 以现存草稿判断绘画手势，避免临时工具恢复后把抬笔误作选区结束。普通／日式布局读取同一个故事板 tile 偏好，Pending 尺寸独立；布局切换不创建第二份尺寸状态。

## 名称与数据

产品 `Storyboard Flow`，代码 `Flow/flow`，环境变量 `FLOW_*`。TIFF使用 `app: "Storyboard Flow"`、`format: "flow-tiff"`、XMP `flow:metadata`、命名空间 `https://storyboard-flow.local/ns/1.0/`。受管子项目标记为 `.storyboard-flow-project`。checkpoint位于 `.storyboard-flow/checkpoints/`：`project.json`、`assets/<sha256>.png`、`versions/<revision>.json`。旧目录/恢复数据不迁移、不自动删。

现行类型权威为 `src/platform/contracts/refactorV1.ts`及 `flowWave2.ts`。项目数组决定活动/Pending/对白顺序；图层自底向上。图层至少一层、尺寸匹配画布，opacity有限且在[0,1]，支持normal/multiply/screen。普通ID为受限ASCII，assetId为编码PNG字节SHA-256；不是像素内容hash。对白保留Unicode，不偷偷规范化。

Project中无绝对路径、DOM、data URL或像素buffer。未知版本/字段和非法引用拒绝，不静默丢信息。删除成员可保留未引用image以支持历史；资产、版本和原件不自动GC。

## Session与资产

Session是唯一可写作品权威；输入在异步边界前验证/快照，返回对象与调用方不共享可变数据。纯编辑失败/no-op不入历史，新编辑清redo；Undo/Redo恢复内容并产生新项目revision。历史保留资产引用而非像素副本，重开不恢复前进程撤销栈。

像素制作→真实depot入库→核心图像替换→历史安装。操作ID由Session产生，校验收据的session/operation/尺寸/asset身份，不接受renderer伪造完成结果。像素坐标不重复缩放；隐藏/锁定目标按核心规则拒绝。depot只读初始合法checkpoint引用或本会话成功入库资产，读取复核绑定/hash，成功重试也复查存在与完整性。

重型编辑有界排队，文字捷径遵守队列屏障，实际安装顺序决定Undo顺序。checkpoint去抖、最多一个在途及一个最新待存目标；r回执仅确认r，不确认其后的r+1。失败不回滚用户内容、不热循环假重试。freeze停止新编辑准入，等待已接纳操作与最新checkpoint；失败保持受保护状态，重试成功才可继续，超时不是取消。

checkpoint先验证/发布不可变资产和版本，再发布head。相同revision仅在逻辑内容相同才幂等；旧head不能覆盖新head。根目录/符号链接/临时路径/尺寸/哈希必须验证。预算是局部准入，不是全进程内存封顶；超限拒绝，不删历史腾空间。

同一画布的连续画笔／橡皮仅在所有在途 paint 均指向同板同层且无非 paint 请求、冻结、图层手势等保护时放行。保存期间继续绘制的例外只属于画笔；橡皮保持输出保护。

## 绘画展示与输入义务

Session 仍是作品与历史的唯一可写权威。`paintPresentation` 是每个 Editor 会话持有的展示 owner，两个 surface 仅订阅同一图层像素；不再从 DOM 抓取 LiveMirror，也不靠 hover 挂载接收首笔。输入身份包含目标板／图像／图层及 epoch；不可变资产使用裸 assetId。

每笔的 Session 回执把资产绑定到成功输入前缀。owner 在该资产解码并安装后才回收已覆盖记录，新草稿与未覆盖后缀各合成一次；重复资产和迟到解码不倒退当前代次。Undo、Redo、像素编辑和 Refresh 先建立展示屏障，遮住旧基底，缓冲屏障期间输入，待权威目标确认后继续。独立 surface 卸载不拥有清账权。

关闭与切项目先同步暂停绘画准入，再结算已有输入；freeze 后复检 owner 和其他编辑义务。失败恢复只在 Session 恢复 active 后重新开放准入。提交失败保留输入；确定无副作用时可由用户选择在当前画面重新叠画，未知／保留结果不重试。显式导出的 JSON 只是保留输入和错误的资料，不是可执行恢复对象，也没有自动导入路径；用户确认保存并明确放弃仅清理未确认输入，不回滚已安装作品。Session 错误保持原策略，不承诺跨进程持续显示。

局部预算为最多 32 条记录、总计 20 万点、单笔 10 万点及 3200 万像素。超限笔进入待处理状态，不自动提交前缀；用户可明确提交已接受部分或放弃重画。像素 owner 常驻三张画布，另有双 surface 副本、一个在途解码和一个最新待解码目标；3200 万像素时这六张画布约 732 MiB，不含静态图、生产器、URL 或浏览器缓冲，不是全进程内存上界。

## 对白提交与撤销

连续键入折叠要求同token、同目标、合法纯文本变化且间隔严格小于800ms；800ms断组。实现入口为 `src/session/core/grouping.ts` 与 `src/storyboard/renderer/dialogueBlocks/`。

IME候选只留本地，确认后提交。每个编辑器独立持有未确认提交义务；其他实例成功、卸载或超时都不能代为解除。失败保留最新意图供重试，旧回执不能清掉新请求；成功与宿主回显之间仍须保留用户回退意图。关闭在freeze后复检义务。具体状态机见 `dialogueCommitState.ts` 和 `dialogueBlocks/commitQueue.ts`。

## TIFF导入

入口只有一个文件夹选择器。主进程先用 `project-files/main/projectFolderEntry.ts` 分类：有 `.storyboard-flow` 且 checkpoint 可读 → 直接打开；有 `.storyboard-flow` 但标记不是目录或 checkpoint 读不出来 → 报错停止，不降级成图片导入；否则按直属 JPEG、PNG、受支持 TIFF 计数，有图片（含旧版 `.storyboard-workbench` 文件夹）→ 生成一次性创建草稿交给渲染层确认；两者都没有 → 报“没有可导入的图片”。分类只做只读探测，真正的创建仍走下面的创建事务。

“打开”只加载已有 Flow checkpoint，不会初始化用户选择的图片目录。由“创建”从多个文件或一个文件夹读取素材；文件夹只扫描直属 JPEG、PNG、受支持的 TIFF 并自然排序。入口当前只以文件夹为来源，多选文件仍只供 Pending 添加使用。新建空白项目走 `createBlankProject.ts`：与图片创建相同的暂存—checkpoint—独占发布—验证流程，只是不读来源、不写工作 TIFF，项目从 0 板开始。主进程持有来源绝对路径，汇总需要跳过或降级的素材供一次确认。在目标父目录内准备独立暂存项目、新身份、资产和已发布的 TIFF 绑定，再独占发布到新目录。失败时保留无法安全清除的暂存现场，不删除来源或覆盖已有项目。新文件夹名由项目名派生（`folderNameFromProjectName`），与来源目录同名时加“分镜”后缀（`projectFolderNameFor`）；渲染层只预览，主进程在创建前重算并校验。

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

## Photocraft 原件绑定与 PSD 输出

固定上游版本与组件协议见 [native/photocraft/README.md](../native/photocraft/README.md)。一次性 native worker 负责读取、合成和色彩转换，Main 校验输出和资源限制；这些限制不等同进程 RSS 硬上限。

复杂来源的 `LayerV1.sourceReference` 绑定既有 originals/ledger 的 originalId、digest、format 和显示 RGBA 摘要；复用原件保管，不依赖外部原路径。核心禁止修改受保护底图，打开、Save、关闭及 Refresh 校验来源和显示身份。受保护内容使用 v3 TIFF 包络，旧 codec 拒绝误读；无引用项目继续原有格式，不自动迁移用户项目。

`exportPsd` 绑定 Session 的稳定 capture、板与保管 PSD，原生 writer 在原文件模型追加新增绘画层，Main 选择目标后以已同步的同目录暂存文件和独占 hardlink 发布新文件。普通 Save 不改变语义。未知发布结果保留证据；Windows 目录同步沿用平台 skipped 契约，不承诺目录项断电持久性。

打包强制校验原生版本、目标架构、桥接源码摘要、二进制和许可清单回执。macOS 签名后更新二进制回执，再签外层应用；ZIP 校验实际 Mach-O/PE 架构及摘要。
