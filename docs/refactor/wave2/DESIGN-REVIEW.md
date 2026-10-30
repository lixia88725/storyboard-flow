## 修订复审与主管裁定 — 2026-10-30

三份修订设计已作为设计输入整合到 main，保留原文；不包含各 worktree 的 TASK.md。
来源：Session `7fb5d24533348c2ce30d98f69728f5fb1c233419`，Drawing
`3c5d4a9e36aa3b2369a2e2ffa8ee12d062c25290`，Formats
`2c5eac23188bfcc914c3d9ebd02e9fc0ca7976ec`。各 workspace 干净、仅改两份约定文档，
相对初版的 diff --check 均通过。未运行 tests/build/GUI（文档阶段）。

R1 已解决：内部 checkpoint 领先于已完成输出合法，输出记录核对其捕获的历史快照，
而非要求等于当前 head；首次无输出不得自动变成恢复故障。
R2 的无关文字失效问题已解决：按目标完整图像/会话/真正依赖核验，安装到最新 Project。
三个提案的局部规则仍有差别，以下主管裁定优先于其冲突措辞；实现不得自行择一。

1. **Undo/Redo 排在此前已接纳 producer 之后。** 与当前
   `projectHistoryController.applyHistoryEntry` 在 `runExclusive` 内读取历史的次序保持一致。
   发出导航请求不立即取消早先笔迹；等早先 producer 安装或明确失败结算后，在队首判断
   canUndo/canRedo。导航请求形成屏障，后续修改不越过；普通文字只可在屏障前按已定义依赖
   规则穿插。有可执行历史时，导航真正开始且任何 await 之前提升控制 generation，失败也
   不回退；无历史的 no-op 不提升。随后迟到的旧 prepared 即使图像完全相同也不可复活。
   Session 提案“Undo 接纳即撤销此前准备/排队资格”及对应反例不采用。显式取消与 Undo
   是不同动作，不把取消全部笔迹当作撤销。前序 producer 失败须报告；效果未结算时阻止
   后续导航，不越过故障去改更早历史。全局像素串行先用于最小流程，后续并发需另验证。
2. **完整性故障按受影响范围限制。** 确认当前 checkpoint 健全且独立证明无未结算文件
   效果时，输出账本损坏或外部输出冲突限制输出/来源写入；不因此自动封锁健康内部编辑、
   checkpoint 和正常 Close。无法排除未结算效果时才进入相应 recovery-required。
   采用 Formats 的分级判定，替代 Session 表中“坏账本一律只读”的笼统措辞。不得从缺文件
   猜测“从未输出”；初始化记录、历史输出、真实文件分别核验。此为新链目标，不删除旧保护。
3. **这些仍是设计输入，不是完整共享代码合同。** 下一步主管只冻结 G1/G2 最小流程所需
   的类型和测试顺序；账本/TIFF 的 G3 契约随后冻结，避免为一笔绘画同时实现整个未来系统。
   跨重启 Undo 与 Pending 的用户可见行为不在本裁定中改变；尚未批准清空历史或纯逻辑 Pending。

状态：修订调查和上述统一方向可用于下一阶段合同设计；没有宣称新核心接入/运行时验收完成。
下方保留首轮审查记录，以追溯 R1/R2 的来源。

# 第二轮设计交付审查 — 2026-10-30

状态：三个初版设计任务已完成；范围检查通过。跨模块契约尚未冻结，R1/R2 修订已直接下发。
不是实现验收，没有新的运行时代码、GUI 结果或性能结论。

| Lane | 已审查初版提交 | 范围/工作区 |
| --- | --- | --- |
| Session | e5b08c498c57d8261f84f5f8511b8e0403f0aa88 | SESSION.md + TASK.md，干净 |
| Drawing Assets | 46c2a2d462ba6a9922caf64c7b34bd8adb0821f2 | DRAWING-ASSETS.md + TASK.md，干净 |
| Formats Save | de98c4808e4a1cc0374e65b2a4cdae1eeda1f156 | FORMATS-SAVE.md + TASK.md，干净 |

三个会话均报告 completed/idle；主管核对各 worktree HEAD、相对10152aa的范围和 diff --check。
均未越界改代码、共享契约或原目录。初版在各自托管 worktree 中，未把 TASK.md 合入 main。
设计阶段未运行 tests/build，符合任务要求。

## 已一致的方向

- Session 是唯一可写作品与项目历史所有者，网格/日式分镜共享快照。
- Drawing 制作像素；Main 资产 Module 验证并存储不可变 PNG；资产落盘不等于作品提交。
- 内部 checkpoint 与 TIFF 输出分开；Formats 编解码与 Outputs 文件效果分工。
- 新格式不双写旧 Project，不静默迁移测试工程；逐条接线后再删除无人调用的旧逻辑。
- Pending 默认保留既有可见文件与外部编辑语义；未知效果不误报成功。
- 最小流程与全功能/规模/跨平台验收分开。

## 需要修订的契约歧义

**R1 / Session + Formats：正常输出落后不能成为恢复故障。** Session 初版第3节尾部
将重启时 revision/digest 不配对笼统归为拒绝写入，未明确区分合法 checkpoint r+1、
lastCompletedOutput r。这会与“只暂存、未显式 Save 仍能健康关闭重开”冲突。
要求新增判定表：首次无输出、内部领先、输出配对、未结算 journal、损坏/来源冲突。
输出记录核对其捕获的历史 snapshot 与实际文件；不要求所有输出记录等于当前 head。

**R2 / Session + Drawing：无关文字编辑不能使一笔绘画失效。** Session 提议任意
project revision 变化即拒绝已准备像素；Drawing 则允许文字并行，在最新 Project 上
核对完整目标 image 后安装。需要统一 session incarnation、真正依赖、目标完整 image、
Undo/Redo 分支/取消 generation 与队列顺序；不以 image revision 单独防 ABA，也不把
无关 scriptText 改变误认为目标像素冲突。追加慢像素夹文字、同图两笔、Undo ABA、层锁/删除/resize案例。

2026-10-30 已通过 send_message_to_thread 给三个现有会话发出对应修订任务；仍只允许各自
设计文档/TASK.md、本地提交，完成停止。修订返回后主管复核，再冻结精确共享类型。

## 尚待主管收敛

- Session incarnation/epoch 与不同 lane 的失败 effect 词汇需要一个权威定义。
- 不将全部未来字段、输出账本、跨会话历史、预算系统同时塞进第一笔接线；按G1/G2/G3分期。
- 输出账本仅存真实来源/输出事实，不能复制第二份可编辑作品或复制整个旧恢复系统。
- 跨重启 Undo 先核实已有行为/产品承诺；不能直接采纳“重开清空历史”的建议作为已批准缩水。
- 全隐藏 TIFF 合成和有损导入策略在接入对应能力前给用户具体方案；本轮未改这些行为。

本记录只接受初版调查作为设计输入；尚不宣布三个方案全部通过或实现任务已开始。
