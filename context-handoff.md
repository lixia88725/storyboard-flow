# 当前交接 — Storyboard Flow

本页只维护当前现场。接手先实际读取 `../AGENTS.md`（Workspace最新规则）与 `AGENTS.md`（项目规则），再读本页；按任务读TODO/SYSTEM/相关决定，不默认通读旧报告。`CLAUDE.md`仍指向`AGENTS.md`，不能当独立交接文件写入。

## 当前停在哪里

**正常Save第一块、内置AI移除、非冻结模块优化已在本机独立验收；现在暂停在换Session交接，PNG/多资产History安全工作尚未开始。** 模块优化最终Reviewer `20261009_214947_2c0004`（实核openai-codex/gpt-6.1-sol）确认累计队列可闭合、无必修。最终1789测试/0失败/0pending、212 testResults，完整build含两端typecheck、真实普通Electron 229wait通过。不是全产品/所有竞态/平台验收完成。

用户最新原话：“我们先更新一下所有的交接文档吧，接下来我想换一个session开始这些工作。”本轮授权只更新交接资料，没有开始修代码、安装、迁移、提交或发布。此前“一口气做完”的授权已落实非冻结结构队列，不自动扩大为新PNG权限或History补偿方案。

## 下一会话的起点（建议，不是已批准实现方案）

Engineer建议：先核清旧PNG replacement失败保全及权限/别名/并发限制，再确认多资产History恢复对它的依赖，之后集中实际使用和平台交付。用户尚未选定具体写入策略或批准权限/存储契约改变。

- 唯一任务与验收计划在[TODO](todo.md)的“下一会话起点”和“数据安全工作块”；先核当前真实写链、历史材料是否仍可用，形成简短方案/一个完整可验收块，再请当前用户确认实施范围。
- 起点：`electron/main/layerAssetService.ts`的`writeLayerPng`（当前仍直接writeFile旧目标）与独立`createLayerPng`（Add-only新文件）；`src/renderer/bitmapLayerHistory.ts`的`restoreLayerAssetSnapshots`及`projectHistoryController.ts`/`bitmapLayerWriteQueue.ts`。只定位，不把当前普通GREEN当失败保全已解决。
- 旧PNG“95-byte→16 bytes”和History“11 RED”是历史发现，不是当前重新执行的计数。原计划定位：[归档PLAN](docs/archive/2026-10/handoff-before-simplification/research/core-closeout/PLAN.md)的History复现/保全清单和PNG权限决定段；旧命令可能过时，不能直接执行或以0 tests当PASS。
- 本轮有限定位未找到原`l2h-history-red`文件，第一块与连续优化两个持久ZIP也无对应成员；**原probe/config当前可用性未知**。下一会话应先定位/恢复可信来源，不凭摘要制造RED，不假称已重测或证明材料不存在。

## 要保全的版本与成果

- 本机项目：`/Users/pikachu/Developer/storyboard-flow`；`main`，HEAD `34192f4e5155059a1ac7962e69d50201d8207083` **加大量dirty/untracked成果**。HEAD不能恢复当前代码；未stage/commit/push/release，不reset/stash或按旧分支覆盖。另有`infra/public-repository` scratch worktree，本次只确认存在、不检查或处置其成果。
- 已验收源身份：436项，manifest SHA256 `002337987cbbed4559b6dd3733e86828f307744a0a50d29b625bb2a7e8369034`；本次文档交接核对仍匹配。后续代码/相关输入变化须更新受影响证据；不因换Session机械重跑同版全门禁。
- 产品聚焦故事板捕捉/绘画/整理/编排。内置AI的UI/Provider/凭据工厂/IPC已退役，普通Pending保留；Pending停放前TIFF物化、JSON/MD/ACK/非空继承/空板保自身设置不可因旧Save-only措辞取消。
- App生产单路径、共享认证原语、有名`workspaceSession`及无消费者旧写模型清理已接受。主进程编排、owner/queue/renderer-main/磁盘隔离仍保留；不把所有optional、局部prepare/copy-only/测试Adapter强统一。
- 成功Merge/Undo不等一般多资产失败补偿；create-only Add不修旧PNG覆盖；有限single-PNG ACK恢复不等partial/crash事务；origin继续production false，不自动启用。用户未实际用此Mac上的软件工作，不能把保护原则说成已发现真实作品。

## 资料入口：不用读一整串旧交接

| 目的 | 入口与需要知道的内容 |
|---|---|
| 本次换会话不可变快照 | [CE-HANDOFF](research/codebase-design/CE-HANDOFF.md)，记录此暂停点、来源/授权和本机依赖；旧CE-HANDOFF/CE-HANDOFF-2仅为第一块历史快照 |
| 下一工作与完成条件 | [todo.md](todo.md)，唯一活动计划；PNG/History/平台及未批准事项不重复建台账 |
| 模块职责和真实读写链 | [SYSTEM.md](docs/architecture/SYSTEM.md)，直接维护文字，不运行退役Atlas生成器 |
| 决策理由 | [decisions.md](decisions.md)相关段；旧架构细节不是当前代码清单，实际职责以SYSTEM为准 |
| 最近结构验收与源/构建身份 | [连续记录](research/codebase-design/CONTINUOUS-OPTIMIZATION.md)，各块固定输入、RED/返修/原执行/Reviewer、最终累计结论和持久ZIP |
| 正常Save历史验收 | [短索引](research/core-closeout/save-normal-first-block/ENGINEER-SELF-VERIFICATION.md)，1970只属于当时版本；不因新会话重启旧复盘 |
| 未完成安全历史线索 | [归档PLAN](docs/archive/2026-10/handoff-before-simplification/research/core-closeout/PLAN.md)，仅按具体问题查，不执行旧工具或当新授权 |
| 冻结origin | [检查点](docs/architecture/research/isolated-origin-checkpoint-20261005/README.md)，不是生产保护或启用许可 |

## 本机证据、执行环境与缺口

持久证据（仅此Mac可达，不是GitHub备份）：
`/Users/pikachu/.hermes/profiles/engineer/evidence/storyboard-flow-module-optimization-20261009/continuous-accepted-evidence.zip`
SHA256 `f98f93756a020bcd652ef25dba1c7f7c74699b0110bc6d66326f1dbc20a8db87`。`continuous-archive-manifest.json`列身份；ZIP内`cleanup-manifest.json`/`cleanup-candidate/`/`cleanup-review.txt`是最终版本，其他候选和原执行按需读。scratch会清理，持久ZIP优先；不能指望别的电脑凭本机路径获取。

上次成功验证用了现有Python3.12、项目`vendor/python/photoshop-tiff`与owned TMPDIR；PATH优先`/opt/homebrew/opt/python@3.12/libexec/bin`，PYTHONPATH指项目vendor。下一次实际执行前核当前解释器/ABI/项目命令并选择新的owned scratch，不能直接复用旧probe或假定export延续，不授权安装。完整build已包含两端typecheck，不机械重复。

AGENTS旧AI导航因保护审批超时未改；本次不重试或经CLAUDE绕过。普通文档不改变权限/产品契约。main push有公开发布副作用，未经另批不提交推送。此前Reviewer进程曾被agent_close终止，后续前台拿到真实结论；当前没有待审实现任务，后台启动/exit0不等持续施工或验收。
