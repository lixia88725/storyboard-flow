# 模块优化连续执行记录

## 批准范围与执行约定

发起方提供的用户聊天确认摘录：以Opus意见为主、Astra参考；Pending首块验收后，用户“好的，接下来一口气把模块优化的工作做完吧。”Engineer说明连续完成已讨论的非冻结模块优化、新Codex subscription 6.1 Sol Reviewer逐块独审、最后统一汇报，不逐块请求确认。安装/提交/推送/发布、权限契约、一般像素/History补偿、origin、main显式操作新契约未获批准。

计划只在todo.md；本页只记执行/自验/审查，不再建第二份计划。Pending首块与各固定候选/原记录保持原样。非冻结连续结构队列已本机验收结案，最后累计结论和持久证据见文末；当前换Session现场见[主交接](../../context-handoff.md)，本次不可变快照见[CE-HANDOFF](CE-HANDOFF.md)。本页各节的待审/未完表述描述对应实施阶段，不是重启旧任务的入口；新的PNG/History方案仍未实施。

## 第二实施块：App正常入口收敛

### 变更与依据

实际normalSaveAppEnabled恒true；App中的六入口persistWorkspace/loadFolderScan/handleOpenFolderByPath/handleCreateProjectFromStoryboardScript/handleSaveProject/handleImportSwbFormat不再提供旧模式后备路径。删除因此零调用的App persistWorkspaceWithoutAssetLock/checkStoryboardScriptImportState及旧进口装配。保正常adapter/owner/main/磁盘行为和Scope、queue settlement、错误/ACK、必要JSON/MD、same-workspace晚到拒绝和create-only规则。

Import的两个正常分支保image优先、script-only的区别，`needsSwbImport = needsImageImport || scriptImportNeeded`仍为App实际定义；不是把main的normalSave标志删掉。其他controller可选端口和App生产模式常量还在，属于后续切片，不能声称已经全局退役。

生产只改App.tsx；新增moduleOptimization.test.ts六入口Interface检查。AppViewMode两条原源码锚点改到正常adapter/prepare composition，保其原意，真实执行链另由normalSave*保护。混合normalSaveScriptImportChain仅改两项旧模式相关断言：false开关不再能选直连旧Import；原plain recovery失败保无成功FolderScan发布/error，迁至真实正常adapter/owner，允许owner记录可能已落盘事实和阻断状态，不把recovery失败当no-effect、不删其余保护。

### 自验与固定证据

根目录：`/Users/pikachu/.hermes/profiles/engineer/cache/scratch/module-optimization-8kdg9m0u/`。
- baseline-identities.json：本块前实际431源码，before/为三个修改的已有输入，Pending接受成果不覆盖。
- entrypoints-red.json：41pass/6fail，六新Interface检查因残留normalSaveAppEnabled分支真RED；原实际normalSave链基线通过。
- entrypoints-green.json：上述六case及原normal chain GREEN，两端typecheck0。
- 后续全套迁移失败保留：3fail是旧模式/静态锚点；后两次1fail是新测试错误地要求recovery-incomplete不发布任何blocked view，真实owner已有安全行为要求标未知/保事实。修测试映射，不改owner或放宽失败处理；不将这些当功能目标RED。
- entrypoints-full-tests-ready.json：1780pass/0fail但构建后的diffcheck2（生成空行空格）；只清八处空行，不混为全门禁PASS。
- entrypoints-full-tests-accepted-input.json：最终**1780pass/0fail/0pending，209 testResults**；canonical test && build && diffcheck整体exit0，build含两端types/Vite/Electron。原bundle大小提示保留。
- entrypoints-ui/：真实production main/preload/React/filesystem，独立userData与合成素材，网络/secret/真实配置读先阻断。新built candidate完整普通bitmap smoke child0、229wait、无timeout，运行前后source/build不变，无owned进程/监听器残留。Trash/clipboard外部端口fixture，不认证系统能力或Windows/跨机器/nativeClose完整矩阵；未认证GUI组合不借本块补成PASS。
- entrypoints-candidate/与entrypoints-manifest.json：固定432src/electron/scripts，entrypoints-task.diff仅本块diff；原执行entrypoints-original-executions.json，可核真实调用/exit。

