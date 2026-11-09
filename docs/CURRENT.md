# 当前状态与剩余工作

## 落笔准入与大批预览调度（2026-11-09）

已集成隔离候选：预览队列 `b2fd864`/`33c9c0f`，落笔准入 `7d12b1f`。已知不可绘画层在创建输入前拒绝；未激活板的临时输入只在明确从未发送且身份不变时解除，未知/已尝试发送仍保留。当前就绪板重复激活不重建context。hydration和immutable工作按前台目标/可见/后台动态排序，保留超额需求并防饥饿；恢复补需求，失败有终态。此前用户截图的具体分支没有足够日志，不把这些复现当成每次现场故障的唯一原因。

组合构建通过（`/private/tmp/flow-admission-combined-build.log`）。旧dist真实窗口红回归证明锁定层点击仍发送begin（`/private/tmp/flow-admission-combined-red2.log`）。修后最终300图组合通过（`/private/tmp/flow-admission-combined-gui-final2.log`，`flow-native-workbench-sD2Df4`）：2.426s进入、首笔时300项仍后台处理、连续12笔；已激活及未激活锁定板点击均零begin/零编辑/无恢复记录；250ms激活延迟下第80/160/240张queued静态卡直接落笔各只提交一笔、其他板不变；正常关闭重开一致。rAF p95约9.9ms/max24.9ms，停笔后后台保管完成仍需41.195s；本次与完整测试并行，合成PNG/JPEG不代表复杂TIFF/PSD。首轮因未传native环境变量未启动，日志保留，不计产品失败。

邻近日常GUI通过（`/private/tmp/flow-admission-combined-daily.log`，`flow-native-workbench-cZb8Kb`），覆盖Save/Refresh/Undo/恢复/正常关闭重开。完整获准清单151文件/1605项通过，504.61s（`/private/tmp/flow-admission-combined-suite.log`）。原生全尺寸合成成本没有消除，单个在途任务不可抢占；真实TEST2整批耗时、Windows及数位笔待验。状态机只读审计见 `/private/tmp/flow-state-machine-audit-20261109.md`，涵盖运行模块及边界，不声称穷举第三方内部状态。README启动入口、AGENTS授权规则未变，无需修改。未合main、推送或发布，未处理用户恢复数据。

试用启动器再次完整构建并启动，日志 `/private/tmp/flow-admission-trial-launch.log`；本次未发现需正常关闭的旧实例。原生窗口检查工具两次连接超时，未取得选择页截图，不将其计为可见页面确认；独立合成窗口的端到端证据如上。未自动打开用户项目或点击恢复按钮。


## 切图时画布准备提示闪现（2026-11-09）

目标图的NativeCanvas随shot重新挂载，初始preparing先呈现，且此前静态预览被卸下，形成切图空档。本轮加入Session内有界缩略图缓存及同步安装、目标预览到实时画布交接；没有改编辑目标、文件流程或隐藏实际故障。

构建通过（`/private/tmp/flow-switch-build-final.log`）；controller聚焦18项通过（`/private/tmp/flow-switch-focused.log`）。真实Electron切图专项通过（`/private/tmp/flow-switch-gui-final5.log`，`flow-native-workbench-Wd1XdB`）：250ms激活延迟下六次交替，逐帧目标预览非空、左右两侧均无加载文字，透明绘画板与白板不串图，撤销、新进程重开和正常关闭保持。首次沙箱实例SIGABRT未启动；其后脚本先遇到退出早于receipt、再遇后台rAF无采样，均保留失败日志；修复脚本同步落receipt及测试实例后台节流后通过，未弱化像素断言。日常真实Electron回归通过（`/private/tmp/flow-switch-daily.log`，`flow-native-workbench-aSznpD`），覆盖绘画/Save/Refresh/Undo/恢复/关闭重开；其后仅让缩略图在ready画布背后预备，完整build及上述切图GUI复验通过。完整获准清单150文件/1591项通过，520.69s（`/private/tmp/flow-switch-suite.log`）。README启动说明及AGENTS规则不变，无需更新；尚未合main/推送/发布。首次没有预览或缓存已淘汰的图片仍需读取；不宣称所有首次切图零等待。

启动器完整构建并启动修复版，本次未发现需要关闭的旧实例（`/private/tmp/flow-switch-trial-launch.log`），原生UI确认新版工作台窗口可见；未自动点击用户项目或绘画、未处理恢复记录。当前仅隔离试用分支。


## 可见预览排队与画后更新（2026-11-09）

用户报告诊断版绘画不再报错，但可见卡片长期准备中，画后已有预览消失。已查明Runtime超过4任务直接丢需求，Renderer需求只含板ID，版本变化不会重需，旧版本任务完成也不补新版本；另有local thumbnail notice未显示。当前工作区增加待处理队列及Main可见版本跟踪，保留同图旧canvas至新预览就绪，失败显示终态。

最终聚焦四项真实Runtime测试通过（`/private/tmp/flow-thumbnail-focused-final.log`），含66次绘画不淘汰旁边可见板及显式恢复重试；完整构建通过（`/private/tmp/flow-thumbnail-build-final.log`）；最终真实Electron日常GUI通过（`/private/tmp/flow-thumbnail-daily-gui-final.log`，`flow-native-workbench-fo1xxS`），追加画后无需视口变化自动更新thumbnail，原有Save/Refresh/恢复/关闭重开断言保留。首轮全量为补缓存/恢复边界主动停止（exit130，`/private/tmp/flow-thumbnail-suite.log`），不计完成；最终完整获准测试集150文件/1589项全部通过，516.43s（`/private/tmp/flow-thumbnail-suite-final.log`）。未合main/发布。前一轮实际native写入失败根因仍未确定，不因本次用户未再遇到提示宣称其已解决。

启动器正常关闭旧试用实例，完整构建后打开修复版选择页，原生UI已确认；未自动打开用户项目。启动日志 `/private/tmp/flow-thumbnail-trial-launch.log`，旧实例正常退出留在 `/private/tmp/flow-pipeline-receipt-trial-launch.log`。README启动入口与AGENTS规则未变，无需更新；本轮仅本地试用分支，未合main/推送/发布。

## 试用重开首笔再次失败：继续诊断（2026-11-09）

用户在af04177试用版重开后再次遇到笔迹保留提示，不能称前轮已解决用户现场。启动日志 `20261109-131629-27947.log` 的操作 `dff8323d-93bf-4055-9e8e-5a7a574a0f85` 在waiting-prepared报protocol/malformed prefix。已查明adapter把native `failure` 事件混入prepared校验，遮蔽原始错误；当前工作区修正其传递（仍保守保留输入），真实连接注入失败回执测试3项通过，构建通过，尚非本次实际根因修复。

只读现场见native intent而无prepared，随后有同doc14的新tile/version，故重点检查图像发布末端与prepared日志写入；不能凭时间关联断言具体失败函数。原store约64.45MB，低于512MiB上限；同持久资产副本、同铅笔参数及合成坐标的完整begin/append/end/poll成功。隔离副本追加原生历史segments1..7（失败后8/9另行保管）及4次取图穿插仍通过，日志 `/private/tmp/flow-native-history-beforefailure.log`，副本 `/private/tmp/flow-native-history-probe-r7ghx4v8`；不回放用户笔迹。原始故障仍未复现。用户明确允许保留记录并重启后，已通过原生UI选择“保留恢复记录，结束本笔”，再点击窗口关闭，旧启动日志确认正常退出；没有强制退出或清理恢复数据。随后启动诊断版，原生UI确认项目选择页，未自动打开项目，日志 `/private/tmp/flow-pipeline-receipt-trial-launch.log`。诊断补丁随后随上方预览修复通过完整获准测试集；实际写入故障仍待再次重现获取原文，不宣称根因已修复。

## 绘画准入、局部故障与正常关闭协调（2026-11-09）

本轮继续保留PhotoCraft，在隔离试用树整理协调逻辑，未合main或发布。已确定并复现：只读thumbnail超预算的limit/none被native通用任务错误标成globalFailure，Session随之recovering，后续笔迹被报sealed。修复将明确局部只读错误与全局存储/协议故障分开；Session集中释放控制暂停，Renderer按Main phase与操作自身理由推导输入暂停；缩略图失败按版本记录提示，避免同版本重复失败。关闭先等待后台并核对故障，再排空/冻结；未完成原始输入仍拒绝关闭并保留。

用户TEST2现场具体初始异常仍不能还原，不能将合成预算错误当作现场直接原因。独立只读核查及不可变资产副本实测65/65版本检查通过，首板doc3/b99807b7的activate/summary/pipeline begin/append/cancel/stop也成功；未复制用户输入或运行锁，未改原项目。没有新durable intent只能证明输入未落盘，不能排除Main曾易失准入后失败。新增原始code/message/command诊断保留故障链。旧试用PID16624后来已退出，启动日志记SIGKILL，非本轮工具关闭，不称作正常关闭证据。

真实host红回归在旧binary失败（`/private/tmp/flow-coordination-local-failure-red.log`）。最终聚焦5文件57项通过（`/private/tmp/flow-coordination-focused.log`），Rust lib分类1项通过（`/private/tmp/flow-coordination-rust-tests-final.log`）；此前bin目标0 tests不算该项验证。追加Main phase暂停及未完成笔迹拒绝关闭聚焦通过（`/private/tmp/flow-coordination-gates.log`）。构建/固定Rust原生release/组件强校验/preload通过（`/private/tmp/flow-coordination-{build-final,native-build,resources,preload}.log`）。工具链与锁定依赖仅恢复到本次任务目录，未改全局配置。

真实Electron日常组合通过（`/private/tmp/flow-coordination-daily-gui.log`，`flow-native-workbench-DR5IfY`）：加载中绘画、Save/Refresh/Undo/Redo、同窗故障恢复、空闲故障后不另点恢复而正常关闭、新进程重开并继续画，原件及保存文件核对不变。300图专项通过（`/private/tmp/flow-coordination-300-gui.log`，`flow-native-workbench-0yvYNr`）：2488ms进入，首笔时298张仍后台处理，12笔确认，rAF p95约9.8ms/max17ms，脚本整笔269–327ms；停笔后保管完成仍需46409ms，不称整批瞬时导入或硬件笔延迟。完整获准测试集150文件/1584项全部通过，501.22s（`/private/tmp/flow-coordination-suite.log`）。Windows/真实数位笔、实际用户故障的精确时序及任意复杂素材不在以上完成证据内。

通过隔离树的 `试用新版 Storyboard Flow.command --choose` 再次完整构建并启动；原生UI确认项目选择页及“打开…”、“新建项目…”，未自动打开最近项目或处理用户恢复数据。启动日志 `/private/tmp/flow-coordination-trial-launch.log`。试用窗口保留给用户；README入口说明及AGENTS授权规则未变，无需修改。

