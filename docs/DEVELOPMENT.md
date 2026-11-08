# 开发工具与验证指南

开发约束与禁止输入见 [AGENTS](../AGENTS.md)，进度和待验事项见 [CURRENT](CURRENT.md)。本文只保留本项目的特殊做法和工具入口。

## 项目注意事项

- 用户画稿在 `.hermes/studio-preview/project`，不能当测试夹具。测试配置可用绝对路径 `FLOW_USER_DATA_DIR` 指定。当前数据保护范围见 [CURRENT](CURRENT.md)。
- 文件系统测试使用 `test/temporaryWorkspace.ts` 创建系统临时容器；副本也放在容器内。清理须核对自有身份，不跟随符号链接；失败或中断保留现场。遇到不明锁或验证退出码75，交主管处理。
- 完整测试使用 [获准枚举清单](../test/allowed-suite.json)。移动测试时同步路径，新增获准测试明确加入；不因沿用旧清单漏跑。`.hermes/retire-paths-nov03/allowed-suite.json`仅是旧候选证据，不用于当前运行。禁止输入仍以 AGENTS 为准。
- CI 同样显式枚举获准清单，测试步骤设置 `NODE_OPTIONS=--max-old-space-size=4096`，单 worker 执行。该上界用于最重 TIFF 保存测试；本机单文件峰值 RSS 约 3.4GB，不代表云端或整个应用的内存上界。不得靠删减预算断言降低负载。
- 下列GUI脚本使用 `dist/`、`dist-electron/` 构建产物；执行前置条件和验证边界统一见 [AGENTS：验证与交付](../AGENTS.md#验证与交付)。

## 启动与专项检查

| 场景 | 入口 |
| --- | --- |
| 启动试用 | 根目录 `启动 Storyboard Flow.command`：先构建再启动；`--choose` 选择项目 |
| 修改主进程与界面的桥接（preload） | 运行 `npm run check:preload`（TS/CJS桥接一致性检查） |
| 修改打包资源 | 运行 `npm run prepare:package-resources`；Windows用内置Python，macOS用可用Python3，缺失时报告，不擅自安装 |

启动器在检查实例锁前建立日志；本机锁对应进程明确不存在（`ESRCH`）时，将 `SingletonLock/Cookie/Socket` 链接本身备份到 `.hermes/launch/stale-lock-*` 后恢复启动，不跟随链接、不删除项目数据。仍存活的实例沿用正常关闭流程，不强杀；权限不足、外机或异常锁类型保留并报错。启动互斥锁记录进程，启动交接期间绑定子进程，防止 Terminal 中断后重复启动。旧版无进程身份的目录锁不自动清理。

启动器专项：`node --test scripts/launch-locks.test.mjs`（独立 Node 测试，未混入 Vitest 清单），含合成 shell 启动、失败日志和锁恢复；macOS 沙箱若禁止 `/dev/fd`，需在允许日志管道的本地环境执行。此专项不会启动真实 Electron 或读取用户项目。

执行完整清单（不会自动发现清单外测试）：

```sh
node --input-type=module -e 'import fs from "node:fs"; import {spawnSync} from "node:child_process"; const files=JSON.parse(fs.readFileSync("test/allowed-suite.json","utf8")); const r=spawnSync(process.execPath,["node_modules/vitest/vitest.mjs","run",...files],{stdio:"inherit"}); if(r.error) throw r.error; process.exit(r.status ?? 1);'
```

测试统一使用根目录 `vitest.config.ts`，完整与聚焦检查共用该配置；测试前置准备在 `vitest.setup.ts`。其余命令以 [package.json](../package.json) 为准。构建会清理旧Electron产物；旧界面与波次验证入口已退役，不从archive恢复运行。

## GUI验证脚本索引

| 检查什么 | 脚本 |
| --- | --- |
| 独立创建、添加图片与重开 | [flow-project-entry-smoke.mjs](../scripts/flow-project-entry-smoke.mjs)；必须使用真实创建后端。阶段：home（两个动作、取消、损坏项目拒绝）、import（图片文件夹→确认页→2 板与 TIFF）、blank（空白项目→新建板→保存）、legacy（旧工作簿仅图片提示、取消不建目录）、reopen、open（Flow 项目直接打开）、pending |
| Pending 小桌子、二维排序、边缘滚动与键盘移回 | [flow-pending-table-smoke.mjs](../scripts/flow-pending-table-smoke.mjs)，包含重开验证 |
| Pending 回包丢失、重试及关窗 | [flow-pending-close-recovery-smoke.mjs](../scripts/flow-pending-close-recovery-smoke.mjs) |
| 命名保持焦点时暂存、失效最近项目 | [flow-naming-focus-smoke.mjs](../scripts/flow-naming-focus-smoke.mjs)、[flow-recent-manage-smoke.mjs](../scripts/flow-recent-manage-smoke.mjs) |
| 同名最近项目、隐藏 Pending 面板后从故事板工具栏添加 | [flow-target-rules-smoke.mjs](../scripts/flow-target-rules-smoke.mjs) |
| 透明轨道及拖动滑块 | [flow-scrollbar-drag-check.mjs](../scripts/flow-scrollbar-drag-check.mjs) |
| 默认启动、选择目录、关闭与重开 | [flow-startup-smoke.mjs](../scripts/flow-startup-smoke.mjs) |
| 跨画布共享展示、冷解码、Undo 和固定输入像素对照 | `node scripts/flow-paint-presentation-smoke.mjs` |
| 关闭竞态、预算选择与提交失败恢复 | `node scripts/flow-paint-presentation-smoke.mjs --recovery` |
| 重新叠画顺序及 unknown／retained 导出、正常关闭和重开 | `node scripts/flow-paint-presentation-smoke.mjs --recovery-contract`，下载限制在该次临时证据目录 |
| 普通／日式共用尺寸滑杆 | `node scripts/flow-japanese-sizing-smoke.mjs`，含窄栏、排序、撤销及重载 |
| 工具快捷键与临时橡皮 | `node scripts/flow-tool-shortcut-smoke.mjs`，真实键盘、双画布与延迟回包 |
| 大画布与卡片的快速橡皮连续落笔 | [flow-eraser-continuation-smoke.mjs](../scripts/flow-eraser-continuation-smoke.mjs)，8 笔像素及 revision 断言 |
| 绘画、排序、恢复综合流程 | [flow-workbench-smoke.mjs](../scripts/flow-workbench-smoke.mjs) |
| 修饰键、框选、整组插入、Pending | [flow-board-selection-smoke.mjs](../scripts/flow-board-selection-smoke.mjs)；`FLOW_GESTURE_SCROLL=1` 加验长日式行滚动 |
| 分隔条、折叠、弹出面板与布局恢复 | [flow-dock-panels-smoke.mjs](../scripts/flow-dock-panels-smoke.mjs) |
| 日式布局、共享绘画预览与图层稳定性 | `node scripts/flow-workbench-layout-smoke.mjs`，按下接管、双面屏幕像素、撤销重做及重开 |
| 适合画布、工具栏、日式对白拖动 | [flow-workbench-polish-smoke.mjs](../scripts/flow-workbench-polish-smoke.mjs) |
| 对白分组撤销与重开 | [flow-dialogue-undo-smoke.mjs](../scripts/flow-dialogue-undo-smoke.mjs) |
| 对白提交失败、双编辑器、重试与关闭 | [flow-dialogue-failure-smoke.mjs](../scripts/flow-dialogue-failure-smoke.mjs) |
| Pending删除、保存、撤销与重开 | [flow-pending-delete-smoke.mjs](../scripts/flow-pending-delete-smoke.mjs) |
| 拖动性能 | [flow-workbench-drag-perf.cjs](../scripts/flow-workbench-drag-perf.cjs)；先核对当前拖动DOM与采样口径，同机器/负载比较 |

## 打包与发布

macOS 包附带 TIFF 组件，不附带 Python 解释器。第一次处理 TIFF 时会验证所选 Python 能实际载入包内组件；显式设置的 `FLOW_PYTHON_BIN`（或 `FLOW_PYTHON_PATH`）不兼容会报错，不静默替换。未指定时检查 PATH、Homebrew 与系统级 Python 安装。验收 Finder 启动路径时，用 `/usr/bin:/bin:/usr/sbin:/sbin` 且不设上述环境变量，从合成 PNG 创建项目并核对输出 TIFF；仅成功显示窗口不足以验证这个路径。

流程以 [.github/workflows](../.github/workflows) 和发布脚本为准；使用已安装依赖，保留第三方许可。`RELEASE_ENABLED` 开启后，main推送可能触发发布，必须获得发布授权并实时核对开关。发布安装包与更新下载索引是两步，分别确认；失败保留旧索引。Git代码备份不包含Release安装包。各平台验收状态见 CURRENT，不沿用旧客户端的认证。

## Photocraft 原生组件

源码运行扩展 TIFF/PSD 和打包前，显式准备固定 Rust 1.99.1，再运行 `npm run setup:photocraft`、`npm run build:photocraft`；普通启动与 JS 构建不自动安装工具链。可用独立 RUSTUP_HOME/CARGO_HOME，操作入口、固定上游及许可证见 [组件说明](../native/photocraft/README.md)。原生 fixtures 是相关获准测试前置；缺失组件/过期回执会阻止打包。CI test 和 macOS/Windows package 均准备原生目标，真实 Windows runner 仍待验证。

组合专项：`node scripts/flow-dock-panels-smoke.mjs` 检查分隔条调宽/折叠/取消/键盘/重开；`node scripts/flow-photocraft-smoke.mjs` 检查扩展导入与保护；`node scripts/flow-psd-export-smoke.mjs` 检查真实导出入口、取消和已有目标保护。均使用合成数据及独立 userData。独立像素、Photoshop 验证入口和边界见组件说明，不用同一解码器的往返代替兼容性证明。


## 新图片发动机隔离接线验证

当前宿主连接专项 `src/platform/main/imageEngineConnection.test.ts` 需要显式 `FLOW_IMAGE_HOST` 指向与受验提交绑定的真实 `flow-photocraft-host`。未指定时失败，不跳过、不替换 fake；在宿主构建准备尚未接入通用清单前，该测试单独执行。`imageEngineTransport.test.ts` 的合成子进程只认证故障协议，不能替代真实宿主证据。固定二进制、SHA 与构建回执应随日志记录。

帧拆包、接收器、原件保管与 transport 故障测试已明确加入获准清单。Canvas 专项 `node scripts/flow-image-frame-display-smoke.mjs` 使用隔离 Electron、双 Canvas 和录制原生帧；录制回放不证明实时 native 整链性能。使用 dist 的检查仍须先完整 build。


真实串行宿主显示专项：完整构建后显式设置 `FLOW_IMAGE_HOST`，运行 `node scripts/flow-image-engine-live-smoke.mjs`。它实际调用宿主并将实时帧经 Main/MessagePort 交给两 Canvas；结果分别记录请求 RTT、Canvas ACK 和截图耗时，不能称作物理笔到屏幕延迟。截图同时保留独立透明 CSS 参考和不透明算术预混对照。默认固定候选路径只用于施工证据复现，正式环境应显式指定受验宿主。

图片发动机施工专项（不自动混入无需原生组件的测试）：`FLOW_IMAGE_HOST=<固定宿主绝对路径> node node_modules/vitest/vitest.mjs run src/platform/main/imageEngineConnection.test.ts`；连续笔链要求 `strokePipelineV1` 能力。项目锁专项：`FLOW_PROJECT_LEASE_BINARY=<锁辅助程序绝对路径> node node_modules/vitest/vitest.mjs run src/platform/main/imageProjectLease.test.ts`。两者缺少真实组件时明确失败，不使用假后端代替；执行前记录组件提交及摘要。

连续绘画真实显示专项：`node scripts/flow-image-engine-pipeline-smoke.mjs`（先完整构建）；`FLOW_IMAGE_HOST` 指向固定 `strokePipelineV1` 宿主，`FLOW_IMAGE_CONNECTION_DIR` 可指定需验证的 Main 接点源码。脚本复制两个明确文件并记录摘要，使用独立临时项目/profile。该专项检查原生队列到双 Canvas，不伪造 Main 项目 CAS。`node scripts/flow-image-engine-pipeline-metrics.cjs <result.json>` 从原始 trace 派生包含所有准入重试的逐笔区间；无节拍 burst 不等同于正常采样节拍。

Main 项目实际连接专项：`FLOW_IMAGE_HOST=<固定宿主> FLOW_PROJECT_LEASE_BIN=<真实lease> node node_modules/vitest/vitest.mjs run src/project-files/main/image-engine/nativeSession.test.ts`。冻结版本输出专项使用 `FLOW_PROJECT_LEASE_BINARY`（注意当前两个专项变量名不同）与支持 `immutableVersionExportV1` 的 `FLOW_IMAGE_HOST`，运行 `src/platform/main/imageEngineOutput.test.ts`。都需要真实组件；临时专项尚未并入无环境设置的通用清单。

双 Canvas 节拍专项设置 `FLOW_PIPELINE_SAMPLE_INTERVAL_MS=10`；默认 0 为 burst。报告绝对 deadline、所有积压/重试与 oracle 开销，截图移出 paced 输入窗口。构建/全量等并发负载需记录，不把 native accepted 的轮询观察时间当硬盘持久耗时。

原生发动机施工的附加获准清单为 `test/allowed-image-engine-suite.json`，内容以该清单为准。完整发动机验收须同时报告通用清单与该附加清单，不能因原生环境缺失静默跳过。准备固定宿主后，设置 `FLOW_IMAGE_HOST`、`FLOW_PROJECT_LEASE_BINARY`，并暂令 `FLOW_PROJECT_LEASE_BIN` 指向同一 guard；使用上方显式枚举命令，将清单路径改为该附加清单即可。当前正式 CI 尚未接这组施工专项，不把通用 CI 通过当新发动机整体验收。

真实 Main 项目双画布专项：设置 `FLOW_IMAGE_HOST`、`FLOW_PROJECT_LEASE_BIN` 指向固定真实组件，再运行 `node scripts/flow-main-image-pipeline-smoke.mjs`，脚本先使用真实 ProjectStore/lease/NativeSession；`FLOW_MAIN_PIPELINE_MODE=paced` 启用 40 笔节拍（运行前核对脚本当前参数）。保留全部背压重试，metrics/service 派生文件不能把 API 总耗时当单次 fsync。统计测试 `node --test scripts/flow-main-image-pipeline-metrics.test.cjs` 不需要 GUI；性能窗口需协调暂停其他重负载。

上下文接点专项 `imageEngineContext.test.ts` 使用支持四项 context/decimal 能力的真实宿主，覆盖选层不改版本、浮动选区及取消后显式展示代次切换。纯 Main 输入控制测试 `src/session/core/nativePipeline.test.ts` 纳入通用获准清单。

Main 保存链性能复测：使用同一固定 release 宿主，完整构建后先跑 small 生命周期，再以 `FLOW_MAIN_PIPELINE_MODE=paced FLOW_MAIN_PIPELINE_PROFILE=1` 跑 40 笔/280 batch。profile 的透明 warmup 是真实操作，不等于产品无副作用预热。`flow-main-image-pipeline-profile-report.cjs <result.json> <output-prefix>` 分别输出逐笔和批次统计；每笔 end 后立即观察 waitOperation，最后 Canvas ACK、最终确认及 freeze/close 分开计时。不得把旧“下一 CAS 等前笔 resolution”当新架构要求；CAS 与 native acceptance 各自 FIFO，最终确认和预算保护仍须断言。

统一 journal 施工验收：沿用上述同宿主、同输入和全部重试计时，新增段文件/续段清单同步分类。长期开启的文件句柄也须统计；合批 flush 的异步父调用只表示调度来源，不能把整个同步成本归给该笔，使用 journal 汇总次数与真实最终确认时间。文件恢复聚焦须覆盖未封口尾部、完整封口回执丢失、中间损坏、续段发布各失败点、旧 writer 拒绝新格式，以及全项目实际占用加预留预算。普通崩溃恢复必须保留旧段、确认前缀与完整输入；测试用自有临时项目，不迁移用户数据。

## 原生工作台施工验证

施工分支的 `build:photocraft` 现在离线、锁定依赖构建 release reader/host/lease，并在合成目录实际探测后发布到 `native/photocraft/target/flow-release`。`nativeComponentPaths` 统一源码与包内定位，显式测试环境变量仍可指向受验固定候选。回执 protocol2 绑定三个组件、完整自有源码、目标架构、实际能力与许可证；签名后逐组件更新摘要，ZIP再次核验。不能只带一次性reader或沿用debug目录冒充完整引擎。独立脚本检查为 `node --test scripts/package-native-probes.test.mjs` 与 `python3 scripts/validate-release-links.test.py`；真实 ZIP 校验仅允许已知 macOS Framework 的固定、包内可解析相对链接，原生组件与应用文件仍不得为别名。当前Windows项目锁未实现，打包明确拒绝，不宣称Windows可运行。


新的只读控制器、冷输入捕获、Main端口与项目切换测试显式登记在 `test/allowed-suite.json`。真实原生预设与图层命令测试登记在 `test/allowed-image-engine-suite.json`，需以本次能力匹配的原生宿主执行；旧debug binary或只通过TypeScript构建不能替代这些检查。两清单合并去重后才是本轮组合全量。`npm run check:preload`同时检查嵌套imageWorkspace方法、原始输入身份及MessagePort转交；它是隔离桥接检查，不替代真实Electron连接验收。

实际原生工作台专项：完整 `npm run build` 后，设置 `FLOW_IMAGE_HOST` 与 `FLOW_PROJECT_LEASE_BINARY`，运行 `node scripts/flow-native-workbench-smoke.mjs`。它通过私有 `FLOW_NATIVE_WORKSPACE=1` 启动真实入口，使用临时合成原生项目和独立profile，禁止Clipboard/Trash，检查双画布RGBA、真实落笔、Undo/Redo、正常关闭、新进程重开及恢复记录只读入口。`FLOW_CREATION=1` 扩展真实新建板、白底及历史选择回归；`FLOW_SOURCE_IMPORT=1` 扩展合成外部文件夹导入与重开（需已接通来源Runtime，编写存在不等于验收通过）。这个开关只供施工验收，不代表默认入口已迁移；`FLOW_SAVE=1` 检查实际保存按钮、输出TIFF与画布像素、重复保存不改文件和撤销记录、关闭重开；这仍不覆盖受保护来源输出及完整Refresh/Pending。`FLOW_SAVE=1 FLOW_COLD_COPY=1` 另加正常关闭后完整复制、独立profile打开副本及原项目文件摘要不变；Runtime已接入并实测，证据见CURRENT。`FLOW_PROTECTED_IMPORT=1 FLOW_SOURCE_IMPORT=1 FLOW_SOURCE_IMPORT_ONLY=1` 预备复杂PSD/轻微差异PSD/PNG导入绘画与Save重开组合；当前尚待受保护输出接线实测。合成夹具解释器可通过 `FLOW_SOURCE_GUARD_PYTHON` 与 `FLOW_SOURCE_GUARD_PYTHONPATH` 指定，复用已获准的任务局部Python依赖，不自动安装；授权个人TIFF corpus不加入全量清单。原生附加清单中的workspaceCreation还需要已准备的一次性读取组件（见其测试的显式环境变量）。

施工来源GUI：完整build后，`FLOW_SOURCE_IMPORT=1` 增加合成两张PNG/一张坏图的真实打开、绘画历史与重开；仅复验该组可同时设 `FLOW_SOURCE_IMPORT_ONLY=1`。`FLOW_SAVE=1` 的工作文件保存附加断言已准备，尚待Runtime输出接线后执行，不能计为已通过。组件与隔离要求沿用上面的原生工作台脚本。