验收要覆盖：六真实入口正常路径调用不变；Open reader在old I/O后、partial load不假opened；Save progress/receipt/P2-P3/失败Close保护；Script Create draft scope与create-only；Import image/script/prepare/required持久化与失败恢复；autosave stale payload/error隔离；Pending前块成果未改。原全套及真实UI可按对应版本复用，非仅静态结构通过。

状态：已实现、自验并独立验收通过。Reviewer新会话`20261009_174330_0d3f8e`（实际openai-codex/gpt-6.1-sol）判可接受，无必修；原文entrypoints-review.txt。独立核432输入/窄diff/原始执行/1780assert与229真实UI顺序及固定构建，前块Pending没有变化。

接受source manifest SHA256 `6b430e9402f537824b1afa3e3a2c78ec4899dac4a54bee5ac7a3f063f26faf17`。持久本机证据`/Users/pikachu/.hermes/profiles/engineer/evidence/storyboard-flow-module-optimization-20261009/app-entrypoints-accepted.zip`，ZIP SHA256 `df0cffc516cc449c60924b8fe9540610fed20db5e5f2cca13fe7f609ec14e3ed`；CRC和关键manifest成员核验通过。只更新结案文字，已审源码/测试不变。继续用户已授权的后续队列，其他项尚未完成；不逐块再确认。回退用本块before字节与窄diff，先核并行变更，不reset HEAD。未stage/commit/push/release。

## 第三实施块：两编译目标共用输出记录纯规则

新增`electron/shared/pendingBakeRules.ts`，集中hash格式、synced/pending字段规则及renderer原始信封分类；renderer pendingBake、manual Import、main正常准入复用相同认证原语，Create复用field-only state判断。四调用方仍各自决定missing/unknown/empty的准入政策；实际TIFF路径/whole hash读取、directory alias/PNG/create-only/transaction保护不抽走、不改写权限。

先用同一组13输入在实际renderer分类/manual Import函数以及main/Create的实际if条件上对照（纯策略表达式执行，不是磁盘运行）。包括missing、null、future、字符串版本、空合法、unknown、合法synced/pending、synced携token、空token、uppercase hash，以及Create的旧array字段和hash coercion差异。原20case通过，唯独新共享module缺失case真RED；新增module和接入后全部GREEN。保护策略依据是改前实际guard和原normal chain，非按新实现反推。

重要发现与保全：Create既有regex会将identity值转string，且其条目字段判定不要求record容器，其他三调用方要求严格record/string；本块不偷偷放宽或收紧它。故Create保本地旧shape/hash判定，只共用state原语；此特殊输入不等磁盘来源可直接获准（后续真实身份/path/descriptor检查仍在），不声称已修新安全问题。未来若要收紧应另审契约，不能借重构改变权限。

五个main源码摘取测试fixture增加实际shared predicate绑定，未换成mock，也不删除其断言。App/Pending已验收源本块不变；main编排依然在原位置，只有认证表达式依赖改变。

证据根同本页第二块：rules-before-identities.json为此前432源；rules-before/保四生产原件及五测试fixture原件。rules-red-table.json（20pass/1fail）、rules-targeted.json及原执行，rules-full-tests.json最终**1794pass/0fail/0pending、210 testResults**，canonical test && build && diffcheck0，完整build包括两端types及实际新shared emitted JS。rules-ui/对本候选重新执行完整普通生产Electron smoke：child0、229wait、无timeout/source-build漂移/owned进程/listener残留，guard在productionImported=false时自测通过。系统Trash/clipboard为fixture，平台/native/所有组合限制不变。

固定rules-candidate/、rules-manifest.json、rules-task.diff和rules-original-executions.json为本块独审输入；旧entrypoints-candidate/不覆盖。Reviewer新Session `20261009_180247_a81aa0`（实际openai-codex/gpt-6.1-sol）判可接受，无必修；原文rules-review.txt。独立核434输入/窄diff/13原政策表、252定向及1794全套assert、五fixture真实依赖和新生产UI。source manifest SHA256 `f2fa1bf4950eb9b08e843c29a9ae8083407aa43404a9e2c2bccee0448f3420b3`。

