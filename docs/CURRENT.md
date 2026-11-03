# 当前状态与剩余工作

更新：2026-11-03。这里记录状态；操作约束见 [AGENTS](../AGENTS.md)，接口见[架构](ARCHITECTURE.md)。

## 已实现与交接

新工作台是开发、默认和打包的唯一入口。旧 App、RecoveryEntry、经典 Grid/Japanese/Inspect、旧 IPC 和专属后端已退役；当前工作台的普通/日式布局保留。旧前端在 `archive/legacy-frontend/`，旧后端由 Git 历史追溯；[退役清单](../archive/legacy-frontend/retired-paths-2026-11-03.json)记录 608 项路径及对应测试，原始归档 284 文件曾核对完整性。

当前包含：直接绘画与图层、适合缩放、修饰键/范围/全选/框选、整组静态插入排序、上下分隔条和两栏图标折叠、对白分组撤销与组合输入守卫、Pending恢复/删除、显式TIFF保存与手动外部刷新。旧 Inspect播放、Matte/对白叠加设置、拖色Fill入口未迁入；已有呈现数据及核心编解码保留。不要把已退役入口自动列为待恢复功能。

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
