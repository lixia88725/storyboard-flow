# 架构与数据契约

Renderer workspaceController按本Session内不可变thumbnailId缓存已校验RGBA（最多128项/32MiB，LRU），合并相同ID在途读取，dispose释放；不缓存可写文档。NativeThumbnail在layout effect中同步安装命中缓存，NativeCanvas在layout effect中绑定已有正确帧；等待实时帧时仅呈现该目标图的缩略预览，实时帧ready后移除，透明像素不会叠上旧图。原FrameStore归属过滤与capture目标校验保持，缓存不是编辑或持久化权威。


## 原生图片发动机施工接点

本节为隔离施工树已落地的接点，不表示默认运行链已迁移；完整状态见 CURRENT。

`platform/main/imageEngineConnection` 独占一个原生子进程及单个在途请求，启动等待也占用容量。发送前快照输入；stdout 使用有界长度拆包，握手和响应核对 session/incarnation/workerEpoch/request/operation 身份。通道断裂只报告 unknown，不能证明原生操作取消，调用方仍负责结算。日志与图像协议分流，Main 不把二进制通道直接暴露给页面。握手 capabilities 显式标记 `recoveredCandidateAcceptAtInstalledVersion` 和 `strokePipelineV1`；缺省按不支持处理，不能凭 protocol=1 推断新恢复语义。

`drawing/renderer/image-engine/frames` 安装完整帧或连续增量，透明像素绝对覆盖，身份切换显式 reset。Canvas Adapter 只呈现该共享 FrameView，无第二份正式绘画计算。Main 到 renderer 当前为结构化克隆；只在脏区域复制，不宣称跨进程零拷贝。

连续绘画协议区分 `imageVersionRef` 已接纳前缀和 `pendingOperationIds` 未 durable-accepted 的完整笔链；`workingHeadOperationId` 等于待确认链尾，活动笔另用 previewId。pipeline 开始/结束及笔画取消会提升展示 epoch；同一 pipeline 内取消不改变 pipelineId。取消回执绑定 previewId/pipelineId/durable=false/epoch，Adapter 与 Main 分别核对旧 epoch+1 并更新；回执缺失或身份不符保留输入，不能在下一笔时接受任意 epoch 来掩盖失配。确认取消后主动capture恢复画面，不只等待下一次落笔刷新。pending 为空也不能替代项目 checkpoint/Save 成功判据。帧接收器只验证展示身份，不承担项目持久化认证。原生异步队列已实现：输入线程与持久化线程分开，四笔有界队列，失败冻结依赖链而不自动重试。Main项目接纳已接入独立试用路径，默认启动入口保持原路径；验证状态见CURRENT。

绘画准入的恢复由Session请求队列统一收口：所有控制请求在finally释放计数，只有active且无待处理barrier才恢复；pipeline故障独立保留，普通resume不能清除。Renderer的capture暂停由Main phase与各操作自身暂停理由共同推导，保存/恢复操作结束仅释放自己的理由，不复制一份可永久滞留的Session暂停状态。

后台只读InspectVersion/ExportImmutable的明确无副作用limit/unsupported/engine错误只终止该任务；存储、损坏、协议和未知结果继续走全局保护。缩略图失败按图片版本记录展示notice，避免反复渲染重试同一失败；显式恢复可重试，失败不改变编辑能力或持久画面。Adapter将原始故障code/message/command传到Session有界诊断，临时busy与pipeline-blocked不再共用sealed文本。

正常关闭先暂停后台生产并等待已开始任务，再核对故障Session、排空绘画、冻结认证；有保留的未完成输入或未知文件/编辑操作仍不授关闭票据，不自动丢弃或重画。核对无Main决定的durable笔迹沿既有恢复语义保留原始intent，不能把原生prepared当作项目已保存。

