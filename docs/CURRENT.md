# 当前状态与剩余工作

更新：2026-11-04。这里记录状态；操作约束见 [AGENTS](../AGENTS.md)，接口见[架构](ARCHITECTURE.md)。

## 已实现与交接

新工作台是开发、默认和打包的唯一入口。旧 App、RecoveryEntry、经典 Grid/Japanese/Inspect、旧 IPC 和专属后端已退役；当前工作台的普通/日式布局保留。旧前端在 `archive/legacy-frontend/`，旧后端由 Git 历史追溯；[退役清单](../archive/legacy-frontend/retired-paths-2026-11-03.json)记录 608 项路径及对应测试，原始归档 284 文件曾核对完整性。

当前包含：直接绘画与图层、适合缩放、修饰键/范围/全选/框选、整组静态插入排序、上下分隔条和两栏图标折叠、对白分组撤销与组合输入守卫、Pending恢复/删除、显式TIFF保存与手动外部刷新。旧 Inspect播放、Matte/对白叠加设置、拖色Fill入口未迁入；已有呈现数据及核心编解码保留。不要把已退役入口自动列为待恢复功能。

2026-11-04 工作台顶部操作栏与命名表单（本地改动，未提交未推送）：按钮改为「打开 · 命名 · 保存」加刷新图标；「从 TIFF 创建工作副本」整条入口退役，含 `flowPhotoshopCopy` 模块与测试、IPC 的 `photoshop-copy` 参数、allowed-suite 条目和相关脚本文案，独立副本改由用户复制项目文件夹后「打开」。命名改为窗口表单；预览按打开时一次性取得的真实绑定文件名计算，与 Save 用同一批 ledger 条目（只读接口 `outputNames`，不写盘），Pending 占用编号会如实跳过；读不到绑定则不给预览并禁用应用。输入法组字期间的 Esc 不关表单，回车组字也不提交。状态栏前缀改为「已自动暂存」。

验证（本轮）：类型检查、完整构建、preload 一致性通过。合成 Electron 实测两例：①先把 3 张板保存为 0010/0020/0030，再把其中一张移入 Pending 并调换顺序，命名预览显示 0020/0030，点保存后磁盘上确实只有 0020/0030 在根目录、0010 留在 `Pending/`；同一状态下若按旧的 `shot.name` 计算会显示 0010/0020，说明差异是真实的。②把已有项目文件夹整份复制后打开副本：能加载 2 张板、改名应用、保存成功，副本生成新文件名，原文件夹 11 个文件的 sha256 清单前后完全一致。另有 external 状态的实拍：外部改动时刷新图标 `data-external=true` 且计算色为蓝色，三组 Esc 行为（组字中/组字态未结算/结算后）分别是不关、不关、关闭。证据在 `.hermes/workbench-toolbar-nov04/`（`accurate-preview.mjs`、`sheet-behaviour.mjs` 及其 report/summary 与截图）。构建产物已复查，`dist/`、`dist-electron/` 无工作副本残留；历史 GUI 驱动只同步了文案选择器，未全量重跑。

主管复验：命名窗按本次读取结果决定是否允许应用；重读时立即隐藏旧预览，过时的成功回复不会解除新错误。首次保存前的 Pending 默认文件名也参与编号避让；账本有待恢复事务，或恢复到 Pending 的文件尚需在保存时重新命名时，预览只提示先处理，不结算事务。真实 Electron 同窗重读、过时回复及恢复的记录见 `.hermes/workbench-toolbar-nov04/reconciled-gui.json`。活动故事板卡头仅显示序号和靠右把手，不改镜头元数据及 Pending 标签；真实 Electron 卡头、选择和拖动验证通过。两项命名阻断经独立复审关闭，最终命名窗按当前快照与读取请求标记隔离结果。获准套件 72 文件 / 805 项（含 3 项命名读取回归）、完整构建、preload 一致性均通过。

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
