# Integration plan — after Hermes wave 1

2026-10-29；源码观察基线 main `c3e8a05`。**设计提案，未实现，不修改当前 Hermes 契约。**
沿用 codebase-design：把有状态编排藏在小的 Interface 后，UI 不学习文件事务和资源保留细节。

## Current seams confirmed by source

| 当前路径 | 实际职责 | 接入时不能遗漏 |
| --- | --- | --- |
| [App.tsx](../../src/renderer/App.tsx) → [projectEditController.ts](../../src/renderer/projectEditController.ts)、[dialogueActionController.ts](../../src/renderer/dialogueActionController.ts) → updateProject | 文字/命名/对白更改；App 仍负责组合控制器 | 不能让两个 Project 对象成为各自可写的事实来源 |
| [JapaneseStoryboardView.tsx](../../src/renderer/JapaneseStoryboardView.tsx) japaneseStoryboardRows | 同一 Project 投影为 actionText/dialogueText，接收绘图回调 | 日式分镜是视图，不是另一个保存模型 |
| [bitmapLayerPaintingController.ts](../../src/renderer/bitmapLayerPaintingController.ts) → bitmap queue → effect/历史完成回调 | 写 PNG、采集前状态并处理完成/失败 | wave-1 replacePixels 只接收引用，不会自动生成 PNG |
| [projectHistoryController.ts](../../src/renderer/projectHistoryController.ts) | 项目、选择、PNG 快照；恢复与队列/ACK 相连 | 不可把现有恢复流程替换成单纯 setState 后就称功能相同 |
| [workspaceAutosaveController.ts](../../src/renderer/workspaceAutosaveController.ts) → [normalSaveAppAdapter.ts](../../src/renderer/normalSaveAppAdapter.ts) | 当前 600ms 调度；App 绑定 adapter.autosave；失败/完成归属捕获工作区 | 内部保存不等于 TIFF 已输出；旧回调不能清掉新编辑 |
| App handleSaveProject → adapter.save → owner/preload/Main | 排他 Save、命名/导入前提、持久化和输出收据 | Main 的文件/恢复协议不能由 renderer 状态声明替代 |
| [storyboardDragEndController.ts](../../src/renderer/storyboardDragEndController.ts) pendingTransition | Pending 不仅数组变化，还有输出/持久化 ACK | 新核心 moveShots 不具备这些副作用 |
| [managedSourceSave.ts](../../electron/main/managedSourceSave.ts) 与 Main | 来源对应、首次备份、显式 Save 写回 | 工作 TIFF 与来源根图片两类文件，删除/命名政策不能混用 |

以上为源码观察。历史 GUI 记录见 context-handoff.md，但本轮没有复跑。

## Composition proposal

UI 手势/文本输入 → 小型 project session Interface → storyboard history → drawing 编辑结果。
Session 发布单一当前 Project，并调度 persistence checkpoint；formats 负责 TIFF 编解码；
platform/files 负责受限文件操作。Session 是应用编排，不新增第六个平行业务数据模型。

- storyboard 拥有顺序、成员、对白/脚本、项目历史；drawing 拥有像素制作与图层合成。
- persistence 拥有内部资产/版本/head 的落盘与校验，不能决定用户何时写回 TIFF。
- formats 将受支持的 TIFF 解析成可编辑图像或生成交换输出，不控制选择/历史/工作区。
- UI 的工具、焦点、缩放、临时 selection 独立于作品数据；哪些需要跨会话记忆另行明定。
- 只允许一个当前项目写入入口；旧结构仅可作受控只读视图投影，不能双向自动同步两份模型。

### One edit and its receipts

1. 在捕获的项目会话中完成手势；像素生产器先得到新不可变 PNG 资产。
2. drawing 返回 before/after，storyboard 校验基线并纳入一次项目历史；纯文字直接走命令。
3. 会话持有当前与历史可达资产，向 UI 发布新的 Project revision。
4. 自动 checkpoint 捕获该 revision；成功只推进这个会话的 checkpoint revision。
5. Save 捕获目标版本，等待其必要资产，再由 formats/文件编排输出；输出收据绑定内容版本。
6. 若保存期间出现更新编辑，旧 Save 的成功不能宣称新版本已同步。Undo 也是一个新 revision。

以上是待实施顺序，不是已有事务保证。至少区分当前 revision、内部 checkpoint revision、
TIFF 输出对应版本/内容。别把三个状态压成一个 saved boolean；版本相等是否足够还要由输出身份校验决定。

## Gaps to close before production routing