Main 连续绘画由 `session/core/nativePipeline` 捕获有界原始输入，Adapter 短命令调度与持久化分开；最多连续八个输入命令后给等待中的控制命令一次机会。end 同步预约唯一混合历史/CAS 队列位置，v2 intent 固定锚点与前驱。CAS 成功后转入独立的原生接纳 FIFO；后一笔 accept 必须等前一笔 durable nativeAccepted，不能将 acceptQueued 当成功。Main 确认队列最多持有四个额度，每批 1..4 笔；确认事实进入下述统一日志，不再逐笔创建确认文件。waitOperation 仅在最终确认后完成，原生接纳不等于最终保存回执。

ProjectStore 保持原 Interface，Implementation 改为 `journalProjectStore` 与 `recoveryJournal`：完整输入、项目 CAS、无变化决定、hydration、确认和 resolution 进入单写者追加日志。每组绑定序号、前组摘要与完整封口，同步成功才公布持久状态；项目 head 从日志派生，不另写第二份权威。后续验证未完成不阻止已准入组的定时 flush；2ms 是调度触发间隔，不是事件循环的实时期限。未知支出保留到关闭准入并排空后的 audit。外部 native/source/output 写入须保留完整固定额度或接入等价实际加预留账本，不能只报告瞬时在途字节；正式全局协调器尚未接入默认产品。

日志位于 `.storyboard-flow/image-project-journal-v1`，旧 V2 head 位置存不兼容 writer gate。仅本次新建 gate 的流程可创建首段，既有 gate 缺首段、缺目录或缺初始记录一律拒绝，不猜成空项目，也不原地迁移旧格式。正常中断的末尾未封口组保留原段：同步有效前缀、创建并同步新段，再独占发布绑定旧文件摘要/有效长度/前缀的新段清单并同步目录，之后才准入。完整封口损坏或中间异常拒绝；恢复所有格式与历史引用验证完成后才替换内存状态，失败保留旧 head 并停写。

关闭、Undo/Redo、冻结均排空相关义务；恢复按实际前驱拓扑核对多笔后缀，不按文件名排序，不重画已接纳笔。无变化版本仍写绑定可达 head 的独立决定，不制造假 Undo。完整 intent 持久化仍在 native finish 之前，后续预览可能等待该次 fsync；新流水线的实际节拍必须单独实测。

项目 V2 在 `platform/contracts/imageProject.ts` 定义图片内容联合引用：source 指向固定来源及解释身份，native 指向 store/document/version/manifest 摘要；项目不保存另一份可写 PNG 图层树。后台 hydration 写持久派生索引，不改变项目引用、不产生用户 Undo；第一笔才由 source 引用变成新 native 版本，撤销可回到同一固定来源解释。

`session/core/snapshotHistory` 为 V1/V2 共用的唯一历史算法。新路径先 prepare 历史计划，Main 的 V2 store 发布可达 commit/head 后再 commit 同一计划；native accepted 是项目决定后的结算，不是项目提交权威。孤立 commit 文件不自动认领，未结算 native 决定单列恢复账本。当前重开继续沿用清空进程内 Undo 栈的行为，不声称已实现跨重启 Undo。

V2 store 的 writerAuthority 必须由 Main 注入；同进程 Map 与恢复目录保护都不等于跨进程锁。全项目恢复预算包括实际留存与工作进程预留，不能把各子模块的局部额度相加后仍声称受 8 GiB 总额保护。 Runtime中Sources、Output、journal与lease共用同一根预算；journal按组真实编码增量预留并在同步完成后结算，未知写入保留额度，严格重放后按独占日志目录实际增量核对。Native store额度单独完整保守预留，不把固定小额来源分区当并发限流。`platform/main/imageProjectLease` 通过独立原生 guard 持有固定 inode 的 OS 锁，同时持久记录 Main 身份。guard 异常退出关闭当前写门，但不发布正常释放；旧 Main 未确认退出时，新 guard 也拒绝接管，保护仍在途的文件副作用。正常 release 必须由调用方先排空义务，不能把锁失效当取消。当前仅本机 macOS 验证；默认产品入口尚未接入。

Source保管出现未知结果时，Runtime先停止新保管工作，沿Sources现有操作核对磁盘与保留额度，再恢复处理；不能直接close/reopen绕过未知写入。恢复先排空已接受的绘画决定，保留当前NativeRef及撤销记录，失败的图片解码仍单独报告，不被一次恢复成功回执抹掉。