持久本机证据`/Users/pikachu/.hermes/profiles/engineer/evidence/storyboard-flow-module-optimization-20261009/shared-rules-accepted.zip`，ZIP SHA256 `bf9032b4c802f91c626f2e7f97d24f9bfc6e9059aaed6670f649e08973f59746`，CRC和关键manifest核验通过，保accepted字节/前件/原执行/合成快照，排除运行userData/临时写入。其他controller/session/死代码队列继续，不宣称整个模块优化结案。

## 第四块A：外部刷新、绘画和Close生产能力收窄

外部刷新controller仅接必需normalSaveRefresh域操作及read/check参数，删除旧直接Import、load/直接Project发布/持久化后备路径，App不再装配这些旧端口。watch/focus/debounce及saving跳过、checkId/path、reader在owner队列内、script-completion语义保留。绘画要求captureWorkspace和captureEffectCompletion，移除无保护默认/可选分支；Close生产hook要求normal guard/settle/queue ref。通用close payload的metadata-only调用契约仍有实际用途，未删除。

App相应三处能力无条件提供，不删除其他仍需逐项处理的mode装配。不会把presentation/Add局部prepare、clipboard copy-only等不同真实Adapter的可选参数一概当死代码；剩余能力分流需按调用方确认。

moduleOptimization新增四Interface检查先真RED（原23pass/4fail），后通过；原canvas/队列unit fixture显式提供能力替身，仅这些窄测试不认证owner，正常Producer/Effect/ImageImport链改为注入实际owner能力，其他main/persist/IO不动。painting-source/History/late-scope/失败保存保护仍验证。

测试映射说明：旧外部刷新unit用例验证直连Import/load，已退役；改为验证owner reader调用、normal transport、completion优先及不直接Import，自动兼容Import真实保护由未变normalSaveImage/Script链与production UI承担。新增能力后，Producer旧writer失败用例暴露原先没接completion的假设：原断言“未ACK失败仍保可写token”不代表正常生产行为。按未变owner.failed既有策略，改为检unknown/H0保留、真实PNG bytes保全、admission/autosave/Save拒绝；不把失败降为成功，也不改owner。初次定向62/1fail保记录；其后63/0通过。首次全套1797/1fail是Electron测试fixture漏补必需completion，随后补actual owner，未删断言。

controller-full-tests-final.json最终**1798pass/0fail/0pending，210 testResults**；完整test && build && diffcheck0，build含两端types。controller-ui/重新完整普通main/preload/React/filesystem smoke child0、229wait、无timeout/源码构建漂移/owned进程监听器残留。原NativeClose/平台/所有组合/系统外部fixture限制不变，不能把settle hook检查当完整原生Close认证。

controller-before-identities.json为已接受第三块434源，controller-before/保存当前改变原件；controller-candidate/、controller-manifest.json、controller-task.diff、controller-original-executions.json为固定独审输入。首个Reviewer进程proc_7dea938a992a被agent_close终止（-15），没有结论，不能称持续运行；定位原Session确认后才重新发起。新Session `20261009_195422_3fdd4c`（实核openai-codex/gpt-6.1-sol）接受，无必修；原文controller-review.txt，434当前hash仍匹配接受候选。其余controller/session/死代码继续队列，不整体结案。

## 第四块B：App剩余恒true模式装配退役

源改动只在App：按实际constant-true条件将其余20处import/ternary/if选到正常分支，覆盖队列初始化、History、ensure、Add操作与owned open、新shot发布、普通编辑、layer/clipboard/presentation及Import task清除，不删除controller的其他真实Adapter，不改main/owner/IO或权限。App不再依赖normalSaveAppEnabled。命名scope/recovery集中及调用图清理尚未完成。

新增整App无旧mode检查先真RED：43pass/1fail；旧App.bitmapLayerIdentity实际options矩阵不删，保全部ABA/reload/成功Save/folder/metadata前置拒绝及正向写。用例现在显式替身owner两能力（仅该seam），保刻意false旧绑定证明不能选旁路；不冒充真实owner/磁盘验证，normalSave*真实链与生产UI承担这些职责。故意删identity的负对照保留并改名说明限制。定向44/0及两端typecheck0。