## 大批导入期间绘画响应与恢复提示（2026-11-09）

已去掉展示循环内重复整项目防御拷贝：一次snapshot共享一份Session项目，批次资格检查复用成员索引，落笔仅投影当前图。后台来源保管/非当前图准备在任务边界让已接受笔迹先行，普通进度合并通知，绘画确认与显式命令即时发布。没有取消原件核验、修改保存确认条件或删除恢复数据。

300图快照预算测试在旧Runtime失败（`/private/tmp/flow-responsive-snapshot-red.log`），修后通过且外部修改返回值不污染Session。主进程同脚本对照为“向已有项目添加300张320×180图”，不冒充初次导入：背景整笔确认中位6225.85ms→约151ms，落笔准入341.02ms→约2.84ms，快照673ms→约2.5ms；前后结果为 `flow-native-workbench-tOQm1t` / `flow-native-workbench-cmouO3`，命令日志 `/private/tmp/flow-responsive-runtime-after.log`。该对照在通知合并/任务让路之前，不能当最终硬件延迟。

最终真实Electron通过文件夹入口导入300张960×540 PNG/JPEG；约2753ms进入，第一笔时297张仍后台处理，连续12笔确认、像素改变、原件摘要不变、正常关闭重开画面和revision一致；Renderer rAF间隔p95=10ms/max26.7ms，整笔脚本中位309ms（含128ms移动、IPC与轮询）。停笔后原件保管完成还需45602ms，不能宣称整批导入已瞬时完成；本轮完整测试集同时运行，有CPU/IO竞争。日志 `/private/tmp/flow-responsive-300-gui-final.log`，现场 `flow-native-workbench-wHErwT`。首轮同专项 `flow-native-workbench-UiZooR` 亦通过，最终追加了后台完成断言；不把保持后台暂停当流畅。邻近日常GUI保存/Refresh/后台添加/自有worker中断恢复/正常关闭重开通过（`/private/tmp/flow-responsive-daily-gui.log`，`flow-native-workbench-8CLwBR`）。

恢复提示只读核查了profile明确指向的304图TEST2项目：一笔有native prepared、Main未提交，后续已保管原始输入并结算；没有独立Save/Refresh文件失败证据。Session recovering原先也被称为“文件操作需要确认”，现避免与待处理笔迹重复；独立文件恢复仍显示并说明等待原因。Main原异常曾在catch中丢失，无法证明该笔失败由后台加载造成；新增有界operation/stage/code/message诊断，不更改磁盘格式。未操作用户恢复按钮或画稿。

构建通过（`/private/tmp/flow-responsive-build-final2.log`）；聚焦3文件84项通过（`/private/tmp/flow-responsive-focused.log`），含原生CAS回执丢失后错误诊断与恢复、快照/输入安全及恢复UI分组。完整获准清单150文件/1580项通过（504.77s，`/private/tmp/flow-responsive-suite.log`）；preload检查通过（`/private/tmp/flow-responsive-preload.log`）。当前仅隔离试用分支，未合main/推送/发布，Windows、真实数位笔和300张复杂TIFF/PSD不在本轮证据内。

## 移除旧版工作簿识别与提示（2026-11-09）

已移除 `.storyboard-workbench` 专用探测、创建草稿 legacy 字段和旧版迁移提示，带该目录的图片文件夹按普通图片文件夹处理。原文件及当前 Flow 项目损坏保护不变；本轮没有修改卡顿或恢复提示逻辑。

完整构建与 preload 检查通过（`/private/tmp/flow-remove-workbook-{build,preload}.log`）；真实隔离 Electron 入口七阶段通过（`/private/tmp/flow-remove-workbook-gui.log`，`flow-project-entry-bsl441`），覆盖旧标记无提示、原元数据不变、取消、新建、重开与 Pending。完整获准清单150文件/1576项首次1567通过、9失败（`/private/tmp/flow-remove-workbook-suite.log`）：8项为独立Python读取器缺依赖，1项为原生Session并发读取冲突。首次定向复跑8文件/60项为53通过、7项仍缺依赖，V1解释与并发读取均通过（`/private/tmp/flow-remove-workbook-rerun.log`）；确认部分用例硬编码的临时依赖目录已不存在后，仅复制仓库现有依赖到该测试目录，余6文件/11项全部通过（`/private/tmp/flow-remove-workbook-oracle-rerun.log`），未安装或改断言。全部失败项已获得复跑通过证据，但不称首次全量全绿；并发读取偶发失败未作产品修复，保留日志供后续核查。改动仅在集成试用分支，未重启用户窗口，未合 main、推送或发布。

## 试用反馈：绘画期间图层列表跳动（2026-11-09）

正常capture active/pending被当成常驻notice插入图层列表上方，落笔/结算交替改变布局。现将操作禁用原因与notice显示分开：普通绘画期间不插入notice，按钮/准入保护保持；失败、blocked、无能力、未准备好与保存/切换原因仍显示。没有修改绘画、持久化或用户项目。

真实Electron旧版红测试复现（`/private/tmp/flow-layer-stability-red.log`）；修复后绘画前/中/后图层行位置、高度、scrollTop相等，画笔按下时新增层仍disabled，故障提示/显式解除/图层编辑/撤销/正常关闭重开通过（`/private/tmp/flow-layer-stability-gui.log`，`flow-native-workbench-KHNKlx`）。完整build通过（`/private/tmp/flow-layer-stability-build.log`）；完整获准清单150文件/1576项通过（533.57s，`/private/tmp/flow-layer-stability-suite.log`）。当前试用窗口未重启，未合main/推送/发布；Windows及硬件输入未验。

## 试用反馈：绘画后图层操作失败修复（2026-11-09）

用户实际导入、绘画后触发 `stale-context`：原生每笔确认推进工具代次，Runtime 未同步到图层面板，导致新增/隐藏图层携带旧代次被拒。失败状态又被UI当成能力列表为空，误显示“引擎未提供图层编辑能力”。此前试用验证没有覆盖“不先Save/Undo/导航，直接绘画→图层编辑”的衔接；本轮补齐。用户项目只读检查到绘画确认与图层请求notCommitted记录，未修改项目、未处理用户保留操作、未重启试用窗口。

修复同步已验证的原生确认代次，不增加逐笔summary请求；同语义连续笔的旧代begin仍可准入，选层/选区/预览取消/导航/恢复后失效，旧图层操作及未来代次仍拒绝。失败只展示待处理提示，不伪称引擎缺能力。真实Runtime红测试复现，最终29项通过（`/private/tmp/flow-context-generation-{red,runtime-final,queued-final}.log`）；完整build通过（`/private/tmp/flow-context-fix-build-final.log`）。主管真实Electron导入→两笔→新增层→绘画→隐藏/显示像素完全恢复→五次撤销→既有Undo/Redo→正常关闭重开通过（`/private/tmp/flow-context-fix-gui.log`，`flow-native-workbench-nQQseW`），来源摘要未变。额外注入明确无副作用图层拒绝后，首次GUI查出局部错误与状态栏仍重复显示英文（`/private/tmp/flow-context-fix-notice-gui.log`）；保留原始错误回执、统一展示翻译后，最终GUI通过（`/private/tmp/flow-context-fix-notice-gui-final.log`，`flow-native-workbench-mNNtCW`），拒绝前后像素/历史不变，显式放弃只解除该项失败操作，随后正常新增图层与重开。最终完整获准清单150文件/1576项全部通过（527.71s，`/private/tmp/flow-context-fix-suite.log`），覆盖最终Runtime与图层owner代码；完整构建及最终真实GUI均通过。该次交付未重启用户窗口，运行中实例不会自动加载修复；本轮未推送或发布，Windows/硬件输入不在本轮验证范围。

## Mac 独立试用已就绪（2026-11-09）

本轮实现已集成到隔离 `codex/image-engine-integration`，主树、默认入口与用户项目未改。后台Add单次登记即返回，PNG/JPEG等来源继续保管/准备并只物化本批Pending；坏图不阻止正常关闭，Undo/删除不会被后台复活。Refresh明确选择、单批一次Undo/Redo、保管外部版本后keepFlow与失效观察恢复已接正式窗口。

主管完整build通过（`/private/tmp/flow-daily-combined-build.log`）。真实日常GUI通过（`/private/tmp/flow-daily-combined-gui2.log`，`flow-native-workbench-2DjSz7`）：后台8张图期间落笔、其他板未保存画稿和旧工作文件不变、冲突选择、Undo/Redo、keepFlow后Save、引擎中断恢复、正常关闭和新进程重开，画面/版本/文件一致。脚本整笔流程基线226ms、后台210ms，含事件发送和轮询，不是硬件输入延迟指标。

Sources发布回执丢失的真实窗口组合复验通过（`/private/tmp/flow-daily-source-recovery-gui2.log`，`flow-native-workbench-Al9YJ3`），不重复加板、不丢接受绘画，随后引擎中断恢复仍可落笔、Save和重开。首轮正常GUI因关窗后应用退出早于脚本回执写入，已将回执同步写在closed事件；首轮故障GUI在恢复后脚本首笔等待超时，新增可见UI恢复完成门禁及真实输入回执取证后通过。这两轮原始失败均保留，不记为通过。

原生固定版本后台导出、授权保护来源工作TIFF Refresh、RGB JPEG与真实单层TIFF输出均已集成；单层输出保留真实层记录，不用取消保护判定掩盖平面输出。最终release构建通过（`/private/tmp/flow-daily-single-layer-release-build.log`）。Main Refresh真实SIGKILL后的重开/续Save专项由执行者通过（`/private/tmp/flow-file-flows-refresh-main-sigkill-third.log`）；不把该模块证据当独立整体验收。

受保护来源Refresh GUI通过（`/private/tmp/flow-daily-protected-refresh-gui2.log`，`flow-native-workbench-AN7f5I`）：真实外部上层修改、保护底图绑定不变、一次Undo/Redo、Save及新进程重开，保存像素与独立外部TIFF完全一致。首轮把半透明原始像素直接与Canvas回读比较而超时；浏览器premultiply/unpremultiply导致最大1级差异，最终对照先对独立像素执行相同Canvas存储转换，仍逐字节比较，并额外断言Save文件的原始像素完全一致，未增加容差。