`ProjectImageV2.protectedSource` 绑定完整SourceRef、原件摘要/长度/格式和参考RGBA摘要；hydration的同一日志事实保存Native policy与显示对照proof。第一次source→native CAS、后续编辑、复制和历史都保留此关系；Native版本小记录校验不读取整张原件。受保护底图和祖先不允许改动，上层可画。Main私有displayTolerance=8包含在解释指纹中，轻微色差不制造只读保护。

普通Save在输出意图之前对不同受保护SourceRef各执行一次 `Sources.object(ref,{verify:'full'})`，复用唯一目标核验入口，不扫描整批；之后capture核身份与固定Native版本policy。Native导出必须收到匹配的expectedSourcePolicy，工作文件含独立有界`flow:sourceReference`包络及摘要，既有对白/遮幅元数据不改。该说明不包含路径、不授权寻找任意外部原件；无Main来源绑定的再次导入明确拒绝。 同项目工作TIFF取回时，Main可提供已核验的旧版本及保护policy作为授权；Native核对工作文件来源标记和未改变的参考底图，允许上层改动，并在候选版本持久绑定本次工作文件摘要/长度。新加载的运行时图层ID不作为原件身份；候选仍在Main项目决定之后结算，不能凭外部标记自动寻找原件。Save结束恢复Session后重新capture当前画布，不能只改快照而缺少新代像素。

显式 Save 由 `workspaceFiles` 绑定冻结 commit、全部活动/Pending 板的精确原生版本与唯一 Output 操作 ID，先记 `fileIntent`，核对持久 Output 完成收据后记 `fileResult`。结果只推进已保存状态，不创建作品历史。重开沿原请求查询或恢复；不拿当前版本代替保存时的版本，未完成的文件义务继续阻止关闭认证与副本准入。后台派生尚未绘画的 SourceRef 在保存时解析输出，不因此变成用户编辑。

工作TIFF显式强制写出真实图层记录，包括只有一个锁定Background的普通PNG/JPEG来源；不能因导出器可简化为平面图片就把带层成功回执交给文件模块。输出后仍核验层数据标记、损失警告和元数据。

后台输出使用固定、不可变的Native版本，不切换当前绘画上下文。编码结果分块读取，未结算结果占有明确额度；发生未知回包时先排空同代只读任务，确认旧任务释放后，Output才允许同UUID、同冻结输入的capture重试。已完成的私有capture按摘要和物理身份复用，未发布的字节不算工作文件保存成功。

Output的外部观察绑定板、文件名、位置、物理身份和基线Native版本；`observeSource`再次核对观察并提供给唯一Sources保管。选择保留Flow前验证外部原件已完整保管，文件缺失只授权后续独占创建，不能覆盖后来出现的文件。物理基线回执可按历史摘要查询，不因外部再次改动而抹掉既有确认；单批Pending输出回执不推进整项目保存版本。

完整且已关闭的项目副本通过 `prepareWorkspaceColdCopy` 显式读取封口 Main 历史、已完成文件义务、Output 全链和托管文件摘要后产生授权；不是清锁或重写原账。只有 root 物理身份不同的完整副本可走此授权，同root换锁不借此修复。原生 guard 在新 root 的 OS 锁下复核目录/锁身份与原释放标记摘要，先独占保管旧标记和授权，再发带 `copyReceipt` 的新 owner。Output 核对同一收据并追加新的物理绑定与前一 head 的关系，保留旧记录；中断后继承同一收据补完，不重复发布。运行中的 root/lock/文件替换仍拒绝。Main 与 guard 共用预算，lease 保留释放所需额度至正常 release，整根目录 audit 在释放后执行。正式 Runtime 接线及真实已保存项目复制验收状态见 CURRENT。

`platform/main/imageEngineWorkerOwner` 固定一个 Session 的原生 store 和执行程序。重启先同步隔离旧代请求及回包，确认自有旧进程退出并复核 writer lease 后才创建新代；并发重启合并，关闭或锁失效不能复活进程。每次协议准入同步检查 lease.held，文件写入/root 身份的异步复核仍属于 Main store，不给每批笔点增加一次磁盘检查。WorkerOwner 不清输入意图、不重放笔迹、不认领项目提交、不释放项目锁；新连接可用后仍须由 Main 按原账本恢复，不能直接开放用户绘画。

