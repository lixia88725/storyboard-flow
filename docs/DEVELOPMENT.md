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