preload与最终资源强校验通过（`/private/tmp/flow-daily-final-preload.log`、`/private/tmp/flow-daily-final-resources.log`）。最终完整组合获准清单150文件/1575项全部通过，504.97s（`/private/tmp/flow-daily-final-suite.log`），不含禁止文件。通过独立 `试用新版 Storyboard Flow.command` 再次完整构建并打开项目选择页，已用原生UI确认“打开…”、“新建项目…”及空最近列表；配置位于本worktree的 `.hermes/native-trial/userData`，未打开用户项目。启动日志 `.hermes/launch/20261109-004406-7360.log`。试用窗口留给用户，合成验证实例已退出；主树仅原有 `D CLAUDE.md` 未动，没有推送或发布。额外导出、Windows、真实数位笔及大项目范围未扩大。 原生输入仍限单来源8MiB、单边8192px、单画布16Mi像素；准入上限不等于该范围所有格式/规模都已认证。新引擎试用暂不接额外PSD导出；复杂格式及颜色限制见native组件README。

## 正式工作台接入：进行中（2026-11-08）

最新保护来源闭环：`bad1150 / a57c014 / d49a61c / 5a23beb` 已集成为 `008178b / aa2bb9f / 5ab686d / 8cfae4a`。主管真实入口合成三图（明显合成差异PSD、轻微差异PSD、PNG）导入→上层绘画→普通Undo/Redo→Save全部工作TIFF→认证关闭→新进程重开通过（`/private/tmp/flow-native-protected-import-gui4.log`，现场 `flow-native-workbench-UGmaYO`）。严重差异为受保护底图+可画上层，轻微差异仍editable；工作TIFF与实际画布最大通道差1，原件摘要、来源绑定和重开文件摘要一致。小样本约510ms进入项目，不代表大批/大图速度。

该组合验收发现并修正两处接点：受保护图的availability原先随当前可画上层误报editable，现按版本保护policy判定；Save恢复Session后原先没有重新发完整画面，导致画布停在preparing，现恢复上下文后capture当前图再返回。首次状态断言失败（gui1）、未就绪即比较像素（gui2）、等待画面超时（gui3）的原始现场均保留，没有放宽画面断言。新增小色差/参考底图提示使用Main notice。完整JS/Electron构建、固定release reader/host/lease重建和组件探测通过（`flow-native-save-display-build.log`、`flow-native-protected-components-build.log`）；本轮组合两份获准清单去重后144文件/1539项：141文件、1535项通过，4项失败（486.85s，`flow-native-protected-combined-suite.log`）。失败分别是过时的“不支持铅笔”假设、保护图availability旧预期、ZIP检查数量15→17、构建脚本遗漏Windows静态CRT标志。前三项迁移到现行契约并保留原保护断言；Windows标志恢复，macOS仍为空RUSTFLAGS，Windows lease未实现的拒绝门不变。修后相关3文件9项全部通过、51项因定点选择未重跑（`flow-native-protected-failed-cases-recheck.log`）；其余全量绿项未重复跑。不把首次全量写成零失败，也不把Windows编译参数当平台验收。 最终完整构建与三组件离线重建/真实探测再次通过（`flow-native-protected-acceptance-build.log`、`flow-native-protected-acceptance-components.log`）；preload一致性通过（`flow-native-protected-preload.log`）。未合主树、未推送、未切默认入口。

仍未完成：Refresh、向现有项目添加图片、额外导出的产品接线；Source保管unknown的界面恢复；带保护标记的工作文件跨项目再次导入/Refresh、旧V1受保护来源项目升级；32M大图与Windows。本闭环仅保证已有Native项目内普通Save/重开，不把输出文件携带来源说明当作跨项目原件授权。

来源显示保护行为 `ece138a` 已本地集成为 `d8418a2`。执行者独立内嵌画面对照、真实Native上层绘画/复制/UndoRedo/被终止后重开通过；原30张TIFF在保守阈值2下24张可编辑、6张保护显示，30张原件摘要不变。用户确认的Flow阈值8由Main绑定，合成分线已通过；既有差值统计预计其中3张轻微差异不需保护，但不把推算写成阈值8的30张全量复跑。严重差异保留原画面为不可改底图、允许上层绘画。当前原生保护版本导出仍显式拒绝，Main protectedSource和独立输出包络正在接线，不能将读取候选称作已完整Save重开。

统一预算与完整副本接线 `9a7a0ec` 已集成为 `b64d4d4`：Sources/Output/journal/lease共用总恢复预算，原会话32MiB新来源增长分区已移除；Native store仍保守预留完整额度。执行者31项日志预算测试、5项真实Runtime保存/中断恢复、2项34MiB保管及副本测试通过，34MiB是保管能力而非大图解码证据。主管完整构建及真实工作台Save→正常关闭→复制整个合成项目→独立profile打开副本通过（`/private/tmp/flow-native-copy-runtime-{build,gui}.log`、现场 `flow-native-workbench-9VMH5l`）。副本双画布与输出文件内容、revision一致，原根24个文件摘要全部不变；后续补齐副本实际点击Save并成功，原件仍不变（`flow-native-copy-save-gui.log`、现场 `flow-native-workbench-aB58OL`）；同轮普通保存重开与初始化关闭也通过。复制指完整已关闭项目，不覆盖运行中复制或任意跨目录移动。 预算变更后的真实外部PNG导入/坏图隔离/绘画UndoRedo/关闭重开复验通过（`flow-native-shared-budget-import-gui.log`、现场 `flow-native-workbench-Lp8N7U`），原件摘要不变，小样本进入约513ms，不外推大批量速度。

最新保存接线：`ff073a2` 已集成为 `18014b9`，冻结作品版本与输出请求绑定到同一持久日志，保存结果不增加作品历史。执行者覆盖两处真实 Main 被终止后的原请求恢复；主管完整构建及实际工作台绘画→Save→重复Save→正常关闭→新进程重开通过（`/private/tmp/flow-native-save-integration-{build,gui}.log`，现场 `/private/tmp/flow-native-workbench-UbwZhV`）。本例输出 TIFF 与显示 RGBA 最大通道差为0，重复保存文件摘要、revision与撤销深度不变；初始化期间关闭仍等待认证。此证据限合成普通原生板，受保护来源输出、Refresh/Pending、冷复制 Runtime 与全局预算仍待接线，未切默认入口或发布。下方按阶段保留的早期“Save未接”记录不代表本次小闭环仍未完成。

隔离集成树已接入五种原生画笔、临时选区与图层编辑能力，并新增只读 Main 快照控制器、端口帧接收、双画布输入捕获、图层面板和项目切换协调器。冷准备期间保留原始归一化笔点，准备完成后按权威尺寸提交；帧与快照按身份匹配，不依赖两个通道的到达顺序。输入失败处理须先取得完整原始输入的持久保管回执，不能用已提交前缀替代整笔。关闭/输出/图层操作各自持有暂停原因，释放自己的暂停不解除其他操作。

主管接点聚焦 7 文件55项通过（`/private/tmp/flow-workspace-chief-focused.log`），随后新增冷准备通知和显示序列/暂停并存的边界由各聚焦日志覆盖；renderer/Electron 类型检查、preload契约检查及一次完整build通过（`/private/tmp/flow-workspace-chief-build.log`）。这些是施工模块证据：默认产品入口尚未切换，后续源码还在修改，尚未做本轮组合全量或发布验收。Main Runtime、文件创建与副本升级已进入组合接线；完整Save/Refresh/Pending与后台图像任务仍在施工，不能称为整体完成。用户主树和试用窗口未改。

补充施工证据：图层面板已接入宿主，选区移动/缩放/旋转使用固定起始像素的原生预览，松手才提交一次；本轮三个 UI 接点文件32项通过（`/private/tmp/flow-native-workspace-ui-focused-final.log`），项目生命周期6项通过（`/private/tmp/flow-native-lifecycle-release.log`）。完整renderer/Electron构建通过（`/private/tmp/flow-native-workspace-ui-build.log`）。文件输出候选 `6d6ffac + cb4edc4` 已本地集成：执行者新输出19项及复用文件保护20项通过；尚未与真实Runtime和原生元数据输出串联，不代表正式Save已经可用。新界面由Main明确选择引擎，当前默认入口仍未启用。

主管已接通真实工作台的私有原生入口：命令行、选择文件夹、最近项目统一识别原生项目与旧项目副本升级；损坏项目保留并报错。关闭请求等待创建/初始打开和renderer就绪；已认证但释放失败只重试释放；候选资源保留时提供独立恢复入口。普通图层编辑丢回包时保留确切请求身份，查询或完整原文保管后才能释放输入，不盲重放。组合聚焦6文件67项及完整build通过（`/private/tmp/flow-native-entry-combined-focused-final.log`、`flow-native-entry-build-final.log`）。

真实Electron首轮揭露了显示身份接线缺陷：frame已到达、笔迹已保存，但Runtime仍发送旧epoch，导致双画布持续preparing。修复 `88e9745` 已集成为 `af8cadd`，从当前可信原生帧更新仅展示身份，不把帧ACK当项目提交。修后真实pointer、双surface逐字节RGBA一致、Undo两边清空、Redo逐字节恢复和正常关闭通过（`/private/tmp/flow-native-workbench-yusmrs`，`flow-native-entry-gui-pixels.log`）；最终脚本又完成新进程重开逐字节RGBA一致及初始化期间关闭必须等待认证（`/private/tmp/flow-native-workbench-XtvehS`、`flow-native-workbench-final-smoke.log`）。透明显示恢复既有棋盘格后又通过最终三个阶段（`/private/tmp/flow-native-workbench-sW16OL`、`flow-native-workbench-checker-final-smoke.log`，构建 `flow-native-entry-build-final2.log`）；脚本曾因正常自动退出抢先结束而未写关闭收据，现改在closed事件中记录并强制断言认证次数，失败现场保留。preload契约通过。此证据尚不涵盖Save/Refresh/导入及完整产品矩阵。

进一步接线：项目菜单新增只读恢复记录与单条导出，取消导出不伪称已保存；旧项目副本保留后可显式核对并重试。导航绑定 Main 上下文 token，丢失的选层回包查询暂态完成证明，不伪装成图像持久提交。界面绑定失败仍释放已认证的旧 owner，并可只重试绑定。主管组合聚焦5文件63项通过（`/private/tmp/flow-native-recovery-combined.log`）。构建通过；固定 `dd976e6` release 宿主下真实工作台三个阶段通过（`/private/tmp/flow-native-workbench-RIFXgv`、`flow-native-context-smoke.log`），包含恢复记录只读检查；后续生命周期小修由上述聚焦覆盖。

Sources 与独立图像创建候选已本地集成。Sources 只登记清单，逐文件保管并优先当前目标；实际读取只核当前原件完整摘要，不先读取整批已保管原件。执行者15项真实文件测试覆盖同批其他坏图不挡当前图、坏图使用时拒绝（`/private/tmp/flow-workspace-sources-target-use.log`）。独立 new/duplicate/source 不切走当前画布，Main 一次批次决定后逐候选确认；原生执行者45项与3个真实连接专项通过。上述仍在 Runtime 接线，尚不能把模块可用称为用户导入、新建及复制流程已经整体完成。