`platform/main/imageEngineOutput` 从 Main Session 的冻结快照取得目标原生引用，校验宿主导出回执的版本、文档、尺寸、格式、字节数、摘要和分层状态，再复核 Session 未变。仅返回捕获字节，不发布文件、不推进 head、不认证外部 Save。原生 export 只读取不可变版本，拒绝损失警告和无法保留的未知块；输出仍受独立传输预算约束。

原生上下文通过显式能力 `toolContextSummaryV1`、`contextLayerSelectionV1`、`floatingGestureV1`、`decimalLayerIdsV1` 准入。图层 ID 跨 Node 边界一律规范十进制字符串，避免 JavaScript 数值精度丢失。选层更新上下文代次，不制造作品版本或 Undo；浮动选区以 previewId、代次和输入序号绑定，取消恢复起始像素并提升展示 epoch，接收器须显式 reset，不能接受旧代增量。当前 summary 整体受 48 KiB 限制，超限拒绝，尚未分页；不是默认工具栏已接入。

同 Main 恢复通过 Adapter 的可选 WorkerOwner 替换自有原生进程；原 Main 历史、待提交计划及项目 head 保留。先隔离旧代并确认退出，再排空 Main 输入记录写入，以唯一可达项目决定核对 native 状态，不自动重放。恢复结果区分 committed/notCommitted；完整原始意图通过 operationRecords 分页读取。未取得 ready 身份或未抬笔的缓存仍是显式 recoveryPending，不能算恢复绘画成功，也不能据此正常关闭。

### 正式界面接点（隔离施工）

`workbench/renderer/image-engine/workspaceController`只接受Main快照和类型化意图；展示帧经身份绑定的MessagePort进入FrameStore，不向React逐批回灌像素。display delta独立覆盖展示身份，完整快照可在相同stateSeq安装；旧显示事件不能覆盖较新快照。`drawing/renderer/image-engine/capture`在pointerdown同步保留完整输入，异步IPC的admitted不代表持久成功；冷目标使用归一化坐标，恢复记录保留其坐标空间。captureId/inputId/attemptId分别绑定手势、逻辑输入批次和明确无副作用的重试；未知回包不盲重发。

`platform/main/imageWorkspaceIpc`只负责窗口认证和端口转换，帧节拍与确认属于Runtime。`imageWorkspaceLifecycle`在打开候选前冻结旧Session，候选就绪后由旧Session认证关闭；候选失败恢复旧Session。候选关闭未知则保留对象并阻止下一次切换/退出。renderer各操作通过具名暂停集合协调，不能用一个boolean互相解除关闭与输出门禁。

图层名称草稿、透明度和选区变换由 controller 生命周期内的独立手势 owner 保管，组件卸载不清除未结算输入。预览始终基于固定起始版本；移动事件可合并，松手只提交一次历史编辑，取消需取得对应代次的原生回执。失联或未知结果保留最后接受的完整意图，只有明确的持久保管/结算回执才能解除其关闭义务。

工作区导航携带 Main 的不透明 context token；上下文语义变化才更新，展示帧不更新。暂态请求使用有界完成缓存，`completed` 仅证明当前进程已执行上下文操作，不等于项目持久提交；未知请求保留原文和关闭义务。恢复记录按类型与序号分页，单页至多读取16条原文，导出经Main选择器且不重放或删除记录。

`workspaceSources` 统一来源清单及逐文件调度，后台每个文件之间可让当前查看项优先。目标使用入口明确区分 manifest-only 与内容已验证：只登记身份不能证明图片可用，实际目标仍必须核完整摘要，native读取payload再次核长度和摘要。旧 SourceStore 默认整批核验入口保持原契约；快速路径不把未读取的其他原件标成已验证。

