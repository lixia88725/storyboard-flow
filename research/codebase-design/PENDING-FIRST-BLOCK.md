# Pending模块优化首块 — 实现与Engineer自验

## 批准与范围

来源为发起方提供的用户聊天摘录：用户选择“以opus的意见为主，然后astra仅作为参考”，要求简述推进；Engineer说明按完整可验收块推进，先Pending单一路径，其他入口/判定/session模块/安全块后续；用户确认“好的，那我们开始优化模块吧。”

本块：Pending renderer停放/取回仅调用现有normal adapter域操作；退役App中的旧文件controller/队列包装/永不运行的旧迁移effect、drag-end中的文件回移/直接发布/清dirty/重置History后备分支。正常load兼容仍由normalSaveAppAdapter.load处理，不改main/owner/磁盘/格式/权限、其他入口开关或工作区准入。生产代码只改App.tsx与storyboardDragEndController.ts；不提交、推送、发布。

实现时将旧controller测试迁至正常域端口，发现既有正常取回从包含新取回shot的Project计算场景黑边/对白设置，干扰目的场景继承；保留旧行为断言后出现两项真实失败。窄修：ACK后从最新同scope目的场景（排除本次取回shot）读取继承值，保晚到编辑；App尊重显式true/false而不覆盖。实际像素/恢复执行未改。新增App回调执行测试先RED再GREEN，覆盖显式设置传递。此为保批准的既有继承行为所需修复，不扩大为通用场景规则抽取。

## 版本与证据

### Opus审查返修（当前候选）

独审`20261009_140618_a507fe`实际Nous Opus 5.5返回“需修改”，原文`review-opus.txt`：非空场景改动可接受，但空板没有继承对象，不能当matte-off场景去黑边；此外原typecheck组合命令末尾的Hermes查询使终值不足以单独证明typecheck。

已返修：controller仅在目的场景还有shot时继承；空板保本张原matte/对白层，不进入像素写入/删除。新增embedded/expanded×对白开关四条保护，以及接入真实shotPresentationController的asset端口不调用检查，五条全部真实RED（21pass/5fail）后GREEN。`empty-board-red.json`与`empty-board-red-input.test.ts`为原证据。最后一条是实际controller组合、磁盘端口替身，不冒称真GUI或原生像素执行。

原message29574的确切命令是`npm run test -- --reporter=json --outputFile=…/full-tests-handoff.json && npm run typecheck && git diff --check; hermes profile list; hermes chat --help`，29575是其返回。Hermes输出为发起独审前核Profile/CLI，不是tsc输出。原终exit0只保证最后help，不单独计typecheck；此次另单独运行`npm run typecheck`真实exit0，随后完整`test && build && git diff --check`也exit0。构建包含两端类型检查。

返修后首轮full-tests-revision.json为环境失败（1623pass/151fail）：普通终端调用未保留前轮PATH/PYTHONPATH/TMPDIR，落到不匹配vendor的Python3.9和symlink临时路径；不作行为RED或PASS，不弱化代码。重新设置既有Python3.12/vendor与owned scratch后，`full-tests-revision-final.json`为**1774pass/0fail/0pending，208 testResults**；build及diff-check0。不安装依赖，不改生产Python选择。

production发生变化，旧GUI不用于认证新候选；已在`ui-revision/`对新source/build重新完整普通Electron smoke：guard先验证productionImported=false、child exit0、229wait、无timeout/进程/监听器残留、运行中源码/构建未变。空板matte分支仍主要由新增controller矩阵/真实presentation组合证明；这轮普通GUI没有带matte的空板恢复，不能扩为完整GUI组合认证。旧完整UI材料仅历史留存。

新固定`candidate-revision/`、`candidate-revision-manifest.json`、`task-revision.diff`和`revision-original-executions.json`是返修复审输入；旧candidate/和首次独审证据不覆盖。用户要求后续审计新会话走Codex subscription 6.1 Sol；因此此次复审开新Reviewer，不续Opus上下文，累计检查仍覆盖整块批准要求。复审已返回**可接受，无必修**，详情见下面结案记录。

### 独立验收与本地结案

Reviewer新Session `20261009_142553_9403ea`返回“可接受”，原文`review-sol.txt`。Engineer只读核Hermes会话元数据：model `gpt-6.1-sol`、provider `openai-codex`；不查询订阅账单，不改Profile默认。Reviewer独立核431项candidate/live、前后diff、五RED输入/失败原因/最终GREEN、原typecheck/build结果及新229wait/84build身份，累计七验收项成立。空板matte专门GUI组合仍未认证，但此次不进入presentation的控制流及真实controller组合足够此窄片，不冒称GUI已认证。

接受源码manifest SHA256：`be814bfe7dad10b3c4706cf4a5e31935def31bb40f377ac45ffd38f9d466bfe7`。回收时Engineer再核431source hash无漂移；结案只更新本记录/context/TODO/SYSTEM文字，不改变已审生产/测试源。