真实新建按钮组合验收已完成：首次发现 Undo 新板后 Main 已回原板、UI 却过滤成空选择，右侧画布因此消失；原画稿未丢失。主管修复历史成功后的已确认目标选择同步，未改变多选目标时不折叠多选。最终完整 build 与新建白底、一次 Undo、Redo 同身份、原画稿完整 RGBA、关闭重开通过（`/private/tmp/flow-native-workbench-5mLYxZ`、`flow-native-creation-selection-smoke.log`、`flow-native-creation-selection-build.log`）；失败现场 `flow-native-workbench-DwLjxQ` 保留。来源状态提示及真实文件夹导入专项正在接线，尚不计入本次通过。

PNG 按需导入小片 `b2b0b9d` 已合入 `10be55d`。执行者16项真实来源/冷激活/坏图隔离测试与构建通过；主管真实“打开文件夹”→创建→首次绘画→Undo恢复Source身份/Redo→正常关闭→新进程重开通过，外部原件摘要不变。最终中文坏图提示与完整路径复验为 `/private/tmp/flow-native-workbench-UeBT0M`、`flow-native-cold-import-message-{build,gui}.log`。两张小PNG加一张坏图的本次登记进入约508ms（前次434ms），不是大批量或全格式性能承诺。首次脚本未等待创建页结束即继续读取导致失败，现场 `flow-native-workbench-U2SwdR` 保留；同次基本绘画/新板/关闭三阶段已通过。普通PSD/TIFF仍待来源保真保护接点；Save/Refresh仍在接线，来源分区当前默认只容纳本会话32MiB新增长，不能将该施工额度当最终大批导入能力。

打包接点已改为 release reader/host/lease 三组件及同一回执，源码摘要覆盖全部自有 native 源文件；缺少当前正式功能能力即拒包。执行者10项JS、17项ZIP、3项探测协议检查通过，真实旧宿主因缺metadata能力被正确拒绝。主管实际三组件 release 构建、macOS 完整包和严格签名通过（`/private/tmp/flow-native-three-components-{build,package,signature}.log`）；包内签名后 reader/host/lease 实际版本、正常冻结关闭和获取/核对/释放锁通过（`flow-native-signed-three-components-probe.log`）。真实 ZIP 首次因旧校验器无条件拒绝 Electron Framework 正常链接而失败；现只允许包内已知 Framework 的固定相对链接，拒绝逃逸、悬空、链接下伪造成员和原生组件别名，8项合成安全测试及真实 ZIP 复验通过（`flow-native-package-links-tests.log`、`flow-native-three-components-zip-fixed.log`），原失败日志保留。此包对应 dc05141 原生源码，不含后续来源保护/冷复制，尚未做包内真实 GUI 或安装验收。Windows lease当前未实现，三组件打包明确拒绝该平台，这是实际阻断而非仅未运行验收；不以旧发布版的Windows流水线证据替代。

已关闭项目冷复制候选 `ee0fceb` 已合为 `c263528`：执行者3文件64项通过（12冷复制、34Output、18真实lease），覆盖旧证据保留、竞争替换拒绝和中断后续接；Main journal真实但图像捕获为注入，不能当真实编解码或完整UI验收。Runtime入口/文件终态尚待连接。提交后发现同root只换lock可能误入copy准入，精确补修 `96191cd` 已合为 `9ac8ef4`：Main/native均要求完整副本具有不同root身份，实际拒绝与完整复制正例2项通过（`flow-cold-copy-distinct-focused.log`）；不以复制端口自动修复异常锁。

冷准备输入边界：等待目标激活期间的归一化 down/move/up 仍只在 renderer capture owner 内存，Main 此时仅持久保管来源/hydration事实；不能宣称这段窗口遭遇进程崩溃也不丢笔。正常关闭会等待 capture 结算，显式 resolveInput 获得原文 recordId 后才算持久保管。这不等于已完成独立的冷输入崩溃恢复协议。

本轮发现现有原生帧/输出传输预算尚不覆盖旧32M像素上限，复杂来源自带持久选区也不能被无提示忽略。前者暂按实际额度拒绝而不缩图，后者保留原结构并明确限制正式绘画；完整产品容量与超大图像验收仍待闭合。

## 图片发动机替换：施工中（2026-11-07）

2026-11-08 统一编辑日志已在隔离树完成：候选 `2f909b8 + cb08cc7` 合入 `77cffb6 + 438bdfd`，Main 逐笔多文件持久化已换为统一追加记录，接口、唯一项目决定、完整输入与有界预算保留。执行者 225 项聚焦通过；最终恢复保护另有真实 FS 26 项、真实 Main/native 10 项及 build 通过。主管组合完整 build、获准 **107 文件/1255 项全部通过**（398.41s，`/private/tmp/flow-engine-research/journal-integration-suite.log`），small 真实窗口混合历史/撤销重做/关闭重开通过。缺首段、缺目录或恢复检查失败不会清成空项目；普通半组中断保留原字节换段续写，旧 writer 实际拒新格式；用户旧项目未原地改写。恢复契约见 ARCHITECTURE。

同一固定 release 宿主 `80a701a`、同 warmup/40 笔/280 batch 的主管实测：deadline→Canvas ACK P95 **254.10→4.61ms**，首次 down 尝试→ACK P95 **83.52→6.86ms**；背压 **2091→0**、整拍迟到 **221→0**、积压峰值 **26→0**、丢输入 0。Node sync **360→115**，该窗口全部为 journal 段文件同步；非所有确认都合批，不能把共享 flush 的异步父调用当独占成本。293 帧/241,807,416 通道逐值一致，最终像素与旧基准相同，40 笔最终确认、关闭重开通过。最后输入后显示排空 **0.59ms**、最终确认 **84.91ms**（旧 289.20ms）。本次合成节拍 PASS；单次分时测量、含像素 oracle，不宣称物理输入时延、真实数位笔、长期负载或默认产品 UI 已达标。完整无损原始证据与派生统计在 `scripts/flow-main-image-pipeline-journal-evidence-*`；窗口现场 `flow-main-image-pipeline-esmUF6`、`flow-main-image-pipeline-IhFSfm`，日志 `/private/tmp/flow-engine-research/journal-{integration-build,gui-small,gui-paced}.log`。自有 Electron 正常退出。此结果不需要继续扩大原生协议，本轮 deferred finish 保持只读备选、不实施。

本轮优化已本地集成，未合主树、未推送、未替换用户正在使用的工作台。发动机整体迁移仍有默认工具/图层接线、完整 Save/Refresh/Pending、旧项目复制升级、正式全局预算接线与 Windows 待验；不能把本轮保存链完成称为整机替换完成。

2026-11-08 组合验收中：完整操作代际隔离 `73a2d76`、CAS/接纳/确认拆分 `c401472`、批次观测脚本 `e20a7db` 已分别合入 `94ff602`、`6120051`、`48e5dc3`。执行者相关 194 项及构建通过；主管组合构建、12 项观测辅助测试、完整获准 105 文件/1219 项全部通过（390.74s，`/private/tmp/flow-engine-research/split-integration-suite.log`）。small 绘画/混合历史/Undo/Redo/关闭重开通过。固定与旧基准相同的 release 宿主 80a701a、透明 warmup 后 40 笔/280 batch 实测：deadline→Canvas ACK P95 1734.67→254.10ms，首次 down 尝试→ACK P95 131.02→83.52ms，背压 2091 次、221 batch 迟到、积压峰值 26；性能改善但仍 FAIL。293 帧/241,807,416 通道与旧基准完全一致，40 笔最终确认及正常关闭重开通过；最后输入后显示排空 5.58ms、最终确认 289.20ms。40 个确认批次全部仅一笔，Node sync 共 360 次，尚未获得有效合批。完整无损原始报告及逐笔/批次统计见 `scripts/flow-main-image-pipeline-split-evidence-*`。首轮 Electron 沙箱内 SIGABRT 未产生结果，保留日志后在授权桌面环境重跑通过；所有自有测试进程已退出。两次测量跨日且非多轮随机基准，不宣称物理输入延迟或正式 UI 达标。下一步继续压缩持久化等待，已交主责分析，尚不扩大原生槽数或降低回执保证。

最新集成：同 Main 故障恢复 `b17f16b` 已合 `41da1e5`，执行者 7 文件/179 项及构建通过（`/tmp/flow-main-worker-final-verified.log`、`flow-main-worker-build-verified.log`）。已取得 ready 的恢复场景可保留 Main 历史并正常关闭；未 ready/未抬笔两类仍显式待处理，不能宣称自动恢复全部完成。主管在组合源码及自编译原生组件上完成 7 文件/59 项接点回归与完整 build（`/private/tmp/flow-engine-research/context-recovery-integration-focused.log`、`context-recovery-integration-build.log`），全部通过；独立协议审查随后发现旧代操作跨本地文件读取 await 后可能借用新连接的竞态，已交主责补完整操作代际隔离及门控读恢复测试；该边界未闭合前不作整体验收。原生上下文 `df22054` 与十进制图层 ID `92890bd` 已集成，主管真实 Node→宿主→FrameStore 接点 1 项通过（`/private/tmp/flow-engine-research/context-node-final.log`）；默认 UI 工具尚未接入。

真实 Main 稳态 profile 已合 `410aad5`：透明 warmup 后 40 笔仍有 3069 次背压、244 batch 迟到，deadline→Canvas ACK P95 1734.67ms，首次 down 尝试→ACK P95 131.02ms。计时窗口无 keyframe，像素 oracle 总计仅 31.4ms。每笔平均 10 次 Node 文件/目录 sync；commit 调用到最终 resolution 返回 P95 131.28ms，主要积压在前笔确认完成才允许下一笔 CAS 的串行链。详细证据 `scripts/flow-main-image-pipeline-profile-evidence-*`；各段分位数不可相加。下一切片拆开唯一 CAS 决定、严格有序 native accept 和有界 Main 确认批次，仍保留完整输入持久化后才 finish，不扩大原生四笔槽掩盖吞吐。

真实 Main→双 Canvas 组合脚本 `50d975e` 已合 `e883079`：小闭环 3 笔+对白混合历史、Undo/Redo、冻结正常关闭、删合成外部来源后重开通过；2K/40 笔/280 batch、285 帧与 208,052,104 通道逐值相同、revision 40 重开一致。但 **10ms paced 性能失败**：2993 次背压、242 batch 迟到至少一拍、积压峰值 104；首次 down 尝试至双 Canvas ACK P95 126.81ms，含全部重试，deadline→ACK P95 1627.66ms。下一笔 native preview P95 125.55ms，39/39 都在前笔 intentDurable 后。首次 keyframe oracle 131.9ms 单列，不能解释后续累积延迟；ACK 非物理显示时延。原始 gzip、截图、服务界限和逐笔统计见 `scripts/flow-main-image-pipeline-evidence-*`，原 JSON 无损保留。正在进一步分解 commit/settle/resolution 与 lease 开销；未把 native-only 快路径当真实项目体验完成。

