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