`workspaceImportJobs`按统一journal中的批次意图调度现有项目新增：登记一次项目CAS后立即回执，保管、hydration和只读固定版本输出在前台输入门之外继续。物化前复核当前Pending成员及来源绑定，Undo/删除不被后台重新登记；坏图以持久待处理项保留，关闭只等真实在途副作用。

`workspaceRefresh`拥有Main私有观察计划和选择；`workspaceRefreshFacts`验证同一日志中的意图、项目决定和物理ACK。所有采用外部版本通过Core单批替换形成一次混合历史，再结算原生候选及Output基线。CAS后外部再次变化不能回滚已接受画面：先查询历史ACK，确认观察已失效时记新观察证据并结束旧ACK重试，允许显式重新检查。Output可只读强制观察指定仍受管板，即使其字节恰好回到旧基线，也不隐藏这次未解决选择。

`platform/main/nativeProjectEntry` 将命令行、最近项目与文件夹选择统一接入只读分类/计划；旧项目只能走显式副本升级。`imageWorkspaceWindow` 将窗口认证、端口绑定与唯一Runtime生命周期收敛在一起。初始打开前安装close守卫，renderer准备好后重放待处理关闭；候选关闭失败保留在独立集合，须经认证的恢复入口结算，不能靠关闭当前项目掩盖。复制发布后丢回包的同操作重试先核对完成凭据，不再依赖原来源仍在原位置。

Main只从当前worker/当前文档的完整验证帧推进display identity；旧worker、旧epoch和旧frame序号不能替换展示目标。只在身份变化时发display事件，逐batch像素仍经帧端口，不触发项目保存或逐批图层summary。普通图层编辑在RPC开始前取得请求身份，未知回包只查询该请求或保管整份原始意图；原文保管回执与身份匹配并重新读取权威快照后才解除renderer义务。

绘画的 nativeAccepted 会推进原生 contextGeneration；Runtime 同步 Adapter 已验证回包中的代次到当前同文档 context/summary，不逐笔追加 summary RPC。同一板、同一图层、同一 worker 的连续绘画保留常量空间代次区间，仅用于接纳已经排队的 begin；选层、选区、图层编辑、预览结算、导航和恢复重新确认上下文后清除该区间。图层编辑、选层与预览仍严格校验精确代次，不能用画笔别名重定位旧操作。


`project-files/main/image-engine/workspaceOutput` 仅维护物理输出账本：冻结的项目决定、原生捕获字节和元数据决定新文件，所有旧名先暂存再独占发布，删除沿用系统废纸篓确认协议。内部输出日志、备份和未知支出使用共享恢复预算。Refresh 先由 Main 安装项目决定，再确认外部文件摘要成为物理基线；该确认不另行安装项目，也不冒充 Save。Session 已认证关闭但资源释放失败时，保留关闭票据，后续只重试释放，不重复认证或恢复已关闭 Session。

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

入口只有一个文件夹选择器。主进程先用 `project-files/main/projectFolderEntry.ts` 分类：有 `.storyboard-flow` 且 checkpoint 可读 → 直接打开；有 `.storyboard-flow` 但标记不是目录或 checkpoint 读不出来 → 报错停止，不降级成图片导入；否则按直属 JPEG、PNG、受支持 TIFF 计数，有图片 → 生成一次性创建草稿交给渲染层确认；两者都没有 → 报“没有可导入的图片”。分类只做只读探测，不检查已退役的工作簿标记，不向创建草稿传递旧版标志；真正的创建仍走下面的创建事务。

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

### 大项目展示与绘画优先

Runtime每次展示投影只取一次Session项目快照，图片、当前选择和导入批次复用该只读快照，公共结果仍保留防御拷贝。Pending批次资格检查一次建立成员索引，不在每张图循环内重复读取完整项目。落笔能力检查只投影当前图片。

来源保管、非当前图解码和缩略图在任务边界让已接受绘画先行，正在执行的原生事务不被抢断；停笔后继续后台任务，恢复/关闭不永久等待失败笔迹。后台进度合并通知，绘画确认和显式操作仍即时发布，关闭释放通知定时器。这不是对全进程CPU或RSS的硬限制，也不保证大文件单次原生任务可抢占。