Main 连续笔链候选 `8a1a780` 已合入为 `af23d2f`：内部 opt-in input/progress/waitOperation、独立 intent 写入及 FIFO 项目决定、真实 no-op 结算、共享预算与屏障。执行者 6 文件/166 项及最后 10 项状态回归、完整 build 通过（`/tmp/flow-main-pipeline-final-verified.log`、`flow-main-pipeline-gates-verified.log`、`flow-main-pipeline-build-gates.log`）。主管在集成 `af23d2f` 上完成通用加原生附加清单：102 文件/1190 项全部通过、376.90s（`/private/tmp/flow-engine-research/integration-pipeline-full.log`），完整 build 通过（`integration-pipeline-build.log`）。之后组合审查发现 A 保存未回、B 已起笔、Undo 排队、B 抬笔可循环等待；执行者真实红测复现后以 `20f288f` 修复，合入 `43be087`：活动笔期间 Undo/Redo/Freeze 同步 busy，不进入屏障、不留下封口。该补修 36 项及 build 单独通过；1190 项全量证据属于补修前基线，未冒称同一源码。尚未接默认 UI；local admitted 不等于已显示，intent fsync 仍会阻止下一笔 native preview，正在另测实际 Main→双 Canvas 节拍。同 Main 自动 worker 替换恢复仍在接入，不宣称用户无需退出的恢复已闭合。

主管本轮补充：当前集成源码自编译宿主与 lease 的附加清单 4 文件/31 项通过（`/private/tmp/flow-engine-research/integration-native-approved.log`）。新增 WorkerOwner 生命周期接点 5 项及完整 build 通过（`worker-owner-focused-final.log`）：真实进程替换、旧代拒绝、未接受候选保留、并发重启、dispose 中断和正常释放 lease 后拒绝新请求。独立只读审查指出正常 release 不发送 invalidated 的缺口，已加同步 held 检查并实测；恢复接点不自动激活 Session，尚待连续笔链接入，不把这一层通过当自动恢复已完成。

用户已批准完整替换计划：常驻原生 PhotoCraft 负责图像编辑；Flow 保留分镜、对白、Pending、统一历史与文件事务。目标包括先进入项目再后台保管/准备图片、新内部文档版本，以及旧有效 Flow 项目复制升级；不是原地改写用户旧项目，也不宣称任意 Photoshop 文件全面往返。

施工基线 `da18b06`。隔离分支 `codex/image-engine-integration` 负责接点与组合验收，原生执行与原件保管分别由 `codex/image-engine-native`、`codex/image-engine-storage` 实施。首个验收闭环为打开、双画布绘画、混合历史、持久化、关闭重开与输出；当前尚未通过该闭环，默认产品路径尚未替换。

已确认 Electron 36 Main MessagePort 的 transfer 列表只支持消息端口，Main 至 renderer 的像素仍需结构化克隆；不把专用通道称为零拷贝。显示协议须包含完整身份及帧基准，透明像素按覆盖更新，不能用 source-over 粘贴增量来显示橡皮。

环境准备：用户批准的任务局部 Rust 1.99.1 与锁定依赖已准备在 `/private/tmp/flow-image-engine-toolchain`，没有修改系统 PATH 或全局配置。原生宿主已在 macOS 编译并执行；真实 Windows、正式打包与产品集成验收未完成。主树既有 `D CLAUDE.md` 未触碰。

三条候选已在隔离集成树合入：原生 `85d1cf9`、原件保管 `bced170`、帧接收完整链至 `4f5f30c`。组合接点聚焦 3 文件/65 项通过（`/private/tmp/flow-engine-research/combined-focused.log`），Electron 类型检查通过。新增 Main 常驻进程连接与有界二进制拆包器；真实 binary 到 FrameStore 的首次连接发现 accept 后 capture 的 `inputThrough` 回退，被接收器正确拒绝（`connection-first.log`），已交原生负责人修复，不弱化序号保护。尚未接产品入口或真实 Canvas，不宣称双画布闭环通过。

该序号问题由 `1c52a3f` 修复并合入：显示帧使用 epoch 内累计输入数，单笔命令仍使用笔内序号。真实连接测试现已通过（`connection-prefix-fixed.log`）：合成 PNG 保管后删除外部来源、重开保管库、Main 启动真实 Rust binary、两笔连续预览与提交像素一致、Undo 后显式新 epoch 安装恢复透明基底、正常 freeze/close。此证据使用执行者同修复构建的 debug binary；未认证正式打包、真实屏幕或整个项目 Session。性能线继续优化磁盘结算与连续输入；显示线接真实端口及双 Canvas。

继续集成：显示 Canvas Adapter `bfcf77b` 与增量笔迹残影修复 `364c758` 已合入隔离树。后者累计真实 damage，覆盖平滑笔迹反向时被移除的旧尾部；执行者原生 2K 连续 40 笔逐帧/提交像素一致。此前串行抬笔至 prepared P95 45.47ms、至 accepted 50.81ms 是原生链路基线，不是用户屏幕延迟；异步持久队列仍在实施，不能宣称已消除等待。

主管接线补充：输入在等待启动握手前快照，并预占单请求容量；错会话回包、半截 EOF 按 unknown 保留义务，不自动重试。帧元数据明确已接纳版本与尚未落盘笔链，限制四项、独立复制、校验 pipeline/epoch，不能把预览当保存。已完成完整 JS/Electron 构建（`integration-build.log`）、56 项接点测试（`integration-pipeline-focused.log`）和固定 `364c758` 宿主连接测试（`connection-damage-fixed.log`）；新增启动容量断言后的最终组合 4 文件/58 项通过（`integration-wire-final.log`），最终 Electron 类型检查通过（`integration-typecheck-final.log`）。日志均在 `/private/tmp/flow-engine-research/`。显示执行者此前真实 Electron 双 Canvas 证据回放录制帧，实时 native→双 Canvas 专项正在补齐，不将二者混称为整链通过。混合历史、Main Session、产品入口和全量组合验收仍待完成。宿主能力协商补充 7 项 transport 检查通过（`transport-capabilities.log`），旧宿主缺少 capabilities 时不启用新恢复协议。

实时显示接点已补齐（执行者 `ab6de0f`，主管集成 `a1fd3ad`）：固定 `364c758` 宿主→Main Node connection→MessagePort→两个真实 Canvas，23 次请求/12 帧逐字节一致，半透明往返单笔、橡皮透明洞、版本 Undo/Redo/回空白、正常 freeze/close 通过。结果在系统临时目录 `flow-image-engine-live-A3xZkW/result.json`；日志 `/private/tmp/flow-image-engine-live-{build-final,gui-final}.log`。屏幕同 RGBA/同背景的独立 CSS 参考差≤1，不透明 sRGB 算术预混色与透明合成截图不等价（保留 `srgbPremixMatches:false` 和原始失败）。该专项为合成隐藏窗口和程序输入，不认证产品工作台、真实数位笔或物理显示延迟。

原生恢复接点 `c8ec773` 已合入；主管复核发现同宿主恢复 accept 失败后二次重试会丢失 recovered 身份，已由 `461ceca` 修复并合入。候选显式记录来源，旧/新基底分别覆盖 load 与 accepted journal 失败后同宿主重试，15 项原生测试通过；项目线使用与该提交绑定的独立二进制。Main 项目 V2 schema/CAS 与同一套 Flow 混合历史开始实施；不能用 native accepted 反推项目已提交，也不把后台 hydration 算作用户 Undo。

项目基础切片 `fb8ecdd` 与复核修复 `4eb1409` 已合入：V2 图片引用、不可变 commit/head CAS、hydration/settlement 索引与 V1/V2 共用历史算法。公共历史计划深冻结；常规提交复用已验证前缀，仅检查变动引用；未知结果的幂等重试补做目录同步；失败 Undo/Redo 仍断开文字分组。修复切片执行者 4 文件/137 项与 build 通过。真实 Main/native 混合历史与故障恢复正在接线，基础模块不等于整体验收。

连续绘画队列 `8adc75f` 已合入：原生输入与持久化分线程，有界四笔队列，项目确认前不会把预览称为已保存。执行者 2K/4K 各 40 笔与串行参考逐字节一致；2K 采样请求 P95 0.422ms、持久确认 P95 72.8ms；4K 慢盘注入会触发明确背压，不静默丢输入。这些是原生协议测量，不是笔尖到屏幕延迟或全进程内存上界。主管真实 Node 连接新增连续笔链验收，两项通过（`/private/tmp/flow-engine-research/pipeline-node-integration.log`），覆盖队列身份、接受前后像素不变与 epoch 切换；尚不替代真实项目 CAS。

项目单写者保护 `b3cde7a` 已合入：真实 OS 锁加持久 Main 身份。只崩溃锁辅助进程时，旧 Main 停止新写，新 Main 也不能趁隙接管；确认旧 Main 退出后才恢复。执行者 18 项真实进程专项与 build 通过，证据 `/private/tmp/flow-image-project-lease-receipt.json`。当前仅本机 macOS 验证，Windows 安全拒绝；生产入口、网络文件系统和完整打包未认证。

传输补充：等待宿主启动期间，调用方可转移 ArrayBuffer；发送长度与内容现均取预先快照，启动配置身份也独立保存。真实 transfer 回归在内的 8 项 transport 测试通过（`/private/tmp/flow-engine-research/transport-transfer.log`），完整构建通过（同目录 `integration-transfer-build.log`）。

主管最新组合：完整构建通过（`/private/tmp/flow-engine-research/integration-project-lease-build.log`）；真实 native 连续笔链、连接身份、项目 CAS 和混合历史基础共 4 文件/23 项通过（同目录 `project-pipeline-combined.log`）。项目 Session 端到端与最终获准全量仍待完成。

隔离集成提交 `306c9a6`：主管独立从固定源码构建原生全部目标成功（`/private/tmp/flow-engine-research/integration-native-build.log`），完整获准清单 **97 文件／1139 项通过**（同目录 `integration-approved-suite.log`，359.87s），preload 检查通过（`integration-preload.log`）。此全量对应该提交，不覆盖随后尚未合入的 Main Session、导出或显示专项；默认产品未迁移、未发布。

