# 剩余工作与分块 — Storyboard Flow

本文件是唯一活动待办和收尾计划。[当前交接](context-handoff.md)说明已完成范围和暂停点；旧PLAN/逐轮清单见[归档](docs/archive/2026-10/handoff-before-simplification/README.md)，不是额外执行队列。

## 当前产品方向与工作顺序（用户本轮调整）

用户明确计划：先拆掉内置AI，让软件专注捕捉故事板灵感、更轻且好维护；随后用Codebase Design评估模块合并和减少不必要抽象。第二/第三块安全任务保留，改变顺序不等于取消或完成。

- [x] 第一块后的复盘由另一Session完成（用户确认）。测试补强、定向执行及build/typecheck去重的来源和限制见[Retro记录](research/core-closeout/save-normal-first-block/RETRO-B2-REGRESSIONS.md)；本Session不重跑该复盘，也不把定向结果扩大为新全套验收。
- [x] **移除内置AI（已实现、自验、独立验收）：** UI、Provider/设置/凭据工厂、专属IPC/client/候选生成与Apply/拖入及专属代码已移除；普通Pending、Import/绘画/History/Save保护保留，不建立旧AI代码归档或数据迁移，不读取/删除真实素材、配置或凭据。原始RED补证后Reviewer确认同一候选可接受，范围与持久证据见[本块记录](research/ai-removal/PLAN.md)。本块结束后暂停，不夹带通用重构。
- [x] **Codebase Design只读评估：** 用户授权Reviewer新会话，已加载Skill并追实际工作树；建议、原文和Engineer输入hash/重点核对见[评估](research/codebase-design/ASSESSMENT-20261009.md)。以调用方知识负担和修改局部性为目标，不以文件数/行数为目标；这是静态设计建议，不是重构完成。
- [x] **模块优化首块：Pending renderer单一路径（实现、自验、独审通过）：** 清理旧装配/执行路径，保正常adapter load兼容、owner/queue/磁盘/History保护；Opus初审空板与typecheck证据问题返修后，新Codex 6.1 Sol Reviewer累计接受。成果、原审查/失败修复/1774全套与新UI/持久证据见[Pending记录](research/codebase-design/PENDING-FIRST-BLOCK.md)。后续连续授权已生效，原逐块暂停点不再适用。
- [x] **模块优化连续队列本机闭合（实现、自验、独审通过）：** 用户“一口气把模块优化的工作做完吧”及后续“那继续吧”覆盖已讨论非冻结结构工作；Engineer亲自实现，新Codex 6.1 Sol逐块独审，最终Reviewer确认累计队列可闭合。最终1789全套/新真实普通UI通过，持久证据与范围见[连续记录](research/codebase-design/CONTINUOUS-OPTIMIZATION.md)。未提交推送发布，不关闭后置安全或平台任务；AGENTS可选导航更新因保护审批超时未改。
  - [x] 收敛打开/载入、保存/导入/剧本新建的App旧分支和由此孤立的装配。1780全套/真实UI通过，新Sol Reviewer接受，记录见[连续执行](research/codebase-design/CONTINUOUS-OPTIMIZATION.md)。
  - [x] App生产mode/旧后备退役，Pending/外部刷新单域、paint/Close必需能力；通用local/prepare/copy-only/测试Adapter差异及冻结安全契约保留，不声称删除所有optional或全局main标志。累计Reviewer确认未恢复生产旧旁路。
  - [x] 对照现有策略、集中重复认证原语。四调用方策略差异/真实文件检查保留，1794全套/新UI及Sol独审通过；[连续记录](research/codebase-design/CONTINUOUS-OPTIMIZATION.md)保存例外与证据。
  - [x] workspaceSession承担不同角色的scope/live recovery/destination/render identity/status来源，真实App与owner接线并独审通过；不重写owner/事务，不做command薄转交，Add provisional/像素恢复契约仍后置。
  - [x] 依据生产根退役十四旧写函数/私有helper及孤立model，保migration reader/bitmap/main保护及两个真实migration case；旧mode/无用类型/import和AI宣传清理，未合并IPC。