两次全套测试/构建通过但组合exit2来自生成空白行尾空格，均保原执行，不算完整门禁PASS；精确清理后mode-full-tests-ready.json最终1799pass/0fail/0pending、210 testResults，diffcheck && canonical test && build && diffcheck整体0。mode-ui/重建绑定新source/build，guard自测及完整普通Electron child0、229wait、无timeout/source-build漂移/owned进程/listener残留，系统外部替身及平台/NativeClose/完整组合限制保留。

mode-before-identities.json及三原件相对第四块A接受源；mode-candidate/、mode-manifest.json、mode-task.diff及原执行为本块固定独审输入。全新Reviewer `20261009_202128_31ab9c`（实核openai-codex/gpt-6.1-sol）接受，无必修；mode-review.txt保原文。独立AST/token核20处只选原真分支、434身份、三件diff、原矩阵/六执行/新UI成立，不称整个连续优化完成。

## 第五块：有名的工作区生命周期政策

新增workspaceSession Module，实际承担History执行时admission+live recovery、绘画admission+render destination+live recovery、Add/Paste destination snapshot/current、layer render identity及状态的owner/recovery来源接线。不同角色规则不统一：History不受render path限制，绘画受限制；identity-only快照不增加owner/recovery前置；stale render返回每次新nonce；status复用既有derive函数，不把metadata ACK当TIFF完成。真正owner权限/epoch/队列/IO、recovery写入/清除时机及数据格式不变，不建立通用事务或opaque forwarding facade。

App只在一处绑定live getter，六处业务调用命名政策，不再重复上述条件；明确不把所有owner命令包成转交层。新模块四个能力及实际接线分别真实RED→GREEN：session-history-red（0/1）、paint-red（1/1）、destination-red（2/1）、status-red（3/1）、wiring-red（4/1）。预期来自改前App及既有status规则，不由新实现反推。初次typecheck发现destination字段应required-but-undefined，而非optional-key，恢复原Add/Paste形状后两端build通过。

App.bitmapLayerIdentity仍摘实际App options，增加实际Session initializer/factory，原所有断言不变，owner seam仍明确替身；cumulative main ScriptImport fixture同样摘实际initializer并用真实owner/queue/fs/persistence/Save，新增依赖不mockSession、不删除断言。首全套1799/5fail均该fixture缺新词法依赖，保结果并补真实Module接线；session-full-tests-final.json最终1804pass/0fail/0pending、211 testResults，完整diffcheck/test/build/diffcheck0。session-ui重新真实production main/preload/React/合成fs child0、229wait、guard在productionImported=false自测0、无timeout/source-build漂移/owned PID/listener残留；外部替身/native/平台/所有组合限制照旧。

session-before-identities.json为第四块B接受434源，三旧原件在session-before/，新module/test使库存436；session-candidate/、session-manifest.json、session-task.diff及session-original-executions.json为本块固定独审输入。全新Reviewer `20261009_205754_845f8e`（实核openai-codex/gpt-6.1-sol）接受，无必修；session-review.txt保原文。核角色差异/真实初始化时机/无新增TDZ/接口深度、436身份及实际1804全套/生产UI，未把它扩大为通用授权/事务Module。仅调用图/旧注释清理后才能对连续结构队列结案，旧安全块不因此关闭。

## 第六块：按实际消费者退役重复模型与旧宣传

cleanup-production-references.json绑定第五块436源，private package、十四旧stroke/image-edit writer在自身文件外零生产token/字面量引用；同族private updateShotLayers仅为退役writer调用。移除这些声明，不改其余Project规则、legacy字段/reader/flatten/raster化与实际bitmap编辑。无消费者的src/model两文件（生产模型及其三专属测试）退役；正常adapter零消费者的旧mode常量、孤立Comfy类型、App三个无用import/无用纯predicate临时值及旧disabled/on注释清理。generate-release-readme仅将已退役AI宣传改普通Pending，不运行发布、安装或联网。