连续队列真实双 Canvas 专项 `b33646f` 已合入，主管核对其 Connection/Framing 源摘要与集成树相同。固定 `8adc75f`、2K 40 笔/283 帧/107339456 通道逐字节一致，最终两 Canvas 与 native 摘要一致，40 次 prepared/accepted FIFO，39 笔在前笔未确认时开始，freeze 封输入后排空正常关闭。证据目录 `flow-image-engine-pipeline-5WKxVW`；离线统计 `/private/tmp/flow-image-engine-pipeline-display-final-metrics.json`。无节拍 burst／并发负载下 810 次背压拒绝，逐笔累计首 down→双 Canvas ACK P95 **43.63ms**、末点→ACK **1.56ms**、末点→native accepted **294.88ms**；不能只用末点或原生请求时间声称起笔无等待。ACK 含像素校验，未认证物理延迟、稳定性能或 Main 项目 CAS，10ms 采样节拍待测。

空闲窗口 paced 专项（`flow-image-engine-pipeline-NE63J4`）一次通过：40 笔、280 batch、全局 10ms deadline，不丢输入，零背压、队列峰值 2；deadline→双 Canvas ACK P95 4.64ms，实际派发→ACK P95 1.29ms，均含像素 oracle，未认证物理显示延迟。末点→accepted 观察 P95 144.32ms 包含串行轮询，尾笔还跨越窗口后的截图，不能当 native 落盘耗时。统计 `/private/tmp/flow-image-engine-pipeline-paced-idle-summary.json`；不得混同此前 burst 的起笔等待。

Main 串行闭环 `1f0c382` 已合入，主管在自建 pipeline 版宿主和真实 lease 上复验 3 文件／25 项通过（`/private/tmp/flow-engine-research/main-session-integrated.log`）。包括混合历史、三种崩溃窗口、回执丢失、撤销后画面安装失败、冻结审计失败、Append 拒绝后明确取消草稿。该 Session 尚未接连续输入；下一项是 Main 的短命令调度与项目持久队列分离。

原生稳定版本 PSD/分层 TIFF 输出与 Resume `80a701a` 已合入，执行者 21 native 测试、18 项独立格式检查通过；未知块转换、规范化或损失警告拒绝，无平图替代。主管新增 Main 冻结版本输出捕获，真实项目绘画→冻结→PSD/TIFF bytes→正常关闭通过，捕获期间项目变更和传输字节损坏拒绝，项目 head 不变、未发布用户文件（`/private/tmp/flow-engine-research/main-output-capture.log`）。这不是完整 Save/重命名/Trash/Refresh 集成，也不外推任意复杂文件全面往返。

更新：2026-11-06。这里记录状态；操作约束见 [AGENTS](../AGENTS.md)，接口见[架构](ARCHITECTURE.md)。

## Photocraft 与分隔条：本地组合验收（2026-11-06）

读取/有限PSD导出/原生CI候选 `0b37b44 → b479581 → c0ded5f` 与分隔条完整链 `fe4a8aa → fe6d5cb → e7050f6` 已整合到本地主分支，产品组合HEAD `ab87025`，未推送。主管核对接点并发现拖动中键盘提前提交漏洞，已补修；完整顺序合并保留Photocraft提示和两边获准测试条目。首次遗漏前置提交造成的合并冲突已撤回后按完整顺序解决，没有批量覆盖主树文件。

执行者证据：Photocraft全量90文件/1033项通过，30张真实TIFF只读显示对照max≤1且原件摘要不变；6个合成PSD通过独立读取及Photoshop27.6，原层数据保留。后续原生打包22项聚焦、15项ZIP校验通过，本机macOS包签名及包内组件执行通过。分隔条全量89文件/1036项通过，补修后build/GUI专项通过；详细限制见DESIGN及native/photocraft/README.md。

主管组合验证：完整build、强制原生资源回执校验、preload通过；5文件32项接点聚焦通过；分隔条edit/reopen GUI通过（flow-dock-panels-Am1vur），PSD导出/取消/拒绝已有目标/重开通过（flow-psd-export-gui-om7u1h）。日志为 `/tmp/flow-combined-chief-{build,resources,preload,focused,dock,psd}.log`。复用已可信单点与全量证据，未重复跑组合版整套清单。通过启动器正常关闭旧试用实例、构建打开整合版，已只读确认分隔条和原试画工作台显示；没有重置画稿或布局。

待验：真实GitHub runner、Windows编译/运行/NTFS、完整安装器、任意真实复杂PSD、CMYK正向独立色彩验收、复杂TIFF转PSD、触控/数位笔及原生输入法；不以合成样本推断全面保真。当前受保护底图仅可在上方新增绘画，普通Save仍是Flow TIFF；有限PSD另存另有严格准入。

## 启动器异常退出恢复（2026-11-06，本地修复）

修正死 PID 被 `ps` 非零返回误判为无法确认的问题：直接区分 ESRCH、存活及权限不明；确认本机进程已消失后备份残留链接并恢复。启动流程采用带 PID 的原子互斥锁，子进程取得配置锁前接管启动锁；失败诊断从检查锁之前就写入日志。未知归属与旧无身份目录锁仍安全拒绝，保留先构建再启动及正常关闭行为。

验证：启动专项 11/11（`/tmp/flow-launch-lock-tests-final.log`，包含真实 shell + 合成 Electron、构建失败日志）；完整获准 88 文件／1024 项通过（`/tmp/flow-launch-full-suite.log`）。真实 Terminal 启动自动备份旧锁到 `.hermes/launch/stale-lock-gEOTUK`，构建通过并打开原试画工作台，日志 `.hermes/launch/20261106-172345-27827.log`；已按应用完整路径只读确认界面。此后完善启动子进程锁交接及 macOS 临时路径别名，最终脚本由上述合成专项覆盖，未再重启用户窗口。未推送；不涉及 Windows 启动器。

## 本轮：项目入口简化（本地候选，未推送）

入口只剩「打开…」和「新建项目…」两个动作，最近项目列表保留。打开只选一个文件夹：完整 Flow 项目直接打开；普通图片文件夹进入创建确认页（项目名默认取目录名、说明新建文件夹且来源不变、选保存位置、「创建并打开」）；旧 `.storyboard-workbench` 按图片导入并明确只导入图片、旧排序与对白不迁移；带 `.storyboard-flow` 标记但读不出来的文件夹报错停止，不降级导入。新建项目是空白项目，只问名称和保存位置，复用同一创建事务（新增 `createBlankProject.ts`）。新文件夹名由项目名派生，与来源目录同名时加「分镜」后缀。打开/创建/切换错误改为界面上方显著提示。

自测证据：`tsc --noEmit` 与 electron 类型检查、完整构建、preload 一致性检查通过；聚焦 33 项（含新增 `projectEntry.test.ts`、`createBlankProject.test.ts`）通过；真实 Electron `scripts/flow-project-entry-smoke.mjs` 七阶段全部通过（home/import/blank/legacy/reopen/open/pending，含损坏项目拒绝、取消不变、空白项目新建板并保存、重开），证据与截图在 `.hermes/project-entry-simplified/`。获准全量清单（88 文件）与独立验收状态见本轮交付记录。

未覆盖：真实鼠标操作手感、用户实际试用、Windows、打包安装包；分层 TIFF 导入行为仍沿用原契约，本轮未重测。

## 项目入口简化：主管验收

2026-11-06：候选 `1fea416` 本地合入为 `3aee747`，未推送。执行者获准清单88文件／1024项通过；主管审查并独立完整构建、七阶段项目入口GUI通过（`/tmp/flow-entry-chief-build.log`、`/tmp/flow-entry-chief-gui.log`，现场 `flow-project-entry-yxtVbB`）。已通过Terminal启动新版供试用，原文件未导入或改写；真实用户TIFF兼容性、Windows尚未由本专项认证。

## 本次提交与推送范围

本次提交包含工具快捷键、日式共用尺寸滑杆、工具栏防闪烁与 Pending 最小尺寸防溢出，以及配套测试迁移和文档。提交前本地受验基线为 `b69bd7d`：主管完整清单86文件／1009项通过；快捷键、Pending 与日式专项通过。其后仅维护文档，不因文档改动重复运行产品测试。最终日式CSS构建通过；完整清单是在它之前运行，之后的CSS由日式专项及执行者布局专项覆盖。真实设备及跨平台边界见各节。

用户已授权推送main；该推送可能触发自动发布。v0.1.78是此前已发布版本，本轮的新CI与发布结果待实际核对，不能将本地验收写成发布完成。历史各节的“未推送”是当时记录，以本节及Git远端状态为准。

## 日式分镜共用尺寸滑杆（本地整合）

日式分镜与普通故事板共用既有尺寸值，切换模式不重置；窄栏按可用空间收窄画面并堆叠正文。产品候选 `70b82ef` 已合入；主管完整构建通过（`/tmp/flow-japanese-chief-build.log`）。此前组合版本完整清单86文件／1009项通过；其后仅增加本节CSS与测试脚本，未重复整套单元测试。执行者尺寸专项与布局专项各连续通过两次，布局脚本已将退役的hover／DOM镜像断言迁移为pointerdown接管及真实屏幕像素检查，保留导航、图层、撤销重做保护。

主管首次日式专项排序失败因脚本落点进入Pending，已加命中校验与Pending不变断言（`aaef531`）；失败证据保留在`/tmp/flow-japanese-chief-gui.log`。修正后的主管专项通过（`flow-japanese-sizing-wwjcX5`，`/tmp/flow-japanese-chief-gui-final.log`）。触控、Windows及极窄面板边界未验；未推送本轮产品改动。

## 工具快捷键（本地验收通过，未推送）

已本地整合工具快捷键候选 `584e39e`；B/E/L/K、短按与按住 E 语义见 [DESIGN](DESIGN.md)。主管整合后完整构建和真实键盘 12 项专项通过（`/tmp/flow-shortcut-chief-build.log`、`/tmp/flow-shortcut-chief-gui.log`）；主管完整获准测试 **86 文件／1009 项全过**（321.03s，`/tmp/flow-shortcut-chief-suite.log`）；Pending 邻近回归亦通过（`flow-pending-table-vmRUTc`）。真实数位笔、Windows 与原生物理 IME 尚未验证；未推送本轮产品改动。

## 工具栏与 Pending 小卡片修正

逐笔提交会暂时锁定工具切换，原全局 disabled 样式把工具按钮透明度降至 35%，造成明暗闪烁。现在仅在 paint 提交锁定期间保持外观稳定，原生禁用保护保留；保存或冻结等其他禁用仍呈现灰态。Pending 最小尺寸时去掉故事板画面区域 70px 高度下限，限定画面宽度与裁切范围，避免图片撑出卡片边框。