- **后续Reviewer调用选择（用户新确认）：** 当前Opus 5.5审计照常完成，不中途换模型；之后派给Reviewer的审计使用全新Session，渠道为Codex subscription（`openai-codex`）、模型为6.1 Sol（启动前核准确ID），不复用Opus上下文，不因此重审已通过的同版成果。仅临时指定后续调用，不改Reviewer全局默认配置。
- [ ] **之后回到核心安全收尾：** 下方第二块History与第三块PNG仍未完成；按实际写链确认PNG失败契约与History补偿的依赖，再决定实现先后。移除AI不能关闭这些风险。
- [x] **当前源码checkpoint：** `checkpoint/module-optimization-20261009`，commit `2d53ec8406b33a33bd176f4517dc033ce80b8ffb`已上传并GitHub读回；436验收源/必要配置及合成fixture匹配。用户确认允许公开保留；不是合并/发版本或干净机器认证。原主树和无关改动保留，原始私有证据未上传。
- **并行远端变化须先核：** main另已合入infra/public-repository为`5652997844c5f8347e68fa7cd9a89981b8c122c7`，本次未拉取或集成。后续同步前核当前发布配置与差异，不自动合并、rebase或覆盖；本机main仍旧HEAD+dirty。

AI移除及本轮非冻结模块优化已在本机验收闭合；下面的数据安全、平台/交付及可选受保护导航尾项仍未完成。实质需求/权限/安全契约变化另确认；较大workflow/Skill/验收约定变化仍须独立审计及批准，不自动提交推送发布。

## 数据安全工作块（需另确认执行范围）

### 下一会话起点：先恢复现场，再决定安全修复方案

用户本次只授权更新交接并准备换Session；PNG/History具体实施策略尚未批准。Engineer推荐先PNG失败保全→再核History补偿依赖→最后集中平台/交付，此顺序是建议，不是把旧第三块自动升为已开工。

- 首先读Workspace/project规则与`context-handoff.md`，核main+dirty与最近已接受身份，保留全部累积成果；不从HEAD重建、不重启已完成结构重构。
- 当前代码入口：`electron/main/layerAssetService.ts:writeLayerPng`直接写旧目标，`createLayerPng`只处理新目标；沿实际Merge/writer及`bitmapLayerHistory.ts:restoreLayerAssetSnapshots`/`projectHistoryController.ts`/queue追读写与失败边界。先给简短方案、验证范围和契约影响，再确认实施，不在交接阶段修代码。
- 历史线索在[原归档PLAN](docs/archive/2026-10/handoff-before-simplification/research/core-closeout/PLAN.md)的History复现、PNG权限决定及保全清单。本次有限文件/ZIP定位未找到原`l2h-history-red`，原probe/config可用性未知；不能声称11 RED已当前重测或材料确定不存在。需可信来源并保原断言；不得编造替代失败记录或把0 tests当PASS。
- 只用owned合成fixture；权限/ACL/owner/group/links/别名和竞争语义、版本化引用或替换方案涉及实质契约时另确认。不接触真实素材/凭据、不安装、不启用origin、不自动提交发布。
- 完成条件仍以下表为准；现有1789全GREEN只认证最近结构版本，不消除独立故障场景。有效同版证据按影响复用，不因换Session机械全量重跑。

| 工作块 | 尚未闭合／不能混淆 | 完成时需要证明 |
|---|---|---|
| 第二块：多资产History和失败补偿 | 历史11 RED保留，不代表当前重测计数；第一块成功Merge/Undo不等于一般事务。 | 第二资产失败、所有已启动effect settle、restore写后失效、A→B/ABA/reload及等待中新编辑时，像素/Project/History/selection/fileSync/status保全；原安全断言与实际调用链、独立验收。 |
| 第三块：旧PNG短写和权限保全 | 历史95-byte旧PNG→16 bytes损坏；串行候选未集成，create-only Add不修replacement。 | 失败时旧bytes/ACL/owner/group/flags/links与写授权语义；Merge等同类writer、别名/rename/外部竞争范围明确。只用合成fixture；权限/存储契约变化另批，不仅chmod求绿。 |
| 来源恢复／保守残留／partial Save | origin检查点非可直接拔插模块；provisional cleanup、通用回滚、跨进程writer/断电/fsync未保证。 | 不误删Project/History来源；partial JSON/MD/Trash及cleanup失败保可恢复事实与明确未完成；冷重开和crash保证单独定范围，不半启用origin替代设计。 |

编号保留此前工作块称呼，不强制第二块先于第三块。旧计划认为History失败补偿依赖PNG失败契约；复盘时以实际写链确认依赖，若必须改变权限/格式先取得批准，不因编号强行先实现。

## 剩余应用验收（已有通过按范围复用，不重新宣布零进展）