清理先真实RED：cleanup-writers-red14/2（旧writer接口/旧mode仍存在），model-red2/1（孤立模型仍存在），notes-red0/1（真实生成文本仍宣传AI）。新generator测试在owned临时目录跑实际脚本，用显式synthetic-test/example.invalid输入、不继承凭据变量、不访问网络。

测试保全：仅退役十六旧writer专属case及三孤立model case；旧mode case重命名/改为不再提供开关，新加四case，cleanup-case-delta.json枚举20旧身份/5新身份，1804→1789，不把测试数量当提效。自动AST初选误含两个实际migration case，送审前恢复并保所有断言，仅用明确旧字段构造fixture；cleanup-fixture-proof.cjs对改前真实pure写函数所得输入与现输入deepStrictEqual，仅排除原不稳定root updatedAt，两项通过。首次JSON.stringify比较遇key insertion order差异，不算数据不等或PASS；改语义比较后真实通过。reader/bitmap/IO所有其余case保留。

cleanup-full-tests.json最终1789pass/0fail/0pending、212 testResults，完整diffcheck/test/build/diffcheck0；cleanup-ui新build/source绑定完整普通真实main/preload/React/fs smoke child0、229wait、guard先productionImported=false自测0、无timeout/漂移/owned PID/listener残留。外部边界替身及native/平台/所有组合/旧安全局限照旧。

尝试同步AGENTS两个过时导航条目时，受保护文件写入审批超时，工具明确拒绝；没有重试、没有经CLAUDE或其他路径绕过，AGENTS字节仍原样、CLAUDE仍symlink。它是TODO此前标非阻断的导航尾项，未修改安全/权限规则；SYSTEM实际架构已同步，后续AGENTS需用户通过受保护审批，不能冒称已改。

最终controller选择说明：App所有生产入口无旧mode；需要的正常能力无条件提供，外部刷新及paint/Close的无保护默认退役。其他通用controller的local/prepare/copy-only/测试Adapter能力不一概强制统一，Add provisional/一般像素恢复等涉及冻结契约的进一步收紧不在本轮；这不是恢复生产旧路径或宣称删除了所有optional。main编排/IPC成对布局仍保留。

cleanup-before-identities.json及原件、cleanup-candidate/、cleanup-manifest.json、cleanup-task.diff、case-delta/refs/fixture proof/原执行为固定候选。最终新Reviewer `20261009_214947_2c0004`（实核openai-codex/gpt-6.1-sol）判第六块可接受、当前非冻结累计结构队列可闭合，无必修；cleanup-review.txt保存原文。独核436身份/十一diff/动态根/其余ProjectOps token不变/迁移断言/20→5 test身份差异/1789全套/新真实UI及各旧有效证据。旧安全块、平台与AGENTS可选保护导航尾项未关闭；未提交推送发布。

## 本机累计结案与获取边界

最终source manifest SHA256 `002337987cbbed4559b6dd3733e86828f307744a0a50d29b625bb2a7e8369034`，436项与独审candidate/live一致。持久证据ZIP `/Users/pikachu/.hermes/profiles/engineer/evidence/storyboard-flow-module-optimization-20261009/continuous-accepted-evidence.zip`，SHA256 `f98f93756a020bcd652ef25dba1c7f7c74699b0110bc6d66326f1dbc20a8db87`；CRC、最终所有source成员及关键manifest/review/原执行已核，含各接受版本/前件/原记录/合成snapshots，不包含真实userData/配置/凭据或运行临时目录。archive-manifest保身份，旧证据不覆盖。

本轮实现、自验、独立验收已闭合，本机工作树及构建保留；这不是GitHub备份、跨电脑获取、已合并或发布。main push有公开发布副作用，未经另批不执行。本次后续Reviewer均前台等待真实结论，无启动后宣称持续后台施工；一次中断及保护审批拒绝已如实记录。下一工作块在TODO数据安全/平台部分另定授权，不能把本轮结构接受扩大到一般PNG/History补偿、crash、系统外部能力、Windows或原生Close全矩阵。