Main绘画决定失败保留有界运行诊断（operationId、阶段、commitHash、错误code/message/effect），不改变作品或恢复日志磁盘格式；原始原因不再被通用recoveryPending结果吞掉。UI按笔迹、Session恢复、来源/输出恢复区分入口，不改变原有结算条件。

工作台缩略图由Runtime的可见图片需求与版本跟踪驱动：待处理集合承接并发4任务之外的需求，任务结束补调度；Session发布时仅对需求版本变化入队，不靠Renderer重复发送相同板ID。旧版本在途结果不会绑定新版本，其完成后补最新需求。缓存仍限64张，预览不作为编辑或保存权威；Renderer同image的canvas在异步替换期间保留，换image清空。


### 原生工作台落笔准入与准备队列

`capture` 在创建输入前通过 `checkTarget` 检查已知目标，发送 begin 前再通过 `resolveTarget` 核对。具体目标不重新绑定；只有 layerId 为空的临时候选可在激活原目标板后绑定。该候选仅在无 operationId、未发送数据、从未尝试 begin、worker 身份未变，且明确收到 `paint-layer-unavailable` 的未准入结果时解除；其余失败保留输入。`beginAttempted` 在 IPC 前设置，传输失败不算未开始。NativeCanvas 同步结束已解除候选的本地手势。Runtime 对当前已就绪板的重复激活保持上下文，其他激活仍经过原 barrier。

`workspaceJobQueue` 分别串行调度 hydration 和 immutable 工作，优先级在出队时读取，每第五次选择最早等待项以避免饥饿。同图 hydration 共享 Promise；前台 activate 在等待期间登记引用计数，使尚未成为 activeShot 的目标也能提升优先级。去掉按队列长度拒绝冷图的路径，恢复后重新登记仍可见且未完成的需求。后台让路只发生在任务边界，250ms 是等待 captures 的上限而非原生渲染时限；未抬笔的现有准入限制仍保留。不可变 prepare 缓存可减少随后 inspect 的重复工作，但缓存未命中时仍可能全尺寸合成，尚未加入原生低分辨率专用渲染。


新图片宿主的可编辑源文件上限为32MiB；受保护TIFF另附独立显示PNG最多32MiB，两者合计不超过现有64MiB wire payload。Main的普通/保护来源读取、工作TIFF重新读取及workingInput校验与native普通/后台preflight同步；原16M像素、图层解码和项目总预算不因此放宽。Source保管层的128MiB上限不等于全部字节范围都已支持编辑。普通未准入绘画提示只在对应目标重新可画后清除，不自动清除持久化失败或未知结果。

当前图层工具准入与原生前台命令使用相同范围：其他图片的 detached source 准备不阻塞当前图层；尚未结算的前台编辑、存储错误和未知状态仍拒绝输入。Summary使用存储Owner的前台操作快照，不能把后台素材的全局未结算状态缓存成当前图层不可画。Freeze/Close仍核对全部后台和前台义务。

原生文档存储默认在8GiB项目恢复总额内预留1GiB（此前512MiB不足以容纳TEST2的304张1920×1080故事板）；这是磁盘总额预留，不是常驻内存额度。原件、输出、记录仍共用剩余总预算，超限不自动删历史或恢复数据。

原生Store显式持久化已有slices字段，避免上游以空user-slice列表省略非空组名。读取当前引擎曾生成的缺字段快照时，先验证原摘要及资源；仅唯一合法1050且全部为自动切片时，从其原字节恢复内存组名。显式slices（含空值）优先，不猜重复/损坏/用户切片；不改旧版本文件，不放宽输出opaque资源校验。

来源准备恢复以operation身份区分尝试：只有旧尝试的native状态明确absent/failed/discarded，且当前derived决策属于不同operation时，才将旧尝试单独结算为notHydrated；不修改新尝试、不重发/接受副作用，其他不明确状态仍拒绝。文件恢复UI和画笔捕获准入读取Main的`files.status=unfinished`，不依赖可选旧`recovery`字段；当前正在执行的输出不展示重复恢复警告，Main的文件闸门仍是最终准入依据。