- [ ] **Add/Paste/绘画/History生命周期：** 双view、expanded/embedded、Dialogue开关及像素/文字保全；select/load/ensure/copy/prepare等await遇A→B/ABA/reload、metadata目的地变化、成功Save invalidate、同scope新编辑、锁/删源/改path；晚到completion/rejection不串Project/History/selection/task/status。已完成Add正常及native、Paste/绘画/成功Merge smoke不抹掉，也不扩为全部竞态通过。
- [ ] **U2/U3与命令策略：** image Import锁下键盘Delete/Clear/Merge Down/Add/Paste/Undo/Redo、准备/queue时锁变化、首写开始后配套metadata/history完成及解锁恢复；导航/Copy/zoom/typing Save保旧行为。script-only、busy/modal/naming/error Cmd-S、系统层unlock若需新增策略另作产品决定。已有双view空板恢复不是全部组合保证。
- [ ] **Pending：** dirty单/多层先物化再park，Finder/Bridge外部编辑后双viewbefore/after/empty恢复、文字/像素/路径无重复失联、Save/新进程冷重开；disposable项目journal强退恢复需隔离及授权。外部rename/move继续明确unsupported。不得借Save-only旧措辞取消停放物化。
- [ ] **交互/规模：** 60+ shots、50% zoom跨行marquee/edge-scroll→Delete/copy/reorder；wheel/Z锚点/Space pan、drawer/sidebars、手写笔；Blur 1–50px和Select rotation透明层无ghost、hidden/locked拒修改及Undo/Redo；Japanese Action/Dialogue/Cut排序、timeline/Onion Skin、hot/static全隐藏；matte1080↔1230/embedded不resize/Dialogue及Add/Import/Pending继承、Save/reopen尺寸。正常smoke覆盖到的部分保留，真实设备/完整矩阵仍待认证。
- [ ] **Import/保存/恢复：** half-finished TIFF、外部TIFF/Markdown变化、锁/帮助/警告/进度；rename冲突和rollback双错误、同stem异扩展/Archive无覆盖、TIFF失败保全、large synthetic folder加载/真实Save-and-Close。JSON/MD/Trash部分提交政策不得自动降失败为成功；有限single-PNG ACK丢失重试不是通用恢复。
- [ ] **平台和交付：** Windows/干净Apple Silicon、Python依赖/打包最小TIFF往返；真实Photoshop、系统Trash/clipboard及服务不由fixture替身认证。force-quit/断电/安装/真实素材/网络另核权限；旧包update notice/Download、双平台tester Release、CI并发/重跑/部分产物公开策略待验。
- [ ] **性能：** TIFF compression none体积/峰值成本未量化；8+可见full-resolution层历史33ms预算失败不是当前复测。chunk警告非阻断；缓存/affordance只在真实需求/风险收益下再决定，不预建新功能。

最终完整bitmap smoke已在第一块通过；旧“Rectangle阻塞整套”“0次Add”“native未跑”是历史，不重新挂为当前阻塞。覆盖新增生产行为时仍须适用完整suite、types/build/preload、实际受影响流程及独立验收；有必需FAIL/BLOCKED/NOT_VERIFIED不整体结案。平台完成前不宣布全产品交付；本轮无commit/push/release。

## 暂停／条件性未来事项（保留，但不混入当前实施队列）

- **AI已退役：** 原single/batch/Resources dogfood、AI观察器及凭据改造待办不再适用，不恢复Provider调用。此前验收证据原样保留，不另保全旧AI实现；普通Pending仍是核心功能。
- **受保护导航维护（非代码块阻断）：** release README生成器已去AI宣传、改普通Pending，孤立Comfy类型已删除。AGENTS旧AI导航未改：保护审批超时，禁止重试/绕过；后续由用户完成受保护审批再同步，不改保存/权限规则。
- **origin：** 13场景限定Electron补验和208/1495隔离记录不等主树启用；31入口13 prepared/17 incomplete/1 unsupported、production false。代码和计划在[冻结检查点](docs/architecture/research/isolated-origin-checkpoint-20261005/README.md)，不删除、不自动扩建。
- **结构维护：** 两片结构简化成果保留；原第三片共同发布入口评估完成、不抽取。用户本轮提出AI移除后重新评估，旧结论是参考而非新评估的预定答案；评估不自动授权广泛合并或为行数重构。
- **其他延期：** 拆分成独立AI产品/仓库、PSD-first研究（ag-psd/raster/复杂层政策/Windows兼容）、新增Photoshop全保真往返、PDF/image sequence、SQLite、cloud/collaboration仍不在当前实施范围；细项原样留在归档，不称完成。

## 证据与执行边界

[短验收索引](research/core-closeout/save-normal-first-block/ENGINEER-SELF-VERIFICATION.md)指向原批准SPEC、候选manifest、最终自动/UI/native证据。历史History原probe/config与PNG权限候选的精确线索在归档原PLAN的“原独立RED复现/保全清单”，旧scratch不能直接执行或以0 tests当PASS。新任务先核版本、实际资源和安全fixture范围，不安装、访问真实凭据/数据或启用网络来补假证据；同版本有效证据可按影响复用。