| 缺口 | 第一轮实际提供 | 第二轮需要冻结/补齐 |
| --- | --- | --- |
| 像素资产生命周期 | drawing 只操作 assetId；persistence 通过 readAsset 获取 bytes | 像素制作、待保存资产所有者、缓存/撤销保留；旧引用不能因新 checkpoint 丢失 |
| 历史持久性 | 会话内历史 + checkpoint 版本文件；并未序列化 undo 栈 | 跨会话是否保留历史、步数/容量/分组策略；版本快照不自动等于用户 Undo |
| 复合编辑 | setDialogues 面向单个镜头，图像 edit 面向单图 | 对白跨镜头移动、合并、遮幅/场景批量更改应形成一次可撤销动作；不在 UI 拼多次独立 history.apply |
| 完整作品字段 | shot name/scriptText、dialogue、基本 layers | naming、matte/presentation、对白覆盖层语义、尺寸变化/clear 的等价表示；未覆盖字段禁止静默丢弃 |
| 保存输出关系 | 内部 manifest/assets/versions | TIFF 输出状态、来源映射、首次备份、命名计划、删除计划、外部改动冲突；不能把旧绝对路径带进新项目 |
| Pending | 纯成员/顺序操作可撤销 | 现行文件移动与历史重定位；提议未来只改逻辑成员、输出延后，但这属于需明确批准的行为变更，不在本轮执行 |
| 打开外来 TIFF | 核心没有格式导入 | 保留受支持的已有 TIFF 能力；直接编辑的准备过程、失败/取消、重复打开的身份；PSD 延后 |
| 快速加载 | loadCheckpoint 严格校验；readAsset 仍要校验资产 | metadata/资源验证成本、按需解码与有限缓存；不擅自删校验以追求速度 |
| 文字镜像和双视图 | 纯文字数据与 active 列表 | 日式分镜文字编辑/对白移动语义、Markdown 导入导出、覆盖层排版一致性 |
| 关闭与多项目 | 未提供 session 生命周期 | flush、未完成操作、原会话 ACK、失败提示；不复刻整套旧 owner，也不能省略它正在保护的行为 |

这些缺口不要求正在工作的 Hermes 临时扩张任务。返回时据 DELIVERY/QUESTIONS 对照检查，
统一补充契约后再下发第二轮。历史长度及 Pending 文件策略若需要产品决定，再集中向用户提问。

## Integration stages and worktree policy

| 阶段 | 工作 | 开始条件 / 退出证据 |
| --- | --- | --- |
| I0 独立审查 | 审查每个 lane 的实现、测试、文档、风险和范围 | 用户报告完成；实现 SHA 与日志一致，必要失败处理有证据 |
| I1 三核心组合 | 合成 PNG → drawing → storyboard/history → 真 checkpoint → reload；加入 stale/ABA/保存并发反例 | 三模块可导入，完成 ACCEPTANCE A07/A11 的无 GUI 子集；完整 tests/build |
| I2 会话与最小 UI | 单一状态所有者，文字/排序/一笔绘画/Undo/内部保存/关闭/重开 | 资产生命周期和未完成状态明确；真实 preload/Main 及隔离 GUI 通过 A08 |
| I3 TIFF 交换 | formats 接入受支持的 TIFF，明确 Save 的版本/来源/命名/备份/失败行为 | I2 稳定；源绑定契约冻结；A01/A09/A10/A11 |
| I4 功能补齐 | 日式分镜、对白移动、完整绘图、遮幅、Pending、删除、Markdown、检查播放 | 不丢字段与复合命令冻结；ACCEPTANCE 全部相关案例通过 |
| I5 性能与双平台 | 100/1000 场景、资源峰值、目录迁移、Mac/Windows/安装包 | 功能稳定、真实测量与独立平台证据；不以 tiny PNG 冒充电影级负载 |

当前不新增工作树，不抢占 Hermes 的重型测试时段，不改共享契约。I0 后主管仅整合通过的实现；
I1 是最早能证明模块协同的工作。I2 session 与 I3 formats 只有在其共同数据/保存协议冻结后，
才值得开新工作树并行，不让两队各自发明源文件或 revision 规则。

## Remove complexity only with replacement evidence

逐项登记“旧代码职责 → 新归属 → 调用方切换 → 反例测试 → 可移除文件”。
纯转发层在调用方迁移后删除；原始文件保护、失败留存、输出身份和历史资产保留不因代码长就删除。
不为兼容测试项目重写迁移系统；也不把测试数据无价值误解为允许丢弃作品保存语义。
先让一条新链闭合，再删已无人调用的旧链，避免长期双写和空壳 wrapper 增长。

## Next concrete deliverable

Hermes 返回前：本设计和 [ACCEPTANCE.md](ACCEPTANCE.md)。返回后：每 lane 的审查记录与
针对三核心真实实现的组合测试，再分派第二轮。当前没有新增运行时代码或执行验收。