主管构建与共享绘画窗口专项通过（`/tmp/flow-rail-pending-build2.log`、`/tmp/flow-rail-pending-paint2.log`），专项记录真实短暂禁用期间按钮透明度恒为 1。Pending 最小尺寸边界、排序、滚动、键盘与重开回归通过（`flow-pending-table-riJbLX`，`/tmp/flow-rail-pending-table-final.log`）；驱动已避免无必要居中把目标滚出视口，原排序断言保留。此前完整清单的4项旧CI契约失败已随CI修复关闭；主管与快捷键整合后完整清单86文件／1009项全过，Pending专项再次通过。首次新增驱动引用错误及几何驱动失败日志保留。未推送本轮 UI 改动，未重启用户窗口。

## 发布环境修复

2026-11-06 的推送流程在分配 runner 前取消，GitHub 注释为 `macos-14-arm64-us-default` 不再支持；不是该次代码测试失败。测试和 macOS arm64 打包均改用受支持的 `macos-15`，CI 测试同步改为显式枚举获准清单。随后 run `42157957638` 在测试阶段因 V8 默认约 2GB 堆耗尽失败，打包与发布均跳过。隔离复现定位至 `flowTiffSave.test.ts`，2GB 失败、3GB／4GB 通过；测试步骤现设 4096MB 上界，并同步两份旧工作流契约测试。实现者显式全量 85 文件／997 项、构建、preload 校验通过（`/tmp/ci-mem-full-4g.log`）；主管集成 `1a78208` 后独立复跑两份契约测试 9 项通过。真实runner已通过：run `42161446703`（head `456a258`）全绿，85文件／997项测试通过；macOS arm64与Windows x64打包及发布成功。v0.1.78已正式发布，updates清单已指向该版；未做下载安装验证。本节发布不包含后续本地界面与快捷键改动。

## 本轮收口：跨画布共享绘画展示