持久本机证据：`/Users/pikachu/.hermes/profiles/engineer/evidence/storyboard-flow-pending-module-20261009/accepted-evidence.zip`，SHA256 `4286fe61ae6735c0bb23fef2c8be1aa307464c95e154f7826bb25ebd691463d6`。ZIP CRC与关键manifest/最终test/review成员核验通过，保两候选、起点字节、原执行、窄diff及合成快照；排除临时test数据、运行userData/home/缓存等。archive-manifest.json提供入口，source不只依赖会过期scratch。

本块已实现、自测、独立验收通过，仅本地工作树和构建；未stage/commit/push/install/release。按约定暂停，下一块待用户确认。

仓库main HEAD `34192f4e5155059a1ac7962e69d50201d8207083`加已有dirty，不能只用HEAD恢复。当前源码/测试431项固定副本、起点430hash、五个已有输入字节、窄diff、执行原记录与运行材料：
`/Users/pikachu/.hermes/profiles/engineer/cache/scratch/pending-module-97j3tj7j/`

- before-hashes.json / before/：改动前实际工作树，不是Git旧版。
- candidate-manifest.json / candidate/：本块固定431源码与测试；task.diff：仅本块六个文件变更。
- original-executions.json：本会话原工具结果，不重新制造RED。
- red-baseline.json：既有53通过，新增Interface检查因clearShotsDirty旧端口真实失败。
- targeted-green.json实际62通过/2失败，不按文件名当PASS；原组合命令用分号导致终值为typecheck0，此检查未通过，后来按报告识别并修复。
- full-tests.json：1766通过/2失败（正常路径matte-off及对白继承），不是可交付版本。
- inheritance-red.json：App显式继承值测试及两个既有继承行为失败。
- full-tests-final.json：修正后全套通过、build通过；之后只改两个测试文件，去掉断开接线的旧spy断言，替换为实际Project/owner capture/UI发布保护，真实History/Undo/rebase测试保留。
- full-tests-handoff.json：首次候选1769通过/0失败/0pending，208 testResults；当时组合命令的终值不能单独证明typecheck，返修补证后才关闭（见上节）。
- ui/run-input.json、smoke-exit.json、guard-audit.json、日志及fixture-snapshots：固定production/build的真实Electron完整普通smoke；child exit0，无timeout，229业务wait，source/build运行期间不变。后续只两测试改动，不影响已构建应用，因此复用这次GUI/build不重复运行。
- cleanup.json：残留owned合成dense-marquee fixture先与snapshot逐文件hash一致后清理；无owned进程/监听器残留。

## 验收项→检查

| 批准的保留/优化项 | 证据 |
|---|---|
| Pending只有一个域操作，无可选旧文件/History发布路径 | pendingModuleInterface真实App options结构检查RED→GREEN；controller端口必需；task.diff |
| 多选停放、单张before/after/空板取回、Pending排序与有效命中 | 既有drag/projectOps测试转到域端口，所有顺序/geometry/文字断言保留；普通Electron多选park/逐张restore真实mouse流程 |
| 停放前物化、ACK、必要JSON/MD、false/reject不假成功 | normalSavePending*真实adapter/owner/main-runtime/TIFF测试；新增controller false/reject双方向检查及实际App传递测试 |
| 晚到workspace/epoch与P2/P3、namespace/History连续性 | 原Revision1/2/3及实际History Undo/rebase、PNG尺寸像素用例全部保留；Controller必需scope/version端口 |
| 旧parked load迁移仍可达、unknown/future拒绝 | normalSavePending load成功/拒绝测试，adapter及main无改动 |
| 场景继承保matte-off/对白开关，晚到同scope设置 | 两原行为断言正常路径真实RED后GREEN，显式App回调RED→GREEN；Revision late-scene/epoch保护保留 |
| 相邻Import/Save/绘画/图层/Undo/Redo/Add不回归 | canonical全套test、完整build及普通bitmap smoke229业务wait |

## 限制与状态

自验与独立Reviewer验收通过，**本地首块结案，暂停待下一块确认**。这是模块首块，不是所有模块优化/全产品交付。

GUI为实际main/preload/React/filesystem和合成素材；先实际阻断网络、Provider、safeStorage、真实配置访问，owned userData；系统Trash/clipboard由外部边界fixture替代，不认证系统能力。普通Pending多选park/逐张restore已真实操作；两种view所有before/after/empty/matte组合不是完整GUI矩阵，继承修复的分支与显式传递主要由controller/实际App回调执行测试覆盖，像素准备实现未变；不声称覆盖全部dnd/设备/nativeClose。完整Windows/跨机器、真实Photoshop和一般恢复仍未认证。build有既有bundle大小提示，不因此新建性能重构。

旧spy“reset未调用”的孤立观察已去掉，保护意图分别由“App/controller不再暴露History reset/clear/file发布端口”的Interface检查、真实History连续性测试、Project/owner capture和UI拒绝发布检查承担；不把未注入spy当独立安全证据。Reviewer应检查是否存在实际缺口。

回退仅本块task.diff及before字节，先核后续并行改动，绝不reset到HEAD覆盖其他成果；没有自动commit/revert授权。后续块暂停待确认。
