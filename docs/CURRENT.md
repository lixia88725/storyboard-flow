# 当前状态与剩余工作

更新：2026-11-06。这里记录状态；操作约束见 [AGENTS](../AGENTS.md)，接口见[架构](ARCHITECTURE.md)。

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