候选 `37ad7f3 → 6d53aaa → ac94c9f` 已快进整合至 main；本次已获用户授权提交／推送，远端同步与发布结果须分别核对。故事板小画面与大画布使用会话级共享展示 owner，移除 DOM LiveMirror 和 hover 起笔依赖；资产回执与覆盖前缀绑定，历史屏障遮住旧像素并保留新输入。关闭／切项目在结算前同步停止新绘画准入，freeze 后复检义务；超限笔不自动提交截断前缀。失败处理及用户明确选择的新顺序语义见 [DESIGN](DESIGN.md)，接口与预算见 [ARCHITECTURE](ARCHITECTURE.md#绘画展示与输入义务)。

实现者最终自测：显式获准 **85 文件／995 项**、构建、跨画布专项、六组关闭／预算／失败恢复专项、五阶段重新叠画与 unknown／retained 正常关闭重开，以及邻近橡皮、选择、综合工作台均通过。五种预设、四个时点的同一固定 seed 输入与独立 FlowPixels 路径整图 RGBA 共 20 组零差异；重叠失败笔的新顺序选择另有 921600 通道零差异对照。Terra 对三次候选进行独立只读复审，最终按已确认的新顺序选择语义关闭阻断，未发现新增阻断；该审查不代替主管运行验证。

主管独立验证：最终候选完整构建通过；五阶段恢复选择／正常关窗重开通过（`flow-paint-presentation-0NoOu2`），主树重新构建后跨画布与 20 组像素专项通过（`flow-paint-presentation-5lMonK`），主树选择／拖拽通过（`flow-board-selection-PphMKk`）。最终候选显式完整获准清单 **85 文件／995 项全部通过**（319.84s，SUITE_EXIT 0），本轮软件修复通过主管验收；人工硬件与跨平台边界仍见下文。日志：`/tmp/flow-paint-choice-chief-build.log`、`/tmp/flow-paint-final-main-build.log`、`/tmp/flow-paint-choice-chief-contract.log`、`/tmp/flow-paint-final-main-gui.log`、`/tmp/flow-paint-final-main-selection.log`、`/tmp/flow-paint-choice-chief-suite.log`。

此前被拒候选及原型不合入；失败日志和合成证据保留。最初依赖复制嵌套造成的 114 项失败已在本 worktree 中修正路径，无新安装。真实数位笔、Windows、长期内存和极端大项目仍待人工／专项验证；不以合成鼠标或局部像素预算认证这些行为。当前会话和 JSON 导出保留错误证据，不承诺重开后继续显示内存中的 Session 错误。用户画稿与现有试用窗口未重置或重启。

以下早前候选未完成说明属于当时状态，现行结果以上述收口为准。

## 本轮：同画布橡皮连续落笔

主管修复了橡皮无法使用同目标 paint 连续准入的问题：画笔与橡皮均按同一板、同一层的在途 paint 队列判定，非 paint 请求仍阻止续笔；保存期间的例外仍只属于画笔。跨画布接管没有随此修复放开。

完整构建、获准清单 **84 文件／963 项**通过（`/tmp/flow-eraser-chief-build.log`、`/tmp/flow-eraser-chief-suite.log`）。真实合成 Electron 窗口中，viewer/grid 快速橡皮均 8/8，400ms 对照亦 8/8，所有点 alpha=0；已固化 `scripts/flow-eraser-continuation-smoke.mjs` 并复跑通过（`flow-eraser-continuation-GhH1hN`，`/tmp/flow-eraser-chief-stable-gui2.log`）。综合绘画／保存／撤销／重开／恢复三阶段通过（`flow-workbench-smoke-6nRcwe`，`/tmp/flow-eraser-chief-workbench.log`）。首次固化脚本使用临时目录别名被安全拒绝，修正为规范路径后通过，失败日志保留。

当时跨画布与共享展示基底尚未完成；现已整合并验收，见本轮收口。真实数位笔、Windows 与长期内存仍待验，未重启用户试用窗口、未推送。

## 本轮：工具栏瘦身与绘画编码优化

已本地整合故事板／Pending 工具栏瘦身：移除批量选择和移动按钮，保留本桌键盘全选；Pending 使用独立记忆的尺寸滑杆和垃圾桶图标。主管补齐恢复默认布局同时恢复 Pending 尺寸，并在真实窗口验证独立调节与重置；原有撤销／重做和取回图标保留。

绘画准入改用廉价手势谓词，工作台提交不再生成被丢弃的整层 data URL。整合前，执行者以相同固定输入完成铅笔、软笔与预设橡皮四例整图 RGBA 零差对照；页面计数显示原有 2K 每笔 6 次整层编码（约 102–104ms）被消除。这证明减少编码工作，不代表已证明端到端首帧改善。

主管整合后完整构建与获准清单 **83 文件／958 项**全部通过。工具栏 GUI edit/reopen 通过（`flow-workbench-polish-gqbAk3`），含图标、两桌尺寸独立与恢复默认断言。日志：`/tmp/flow-ui-drawing-chief-build.log`、`/tmp/flow-ui-drawing-chief-suite.log`、`/tmp/flow-ui-drawing-chief-polish-elevated.log`。Pending 小桌子排序、边缘滚动、键盘移回和重开复验亦通过（`flow-pending-table-mX0sMu`），日志 `/tmp/flow-ui-drawing-chief-table.log`。首次受限环境的 GUI 子进程退出，保留 `/tmp/flow-ui-drawing-chief-polish.log`；随后隔离合成窗口正常通过。

当时的共享基底候选未获验收；现已由会话级共享展示实现替代，见本轮收口。

## 本轮：撤销、重做与取回图标

左侧工具栏底部的撤销/重做改为纯图标，保留悬停解释和可访问名称；取回外部改动改用文件夹向内箭头，忙碌时轻微明暗变化。原操作逻辑不变。完整构建和工具栏 GUI（含撤销、关闭重开、图标与提示属性检查）通过，获准全量 82 文件／945 项全部通过。未推送，未重启用户试用窗口。日志：`/tmp/flow-icon-buttons-build.log`、`/tmp/flow-icon-buttons-gui.log`、`/tmp/flow-icon-buttons-suite.log`；GUI 目录 `flow-workbench-polish-Q9YPRb`。系统原生悬停提示气泡的显示时序未自动取证。

## 本轮：Pending 小桌子整合

Pending 卡片与故事板共用外观、选择、框选和二维插入规则，显示只读台词，保留整卡拖动；点击不切右侧画布。候选 `0008ef6` 已本地整合至 `6c77dea`，未推送。执行者在隔离 worktree 完成 82 文件／945 项获准测试、构建，以及 Pending 小桌子、故事板选择、Pending 删除和工具栏四组 GUI 回归；覆盖键盘焦点恢复、内部组排序、跨桌插入、Pending 边缘滚动与重开。主管在实际整合版本 `6c77dea` 上独立完成 `npm run build`、显式枚举获准清单的 82 文件／945 项测试，以及小桌子和主故事板选择两组 GUI 复验，均通过。整合证据：`/tmp/flow-pending-chief-build.log`、`/tmp/flow-pending-chief-suite.log`、`/tmp/flow-pending-chief-gui.log`、`/tmp/flow-pending-chief-selection.log`；GUI 运行目录分别为 `flow-pending-table-s33Lts`、`flow-board-selection-lz56ps`（系统临时目录）。

该次整合尚不含绘画优化与跨画布修复；它们已在后续整合，见本轮收口。未验证触控/Windows，以及故事板侧视口外拖放和连续跨屏长距离滚动；用户试用窗口尚未重启。

## 上一轮：文稿标题与故事板工具栏

工作台顶栏只占一行：「项目」与「保存」使用同一按钮样式，窗口中央显示项目名；悬停露出箭头，点击展开命名信息。输入仍自动暂存，按 Esc、点「完成」或点外面可收起面板。「添加板」在故事板工具栏中紧邻「新建板」，图片仍加入 Pending。已用合成项目验证标题居中、键盘与鼠标关闭、命名恢复及隐藏 Pending 时添加；五组真实窗口回归、完整构建和 81 文件／938 项测试均通过。已生成本地 macOS arm64 试用包，截图与日志在 `.hermes/flow-titlebar/`。

## 上一轮：独立项目、Pending 和绘画

工作台支持从图片创建独立项目，打开或重访已有项目；Pending 的添加、批量撤销/重做，以及画笔预设、压感和滚动条交互已在隔离的合成项目中验证。本地整合代码为 `82c5ba3`。获准清单 81 个文件、938 项测试全部通过；完整构建、preload 同步和资源准备通过。当时采用常驻命名字段，现行入口见上。

在本机 macOS Electron、2048×1152 合成画布上，以窗口取色和资产摘要确认 10 笔均切到新图层像素；从抬笔到验证回显中位 191.5 ms，至磁盘 checkpoint 中位 753.5 ms。该测量包含检测开销，不是笔尖接触到实时预览的延迟，也不代表其他机器或 Wacom 手感。证据：`.hermes/flow-integration-nov04/brush-2k/`。

本机 arm64 应用已完成 ad-hoc 签名、ZIP 内容与许可证校验，并在 Finder 的默认 PATH、无 Python 覆盖设置下，从合成 PNG 创建独立项目并通过顶栏添加到 Pending，实际生成两处 TIFF 和对应 checkpoint。61 个构建文件与包内逐字节匹配；包内 14 个符号链接均指向包内有效目标。同一提交的 11 组 Electron 实窗验收通过，覆盖建项目、Pending 重试和关窗、滚动条拖动与滚轮、同名目标、命名焦点、最近项目管理、启动、绘画、布局、面板和 Pending 删除。产物和原始验证日志在 `.hermes/flow-integration-nov04/`；未推送或发布。包附带 TIFF 组件，本机使用已有的兼容 Python 解释器，不等同于新机器认证。

独立复验还覆盖：选择红色的铅笔在目标 PNG 与重开后均为 (255,0,0,77)；实时镜像在 Display P3 和 sRGB 两种环境均和源窗口同色。macOS Pending 事务在接近 8 MiB 账本上意外中断后连续重开不重复加板，外来替换或原地编辑的文件保留。Windows 当前不提供直接添加到 Pending；Windows 运行与打包未认证。

## 已实现与交接

新工作台是开发、默认和打包的唯一入口。旧 App、RecoveryEntry、经典 Grid/Japanese/Inspect、旧 IPC 和专属后端已退役；当前工作台的普通/日式布局保留。旧前端在 `archive/legacy-frontend/`，旧后端由 Git 历史追溯；[退役清单](../archive/legacy-frontend/retired-paths-2026-11-03.json)记录 608 项路径及对应测试，原始归档 284 文件曾核对完整性。

当前包含：直接绘画与图层、适合缩放、修饰键/范围/全选/框选、整组静态插入排序、上下分隔条和两栏图标折叠、对白分组撤销与组合输入守卫、Pending恢复/删除、显式TIFF保存与手动外部刷新。旧 Inspect播放、Matte/对白叠加设置、拖色Fill入口未迁入；已有呈现数据及核心编解码保留。不要把已退役入口自动列为待恢复功能。

旧命名窗、编号预览和工作副本的历史证据见 `.hermes/workbench-toolbar-nov04/`；这些证据不代替新版入口及常驻命名字段的验收。

日式分镜行布局已在本机 macOS 验收：宽窄两档均可编辑，镜号把手移动整板、对白把手只移动对白。当时的布局 GUI 验证了旧版右栏拒绝拖放，以及日式行插入与撤销；6 板合成项目的编辑、重开、恢复三阶段通过（临时运行目录 `flow-workbench-smoke-Nn4en4`）。该次结果不覆盖大项目性能、真实鼠标手感或 Windows。 随后的视觉修订将镜号列缩至 44px，正文去框，六点握把悬停或键盘聚焦时显示。最终构建的布局 GUI 三阶段通过（`flow-workbench-smoke-9pmvZZ`）；同构建较早一次等待对白暂存超时，原因未确认。

右栏台词现支持同板重排、与日式行双向跨板及撤销，正文随文字增高。合成 Electron 对无效落点、取消、跨板后条目身份与板序、撤销还原均通过（布局三阶段：`flow-workbench-smoke-PCQADw`）；真实鼠标拖至滚动区外的交互与 Windows 未验。

子Agent交付与审查已汇总，无遗留执行者写权。整理前主树基线为 `e8bd9db`；本轮及此前已验收工作纳入此次提交范围。用户已在知悉main自动发布开关开启后确认直接推送main；推送可能触发现有发布流程，是否发布成功须另查CI结果。提交与远端实际状态以Git为准，开始工作须重查，不覆盖无关的 `D CLAUDE.md`。文档合并删除历史任务书不会重新授权旧波次任务。

## 验证证据与边界

以下结果只对应当时受验代码，不代替新改动的验收。

目录架构迁移及独立审查后的职责修正自测：获准清单按最终路径映射后 72 文件、802 项通过；聚焦 7 文件、154 项、完整构建、preload 一致性、资源准备及发布包校验脚本通过。映射和原始日志已从系统临时目录留存到 `.hermes/module-migration-nov03/`（映射 `flow-module-migration-map.json`、最终测试 `flow-migration-r2-suite.log`）；当前可执行测试清单见 `test/allowed-suite.json`。首次测试发现并修复 codec XPath 重写错误及测试根路径错误，失败日志与失败夹具保留。第二轮独立代码复审的两项阻断已关闭，未发现新增代码阻断。迁移后真实 Electron 综合流程（绘画、Undo/Redo、TIFF Save、关闭重开、模拟恢复）与默认启动 cancel/open/reopen 均通过，日志为 `.hermes/module-migration-nov03/flow-migration-gui-workbench-elevated.log` 和 `.hermes/module-migration-nov03/flow-migration-gui-startup-elevated.log`。首次沙箱内启动失败记录保留，获准沙箱外重跑通过；仅使用合成项目和隔离 userData。实际窗口安全参数与 renderer 全局变量隔离尚未由脚本动态核验，原生 Trash、输入法、硬件及跨平台不由这些结果认证。未发布。

| 候选 | 已验证 | 证据 |
| --- | --- | --- |
| 唯一工作台与旧路径退役 | 72文件/802测试、完整构建、preload、资源检查；默认启动与六套GUI；macOS打包应用实际保存/关闭；独立审查 | `.hermes/retire-paths-nov03/` 内 `acceptance.json`、`candidate-sha256.json`、`archive-hashes.json`、`gui-final.json` |
| 统一启动器 | 72文件/802测试、完整构建、独立审查、实际进程启动与配置锁握手；GUI目视仍待验 | `.hermes/launcher-unification-nov03/`；实际启动日志 `.hermes/launch/20261103-165816-31548.log` |

退役的335个旧测试有逐项映射，未用删除测试掩盖现行失败。综合GUI首次失败及修正记录保留在退役证据中。启动器目视检查受同标识Electron欢迎窗口干扰，未关闭归属不明的窗口。历史PID不能用于后续进程操作。macOS产物在 `/private/tmp/flow-retirement-package/2026-11-03T08-37-18-878Z/`，未发布；该打包结果属于目录迁移前的退役候选，不代表迁移后安装包已再次验收。

测试配置已统一为 `vitest.config.ts`，删除未被现行命令引用的重复 `vitest.full.config.ts`。统一后获准72文件/802测试与完整构建通过；日志在 `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-config-unify-SZHX5d/`。未改产品逻辑，未新增GUI验收。

较早对白提交失败/双owner/重试、Pending Save/Undo/重开证据在 `.hermes/pending-chief-review/`、`.hermes/final-nov03/`；B1/B2与过期宿主回显修复在 `.hermes/evidence/dialogue-b1b2-review/`。选择/分栏/静态排序较早证据在 `.hermes/board-bridge-nov03/`。全部为对应候选的证据，不能复用为任意新改动的PASS。

## 用户数据与本轮清理

`.hermes/studio-preview/project` 已有用户画稿，不是可重置的合成夹具。操作前重新读取实际状态，不沿用旧板数或版本号。正常关闭对应实例，保留画稿与布局。

`.hermes` 已按用户授权清理四份有成功重开记录的合成性能测试副本，释放约553 MiB；测试报告与checkpoint JSON保留，清单见 `.hermes/cleanup-nov03/synthetic-bench-cleanup.json`。用户画稿、标准样本、来源未明内容、恢复/失败记录、旧工作区备份均未删除；不清理项目原件、用户旧资产、依赖和系统临时证据。默认profile在Electron appData的 `Storyboard Flow Workbench`；`FLOW_USER_DATA_DIR`可指定隔离profile。默认单实例锁不保证不同显式profile对同一项目的跨进程互斥。

## 尚未完成

- 默认Electron入口的合成GUI流程已通过；Finder双击启动器的人工目视验收仍待完成，继续收集工作台实际试用反馈。
- 真实鼠标/数位笔持续绘画、选区变换、缩放/平移和快速图层切换。历史组透明度偶发问题只有有限重跑证据，先复现再开修复；模糊已获用户认可，无活动缺陷。
- 原生IME、双对白实例、组合结束后立即关闭及失败重试时序。合成输入通过不认证所有原生事件顺序，早期偶发结果未完全解释。
- 当前静态拖动在1000板/大图、无并发负载下测量；32GB参考机器、长时间内存和缩略图策略。96条URL缓存不是字节预算，卡片DOM未虚拟化。
- Markdown导出GUI位置待定，checkpoint导出CLI已有；不恢复Markdown导入或持续外部写入。
- 原生Trash恢复/重试、敌对中断窗口、跨机/可移动文件系统；Windows运行、安装器及Python资源验收。
- Photoshop2026真实分层Refresh仍未认证：曾因TIFF tag34377和扩展XMP安全拒绝。创建独立合成底图工作副本不是完整分层往返。原PS文档后续追踪、自动观察、外部重命名/重新关联/新文件发现需要单独范围。

PSD优先、完整PS往返、SQLite、音频/时间轴扩展、PDF、云协作和内置AI不在当前范围。跨平台认证和发布仍未完成。

清理收尾：删除搬空的根 `electron/`、空 `research/` 与旧 History 实验夹具、wave-1 专用验证脚本、过期 Drawing/Storyboard 迁移说明；移除测试配置中不存在的 electron 测试目录。现行存储契约、开发验证脚本、archive、依赖与构建产物保留；`.hermes`仅清理上文明确列出的合成副本。

## 今日收尾与下次工作（2026-11-03）

- 本地提交 `b356f5a` 已完成，提交前72文件/802测试、完整构建和preload检查通过。首次 `git push origin main` 被必需云端测试规则拒绝。随后用户明确授权取消该推送前门槛，已移除 `required_status_checks`；推送后的CI、禁止强制推送和禁止删除main保持不变。用户要求保持单一main，未创建备份分支。推送与发布结果须分别核验，不以本地提交或CI启动代替成功。
- 三位Terra的实现、独立复审和GUI交付均已收齐，无执行者在运行或持有写权；Paseo旧子会话已归档。Codex原生接口不提供归档操作，保留已完成会话记录，不再派工。汇总及提交前日志在 `.hermes/module-migration-nov03/agent-closeout.json` 和同目录 `precommit-*`。
- 计划下一轮按主模块安排GPT-6.1 Terra子Agent，用户可直接与模块负责人讨论；跨模块接口、方向与范围变化先由chief协调。按需分批启动，明确独占写入范围，负责人实现自测后回报，chief组织独立审查与整体验收。优先围绕workbench、storyboard、drawing开展产品交互讨论；session、project-files、platform按具体需求参与，不强制同时启动六位。
- 此收尾记录与推送规则调整在架构提交之后单独记录；无关的 `D CLAUDE.md` 继续保留现场，不纳入任务。
