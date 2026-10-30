# Formats / explicit Save — wave 2 设计

2026-10-30；源码基线 `10152aa520ab59fc9dc3cacd6db4d8267f69ae84`。本文件是待主管冻结的方案，未实现、未接 GUI。权威范围见 [README](README.md)，共享数据见 [CONTRACTS](../CONTRACTS.md) 与 `electron/shared/refactorV1.ts`；命名遵循 [NAMING](../../architecture/NAMING.md)。历史交接、第一轮组合测试和命名 GUI 记录分别证明其当时的候选，不能证明本方案已接入。

另只读核对主管 main 新增的 `docs/refactor/wave2/COORDINATOR-GATES.md`，未合并该文件：下述 F0 对应 G0，Module 组合对应 G1，最小接线先过 G2，再过 TIFF G3，清理/规模对应 G4/G5；当前第二轮 GUI 均 NOT RUN。

## 1. 源码核对：已有能力与缺口

以下路径相对仓库根；函数名为查找锚点，观察仅限上述基线。

| 真实调用链 | 已有职责 / 本轮结论 |
| --- | --- |
| `src/renderer/App.tsx:handleSaveProject` → `normalSaveAppAdapter.ts:output` → preload `saveWorkspace` → `electron/main/main.ts:saveWorkspace` | renderer 用 `createRenamePlan/applyRenamePlan` 捕获命名；Main 串行 admission、暂存删除、两阶段改名、Import、TIFF、JSON/MD、提交清理、Trash、管理来源写回，最后核实际 TIFF 哈希。不能用一个新 `saved` 布尔替换。 |
| `normalSaveProjectOwner.ts:savePrepared`；`workspaceAutosaveController.ts`；`main.ts` 的 `automaticCheckpoints: true` | epoch/编辑 token、输出 ACK、删除 lifecycle、required persist 和失败后收据重试已存在。内部自动保存保留编辑，并不清除 TIFF 待输出义务；旧 ACK 不清新编辑。这里的 production checkpoint 不是第一轮 store。 |
| `main.ts:importProjectToFlowFormat` → `photoshopTiffImport.ts` → `scripts/photoshop-layered-tiff-import.py` | 显式 Import 预留整批路径，提取 raster layers，保留 Archive，安装内部 PNG；无 Photoshop layers 标记才走普通合成输入。外来 XMP 不授予本地路径/写权限；脏图外部编辑有 preserve/duplicate 政策。 |
| `main.ts:writeFlowMetadataToTiffs/preparePhotoshopLayeredTiffsForSave` → `photoshopTiffExport.ts` → Python exporter | 所有编码完成并重查 admission 才安装；单层/多层均经受控 preparation directory 和可逆 replacement。Python 最终 composite 内计算 fingerprint，一次写 TIFF/XMP。另有独立 export 文件夹入口，不能混成 Save 的 ACK。 |
| `managedFolderProject.ts`、`folderImageBrowserService.ts` → `managedSourceSave.ts:prepareManagedSourceSave` | `.storyboard-flow-project` 与来源父目录分开；映射由 input/source 哈希及稳定 shotId 建立。管理来源 Save 保持来源名字/格式，首次原件备份到子项目 `.original-images/`；`.source-images.json` 的 current/pending hash 支持精确续办。仅活动 shot 写回，停车/删除不额外删除来源父目录原图。 |
| `storyboardDragEndController.ts` → adapter/owner → `pendingShotFileController.ts` → `workspacePendingAppRuntime.ts` → `pendingShotFilesService.ts` | park 写最新 TIFF 后移到可见 `Pending/`，restore 移回；事务记录先于 effect、项目持久化先于清 journal。普通 Pending 支持外部像素编辑，不支持外部改名/搬移。核心 `moveShots` 只有模型语义，尚无这些能力。 |
| `src/shared/projectOps.ts:createRenamePlan/deleteShots` → `deletedShotFiles.ts`、`saveRecovery.ts`、`fileRenames.ts`、`tiffPreparation.ts`、`saveArtifacts.ts` | 活动镜头命名、Pending 保留路径；Delete 到 Save 才 Trash。部分 publication/cleanup 开始或回滚不完整时保留现场，停止依赖性恢复，不发成功 ACK。内部恢复/History/资产不归格式清理所有。 |
| `electron/core/persistence/index.ts/checkpoint.ts` → `electron/core/platform/index.ts` | 新 store 仅存 ProjectV1、全部引用资产、versions/head；提交前快照、验证哈希/尺寸，同根进程内串行；严格 reopen。没有 TIFF、来源映射、命名、Trash、Pending effects 或生产调用。Windows directory sync 返回 skipped；不是跨文件/跨进程/crash 事务。 |

格式限制须直接面对：Python importer 当前只支持有限 8-bit raster，跳过隐藏/全透明层，把未知 blend 改 normal 并警告，offset raster 扩成整画布；不能承诺保留 Photoshop groups/masks/调整层/16-bit。exporter 将 opacity 乘入像素并写 layer opacity=255，未独立输出普通 layer lock；全隐藏时回退合成全部图层。它给 `psdtags.overlay` 传图像/坐标，未传 blend 参数，故 multiply/screen composite 一致性尚待像素反例核验。`bitmapLayers.ts` 的 sharp composite 则接收 blend。这里是源码风险观察，不是运行时复现结论。

普通外来 TIFF 直接 Import 与旧文件夹转换要分开：当前 folder browser 的转换复制的是可见合成 PNG，不保留其 TIFF 图层；不能把直接提层能力宣传为该入口已有行为。

## 2. Module 与小 Interface（提议，类型未落入共享文件）

使用 codebase-design：两个 Module。`TiffFormats` 隐藏解码/编码及临时资产，`WorkspaceOutputs` 隐藏用户可见文件 effect、来源身份、备份与完成账本。ProjectSession 是唯一作品状态拥有者；formats 不操作 UI/Undo、不调用 session setter。两者的内部 seams 是现有 sharp/Python 编码器和受保护文件 Adapter，差异真实存在；不另造通用文件系统框架。

```ts
// 下述均为 Interface 草案。Main 内 capability 不可序列化给 renderer。
type Capture = {
  sessionId: string; epoch: number; operationId: string;
  projectId: string; revision: number; contentHash: string;
};
type PreparedInput = {
  image: ImageDocumentV1; readAsset: AssetReaderV1;
  source: SourceObservation; warnings: FormatWarning[];
  release(): Promise<void>; // 只释放本次持有的提取目录；不是发布/删除原件
};
interface TiffFormats {
  prepareInput(input: AdmittedInput, scope: OwnedPreparation): Promise<FormatResult<PreparedInput>>;
  encodeTiff(input: FrozenShotPixels, scope: OwnedPreparation): Promise<FormatResult<StagedTiff>>;
}
interface WorkspaceOutputs {
  execute(request: OutputRequest): Promise<OutputResult>;
  inspect(binding: WorkspaceBinding): Promise<OutputState>;
}
type OutputRequest = {
  binding: WorkspaceBinding; capture: Capture;
  snapshot: FrozenProject; assets: PinnedAssetReader;
  intent: { kind: 'save' } | { kind: 'park' | 'restore'; shotIds: string[] }
    | { kind: 'import'; prepared: PreparedImportBatch };
};
type OutputResult =
  | { ok: true; receipt: OutputReceipt }
  | { ok: false; error: {
      code: 'invalid-input' | 'unsupported-format' | 'source-conflict'
        | 'missing-asset' | 'permission-denied' | 'io-failure' | 'recovery-required';
      effect: 'none' | 'restored' | 'retained-or-uncertain';
      operationId: string; stage: string; causes: string[]; recoveryId?: string;
    }};
```

`FrozenProject` 是主管补齐 naming/presentation/对白覆盖层等字段后的作品快照，不把现有 Project 强转为 ProjectV1。`FrozenShotPixels` 含该 shot/image 的有序 layer descriptors、内容摘要和被 pin 的 PNG reader；`StagedTiff` 含本 operation 拥有的相对 staging 路径、实际编码字节哈希、尺寸、composite fingerprint。Main 私有编码 manifest 才解析为路径。`AdmittedInput` 由 Main 读取本地选择/扫描对象、固定文件身份并复制到 owned staging 后颁发，不接受外来 XMP 或 renderer 任意路径作为 capability。

`WorkspaceBinding` 为 Main 颁发的真实 workspace/可选 managed-source-parent 绑定，校验真实目录、alias、原生限制与恢复保护。外部 IPC 只传会话句柄/意图/版本并由 Main 查表，不把 renderer 自报 capture 当认证。`inspect` 只读取、验证，返回上次完成和未完成事实，不恢复、不删除；续办由 session 对同一 operation 明确调用 `execute`，不是自动重新播放破坏性 effect。

Module 构造时注入现有 codecs、受保护文件/恢复预算 Adapter、checkpoint publication 和 session 准入回调；这些是 Main 内部依赖，不是给 UI 的第二套 Interface。Pending/Import 必需的 checkpoint 由捕获原会话的 publication 回调提交，失败保留原 operation；不得在持有输出锁时重入同一 session 队列形成死锁，F0 须冻结单次排他调度的锁顺序。

### 必须一起冻结的共享契约

| 契约增量 | 拥有者 / 最小要求 |
| --- | --- |
| Capture、snapshot hash、session lifecycle | session lane + 主管：同 revision 内容唯一；epoch 防 A→B→A；Undo 用新 revision；Save capture 后新编辑允许保留，旧 completion 仅确认捕获内容。 |
| 全部作品字段/复合命令 | session lane + 主管：naming、遮幅/对白合成、尺寸/clear、Pending/删除生命周期；未支持字段在保存前拒绝，不能静默删字段。 |
| Pixel/asset lease 与 composite 语义 | drawing-assets lane：按编码 PNG hash 寻址，整幅尺寸，pin 覆盖历史/正在编码/checkpoint；定义 blend、透明背景、遮幅/文字哪一层参与交换；所有 reader 完成后才能 unpin。 |
| 输出状态 schema | formats 提案，由主管冻结：独立版本化的 `flow.exchange-state`，不混入纯 Project 的绝对路径或像素，不改 checkpoint 同 revision 内容；持久保存来源/输出绑定、删除意图与 operation journal，绑定 Project id/content hash/版本。 |
| Receipt 与失败结构 | 主管：跨 IPC 可验证的 Capture、目标 scoped relative path、shotId、输入/输出 hash、完成的 rename/delete/source effect、ledger generation；保留 failure/effect 区分，不用 ResultV1 现有简短错误吞掉未完成事实。 |

建议新项目账本放 `.storyboard-flow/exchange/state.json`，operation 放 `exchange/operations/<id>/`。这些都是新格式提议，不迁移当前 `.source-images.json` 或恢复目录。state 不存第二份可编辑 Project；journal 只存有限计划、捕获 snapshot 身份及恢复所需物件/引用，checkpoint versions 提供作品快照。每次 state 发布通过受保护临时文件 + readback，不以写入调用返回替代验证。checkpoint head 与 state 是两个文件：通过不可变 operationId/contentHash 链接和未完成 journal 对账，不宣称同时原子提交。

持久绑定用 `{scope: 'workspace' | 'managed-source-parent', relativePath, shotId, sourceId, acceptedHash}`；可选 `originalHash/backupRelativePath/pendingHash`。sourceId 在 Import 时生成，禁止按当前数组顺序、镜头名字或外来 shotId 猜对应关系。真实绝对路径/文件 inode/权限观察仅在 Main 当前绑定中；目录整体搬迁后重绑并复核内容，旧 capability 失效。managed-source-parent 仅允许经验证 marker 证明的直接父目录，不能成为任意 `../` 写权限。

## 3. 顺序、状态和失败语义

### 输入准备与内部 checkpoint

1. Main 固定来源观察（root、普通文件身份、字节 hash、原生限制），复制稳定输入到独占目录，前后核源身份/内容；解码只读该副本。来源改变时拒绝发布，保留用户原件。解码整批验证层路径、PNG hash/尺寸、schema、警告；仅 no-layers 标记允许普通 TIFF 合成降级，其他 decoder 错误不吞。
2. session 先确认 warnings 的接受政策，再以一个复合命令安装 image/shot/来源绑定意图；必要 PNG 写入并验证、内部 checkpoint 成功后才宣布可编辑输入准备完成。普通 Import 已有 Archive/working TIFF 物化作为独立用户意图，由 execute(import) 负责 journal 和 required publication；不把 prepareInput 的成功当 Import 完成。
3. 新项目 Import 失败保留 staging/失败证据，禁止删未归本次持有的对象；取消在尚无 effect 时无 publication，已开始的 encoder/写操作必须 settle 后方能清本次对象。超时不是取消。读者 session 过期时不发布，其资源仍由原 operation 收尾。
4. internal checkpoint 只写 `.storyboard-flow/checkpoints` 的必要资产/版本/head；不改 root 原图、不最终改名、不 Trash、不自动刷新 TIFF。可独立成功，推进 `checkpointRevision`，不推进 output receipt。已有 Import/Create/Pending 物化例外仍是明确用户意图。

### 显式 Save

同一物理 workspace 的 checkpoint、Import、Pending、Save 和外部变更采纳经 session/Main 共用调度，禁止 formats 另建互不知情的写锁。并行只在有限编码 jobs 内；第一处失败停止领取新 job，等待已启动 job/子进程退出后补偿。源目录别名指向同一个 root 时也不能绕锁。不宣称跨进程 lease；支持范围内逐次重查，发现竞争拒绝。

1. session 捕获 `S=(sessionId,epoch,P,r,contentHash)`，pin 所需资产；等待该 snapshot 的 checkpoint 确认。Save 不要求阻止用户后续编辑 r+1，但下一次文件 effect 排队；Close/switch 等待原 operation settle 并由 session 复核其所有 slot。
2. execute(save) 在 Main 生成有限计划：仅 active shots 输出/最终命名/Markdown，parked shots 预留名字但不被烘焙或写回来源；已删除记录带独立 lifecycle id 与删除前 source/output 身份。先整体检查现有 target、临时名、大小写/Unicode 碰撞、源内容、目录身份、原生权限、首备份可建立性及预算。无许可/未知限制拒绝，不 chmod 原件。
3. 先完成全部 TIFF staging，并重读校验尺寸、XMP、实际编码 hash/composite；所有待覆盖来源先完成精确首次备份并验证。普通 Import 原件已有 Archive 引用；managed 原件备份用稳定 sourceId 对应的首次 bytes，重复 Save 不替换。已有备份 hash 不符拒绝。只备份自己的工作输出不等于已备份来源原图。
4. 持久写 operation journal（plan、expected hashes、每项 before/after、备份与阶段），再做删除文件暂存和两阶段 working filename rename；每项 install/来源写回前重查身份及 expected bytes，使用原生受保护 writer。managed 原件按原名字/格式输出，不随工作 TIFF 改名；无来源绑定的新 shot 仅 create-only，碰撞不覆盖。
5. 安装 TIFF、写 active-only `storyboard-script.md` 等必要镜像，记录事实。managed 写回按每项 pendingHash→安装/readback→currentHash 协议；每项进度先落账再推进。Trash 是明确 Delete 的尾部 effect，不是 Archive；不会把 managed 父目录来源原图一并 Trash。session 的删除意图不能因 Undo/re-delete 的旧 ACK 被错误退休。
6. 校验全部目标实际 hash、必要镜像和 state publication/readback；确认所有必须清理的 owned temporary/backup tail 已完成，才发成功 Receipt。长期首次备份、checkpoint/history 资产、失败记录不是本次清理对象；8GiB 恢复预算沿用实际/预留共同计账，超支拒绝新支出，不自动删保留数据。
7. session 只推进 receipt 捕获内容的输出事实，r+1 仍待输出。Receipt 不修改作品，因此不为了 ACK 重写同 revision checkpoint；reopen 用 ledger/contentHash 与真实文件核验，不能仅因 revision 相等显示已同步。必要 output ledger 持久化失败时没有成功 ACK。

状态分开保存：`currentRevision`、`checkpointRevision`、`lastCompletedOutput{capture,targets}`、`inFlight/recoveryRequired`。`checkpointRevision=r` 且 output=r-1 是健康可编辑保留，但未完成新 TIFF 输出；是否可 Close 由 session 的健康 checkpoint/未完成 effect 判断，不能强迫 Save 以掩盖 checkpoint 失败。

### R1：输出账本的重开判定

`inspect` 分别验证两组事实，不能把它们合并为“两个文件 revision/digest 必须相同”：

- **当前内部状态**：head 的 projectId/revision/contentHash 与其自身 snapshot、所需资产一致；这是可编辑与 checkpoint 的基础。
- **历史输出事实**：完成账本的 capture 与其捕获的历史 `versions/<r>.json`（同 projectId、r、canonical contentHash）及该 operation 的有限输出计划配对，再核对实际目标 hash、首次备份、来源绑定和已完成 effect。比较对象是被输出的 snapshot，不是当前 head。后续已完成 park/restore 若移动了目标，按已验证的 namespace receipt 链解析当前位置，不把合法移动误判为外部改动。历史 snapshot 缺失或自身 digest 不符不能猜为已同步。

重开创建新的 sessionId/epoch；历史 receipt 的旧 session 身份用于追溯，不要求等于新 session。新会话只能从核验结果建立输出基线，不能重放旧异步 ACK。“revision/digest 不配对即拒绝写入”仅指一条记录与**它声称捕获的 snapshot**不配对，或当前 head 自身校验失败；不指历史输出 r 与健康 head r+1 不相等。

下表以当前 head/资产已验证为前提，健康 Close 还须所有 slot 无未持久化编辑、运行中的任务或未结算 effect；它不要求最新内容已输出 TIFF。`pending-output` 仅表示当前内容尚待显式输出，既不是损坏，也不是 `recovery-required`。

| 重开状态 | 输出判定 | 允许动作 / 必须限制 |
| --- | --- | --- |
| 首次无完成输出：有效初始化账本记录 none，或已认证新项目尚未建立输出账本；无未完成 journal | 正常；有待输出内容时为 pending-output | 允许编辑、checkpoint、健康 Close，以及在来源/目标准入通过后的首次 Save；不为“无输出”强制 Import、恢复或改写 root。预期存在的旧账本无故缺失不能冒充首次。 |
| 内部领先：head=r+1，完成输出=r；r 的历史 snapshot、账本和实际目标均核验通过 | 正常 pending-output；仅确认 r 的历史输出 | 允许编辑、checkpoint、健康 Close，下一次显式 Save 捕获最新版本；不能拒绝 r+1 的内部写入、回退 head 或把 r+1 标为已输出。首次仅 autosave、从未 Save 亦按上一行处理。 |
| 匹配输出：head 与最后完整 Save 的 snapshot 内容/版本配对，所需目标及 effect 全核验通过 | 当前输出匹配；无 pending-output | 允许编辑、checkpoint、健康 Close、重复 Save；新编辑后转为 pending-output。revision 相等但内容/目标不符不进入本行。 |
| 重开后遗留未结算 effects/journal、partial publication/cleanup 或实际效果未知 | recovery-required，与是否 pending-output 独立 | 允许只读 inspect/浏览、保留诊断及原 operation 的经验证续办；默认暂停该会话新编辑和后续写 effect，不认证健康 Close，不自动重放 Save/Trash。全部 settle/对账后重新分类；不能因 head 健康就抹掉 effect。这不改变正常会话 Save 正在执行时允许捕获版本后的新编辑。 |
| 账本损坏、预期账本缺失、历史 snapshot 配对失败或绑定无法验证 | 输出事实未知；若不能排除未结算 effect，保守为 recovery-required | 可只读加载健康内部作品/导出诊断；拒绝用户可见输出写入，不重建 synced 事实。先查 journal/恢复证据；未排除 effect 前暂停编辑/checkpoint 和健康 Close。若独立证据证明无未结算 effect，允许内部编辑/checkpoint/健康 Close，输出仍拒绝直至账本/绑定修复并验证；不能把损坏当普通版本领先。 |
| 仅来源/实际目标被外部改动：账本及 journal 完整，已证明没有本地未结算 effect | source-conflict；可同时 pending-output，**不自动升级为 recovery-required** | 允许内部编辑、checkpoint、健康 Close；拒绝覆盖冲突目标。须显式采纳外部版本或解决冲突后重新准入 Save；不能直接更新 acceptedHash 伪造同步。若同时有未知本地 effect，按上方 recovery-required 行处理。 |

因此，仅“output revision 落后”不构成恢复阻塞；真正的阻塞来自未结算 effect、无法认证的账本/绑定或写目标冲突。来源冲突限制用户可见输出，不等同于内部 checkpoint 损坏；当前 head/资产自身无效则不在本表正常编辑前提内。

| 失败时点 | 返回与保留规则 |
| --- | --- |
| 校验/预算/缺资产/编码失败，未安装 | effect=none；根文件和上次完成账本不变。已启动任务全部 settle，清理失败升级 retained-or-uncertain。 |
| 改名或 replacement 失败，publication 尚未开始 | 按逆依赖恢复；只有全恢复并核验才 effect=restored。任何无 handle 的不完整恢复也必须阻止后续依赖恢复。 |
| JSON/MD/state publication 或不可逆 Trash/backup cleanup 已开始 | recovery-required + retained-or-uncertain；不再声称整体回滚，不写旧 Project 覆盖新磁盘；保留目标、旧备份、journal、阶段结果。实际安装完成也不能发成功 ACK。 |
| 原件替换成功、ledger finalize/readback 失败或 ACK 丢失 | 原 operation 留 pendingHash；重开先 inspect。仅核对同一目标实际 hash、备份和阶段后续办，禁止再备份已改原件/重放已 Trash；外部第三种 hash 为冲突。无效 ledger 不能“修复”为 synced。 |
| head rename 后目录 sync 失败 | checkpoint 可能已发布但没有成功收据；session 不回写旧版本，先核实际 head 再续办。Windows skipped 单独表达，不包装成已具备 POSIX 目录持久性。 |

### Pending 保持现有语义

execute(park/restore) 使用独立 operation/lifecycle：journal → park 指定 shot 最新 TIFF materialize → 移动 → 必要内部 checkpoint/输出绑定持久化 → 清理 → receipt。restore 不烘焙整场景，最终排序命名仍在 Save。仅收到对应 receipt 后发布成功状态/历史命名重定位；非空目的场景的遮幅/对白继承取最新 peer，由 session 的复合命令完成。若 move 已成功而 checkpoint 失败，不能仅把数组反向移动就称恢复完成。

Pending 外部改动通过显式/现有采纳路径形成新内容命令与资产，再 checkpoint；不能直接把新文件 hash 写成 synced。逻辑 Pending 延后到 Save 才写文件是可选产品变更，**不包含在本方案默认实现**。

## 4. 一条完整链与竞态反例

新建合成目录中的受支持 TIFF → prepareInput 得到有限 raster layers/源观察 → execute(import) 安装并 checkpoint r0 → drawing lane 产出一笔 PNG（A→B）→ storyboard 复合命令 r1 → checkpoint r1 → Undo 得到新 revision r2、重新画得到 r3 → checkpoint r3 → 健康 Close → 新进程 loadCheckpoint + outputs.inspect → PNG hash/图层/文字相同 → Save 捕获 r3 → staged TIFF + 首备份 + 命名/写回/MD/state 完成 → 收据 r3。全程内部 checkpoint 前后 root TIFF 不变，直到明确 Import/Pending/Save 所授权的物化点；重开不是重导 TIFF。

必须可复现的反例：

- r3 编码中画 r4：输出可完成 r3，r4 仍 dirty；后续 Save 需要 r4。A→B→A 同 projectId 也因 epoch 不同不能接旧 ACK。
- Save r 成功后继续编辑并仅 checkpoint r+1，健康 Close→新进程重开：核对 output r 与历史 snapshot r/实际文件，核对 head r+1 与其资产；允许继续编辑和内部保存、显示 pending-output；不能以二者 revision/digest 不同拒绝写入或要求恢复。
- 首次 Import/准备完成后只编辑并 autosave，从未显式 Save，正常 Close→重开：完成输出为 none（已有 Import 物化收据仍分别核验），内部内容精确保留，允许健康 Close/首次 Save；root 不因重开补写 TIFF，不能把缺少 Save 收据判成损坏。
- 导入/编码准备时外部改 TIFF，或首备份完成后原件被改：安装前 expected hash 再检失败，保留两方版本，不用 mtime/文件名判断同一内容。
- 删 s → Undo → 再删 s：旧 lifecycle 的 Trash receipt 不退休新删除；文件已实际 Trash 时 Undo 需从保留资产生成待输出状态，不能假装旧 root 仍在。
- park 移动完成后 required checkpoint 失败/清理失败：保留可恢复位置事实/journal，阻止下一次不相干文件操作与健康 Close；不对新 slot 发布旧数组。
- 两阶段改名循环、预存临时名、readonly、symlink/hardlink/父目录替换、同源重复绑定、来源名字和工作名相同：先拒绝不安全计划；不得靠最后一个写覆盖解决。

## 5. 归属、切换与可删除证据

| 当前职责 | 新拥有者 | 调用方切换 / 删除证据 |
| --- | --- | --- |
| TIFF 提取/manifest/XMP、sharp/Python 编码计划 | `electron/core/formats/**`（formats lane） | 先以 synthetic public Interface 验证；Main 旧 helper 调新 Module 后删除已无调用的编码编排。保留 Python/native helpers，除非有明确替代像素/权限证据。 |
| 原图绑定、首次备份、输出哈希、命名/删除/Pending journal | `electron/core/outputs/**`（formats lane） | Main 保留认证/恢复准入并转接 execute；替换 `managedSourceSave`/Save/Pending 原编排需逐项反例与实际 FS 通过，之后才删除。不能复制一套旧 owner 形成双写。 |
| 会话/history/checkpoint 调度、版本/生命周期/健康 Close | session lane 的单一 ProjectSession | adapter/owner → session；生产 `normalSave*` 删除须所有实际调用者退出、hidden slots/late ACK/required persistence 反例及 GUI 通过。formats 不编辑这些文件。 |
| 素材生产、pin/composite、缓存与 Undo 资产 | drawing-assets lane | formats 仅消费 frozen reader；pixel lease、混合/隐藏/透明合成一致性证据先于移除旧 ensure/bake 路由。 |
| preload/Main handlers/App/共享 schema/命名规则 | 主管 | 三份 preload 声明同步；`handleSaveProject`、autosave、Import、Pending、外部采纳、Close 改用已冻结 Interface。保留既有准入和恢复保护，完成 caller 搜索及真实接线测试后删旧路径。 |

建议实施分配（此轮不执行）：

1. **串行 F0 / 主管**：冻结完整作品投影、Capture、asset lease/composite、exchange-state/错误/receipt、source-parent 绑定和 session checkpoint/effect 调度。解决第 7 节问题；无契约不同时开两个写入拥有者。
2. **F1 / formats 独立**：仅新建 `electron/core/formats/**` 与该目录测试；封装现有 Python/sharp，做准备/编码、有限支持/警告、临时目录归属和 draining。依赖 F0 像素协议；不改 scripts、main、refactorV1。需要编码器修正由主管另下单串行修改，F1 不先行抄新脚本绕开。
3. **F2 / formats 独立**：仅新建 `electron/core/outputs/**` 与测试；真实 synthetic FS 上完成 source/backup/ledger/recovery/rename/delete/Pending；复用现有受保护 writer、恢复预算/原生准入 Adapter，不安装依赖、不重写全平台。依赖 F0；F1 完成后接真实 staged TIFF。
4. **串行 F3 / 主管接线**：session 最小 UI/资产链完成后接一次 Import→draw→Undo→checkpoint→reopen→Save；修改 Main/IPC/preload/renderer 共享文件，formats 提供 owned Module 修正，避免共享文件碰撞。先一条链闭合，再接双视图/全部工具/Pending。
5. **串行 F4 / 主管审查**：完整保护矩阵与独立审查通过后，按上表删除无人调用的旧编排；保留原文件/恢复数据；不实现旧测试项目兼容，不自动迁移，不 push。

## 6. 验收计划（全部 NOT RUN）

| 层次 | 必须留下的行为证据 |
| --- | --- |
| formats Interface | 普通 TIFF/no-layers fallback、有限多层、层顺序/尺寸/opacity/blend/hidden/lock/Unicode、坏 manifest/路径逃逸、16-bit/未知格式、PNG hash 错误；warning 不静默；编码失败不安装、兄弟任务实际退出后才 cleanup。新合成 fixtures，不读禁用 fixture。 |
| 像素一致性 | 用有意义小图测 normal/multiply/screen、半透明、全部隐藏、遮幅/对白/clear；对比 drawing 的约定 composite、真实 TIFF decode 和 metadata。精确值或有理由的容差；XMP 不代替像素证明；明确 lock/opacity 可编辑性保留范围。 |
| outputs Interface + 真临时 FS | 首次 bytes 备份精确且不覆盖，稳定 shot/sourceId 经过改名/重排；root/managed 两种 scope；二阶段循环改名/碰撞、外部变化、alias/硬链接/权限、并发根锁、缺资产、预算拒绝；内部 checkpoint 不改可见文件。 |
| 每阶段故障 | 编码/备份/移动/安装/MD/state/Trash/cleanup/ACK 丢失逐点故障；全恢复与 retained 分开断言；失败 evidence 保留、重开核验续办不重放；late ACK、A→B→A、r+1 和 delete lifecycle。fake Trash 仅证编排。 |
| 真实接线与 GUI | 隔离 userData + synthetic directory，经实际 renderer/preload/Main/Python 完整第 4 节链、健康无 Save Close/reopen、Save 中继续编辑/切换、失败阻止错误成功；普通和日式视图；park→外部像素变化→采纳→restore→Save；旁路原件/Archive/History/恢复 objects 完整。GUI 操作和图片需截图/字节证据，public tests 不能替代。 |
| 最终门禁 | 记录候选 SHA、完整命令/raw logs/exits/skips/owned cleanup；批准枚举的完整 allowed tests + `npm run build`（双 typecheck）；preload 改动加 `check:preload`，resources 改动加 `prepare:package-resources`。真实 smoke 先审查脚本作用与授权；Trash/clipboard 需单独隔离/授权，不盲跑。主管独立审查与验收后才能称 accepted。 |

TIFF 精确子案例：合成 8×8 输入含可见红层、隐藏蓝层、全透明层，核对现 importer 只返回可见非空层及两项警告，拒绝无可见非空层输入；新链不可在无人接受警告时发布丢层工程。半透明层 opacity=0.5，核对当前 exporter 的 alpha 已乘、layer opacity=255，重导不能再乘一次；内部原 PNG/hash 与 opacity=0.5 descriptor 必须仍精确保留。全隐藏输出当前回退可见的源码事实与第 7 节新政策分开断言。混合模式用重叠异色像素同时比 TIFF composite 与 drawing composite；断言失败是缺陷，不删除断言。隐藏/透明/lock 的可编辑属性在 TIFF 往返若不能保留，须明示能力限制，不把内部 checkpoint 的保留当成 TIFF 交换能力。

G2 的专属合成工程固定为 4 个活动镜头 + 1 个 Pending、每图 3 层，中文脚本→排序→一笔→透明度→Undo 两次→Redo 两次→checkpoint→Close→新进程重开。随后 G3 从合成 TIFF 走新 formats：画一笔→Save→Undo→再 Save→重开，核两次像素输出和同一首次备份。两条均须真实接线；另参照 ACCEPTANCE A01/A06/A08–A12/A14/A15 执行本 lane 相关场景，全部工具/双视图完整验收留 G4，不混称最小链已经覆盖。

复用的已阅读回归入口：`photoshopTiffImport.test.ts`、`photoshopTiffExport.test.ts`（含 exporter drain）、`tiffSavePreparation.test.ts`、`managedSourceSave.native.test.ts`、`saveRecovery.test.ts`、`fileRenames.test.ts`、`pendingShotFilesService.test.ts`、`pendingFileTransactionService.test.ts`、`normalSaveMainChain.test.ts`。此轮只读定义/用例，未执行；不是声称所有测试覆盖足够。禁用 fixture 从未读取/复制/哈希/执行。

平台限制：当前 store 进程内串行不能阻止另一进程；无网络盘/任意 FS、断电/crash 多文件全原子保证。POSIX directory sync 与 Windows skipped 要分开报告；Windows 文件占用、ACL/原生 writer、大小写/Unicode、硬链接能力、Python/vendor/安装包和真实 Photoshop 均需各自实际证据。1000 镜头/大 raster 需测峰值 RAM、CPU/磁盘/staging 与时延，不从当前并发常量或小 PNG 单测推导性能。

## 7. 真正需要产品决定的问题

既有“显式 Save 首次备份后覆盖来源”“命名只在 Save”“删除到 Trash”“可见 Pending 先物化再移动”已经有决定，本轮不重问。下列问题由主管汇总，未决前不扩大实现：

1. **外来 layered TIFF 的有损导入提示**：现 importer 跳隐藏/空层及降级 blend；建议默认继续提供有限 raster Import，但发生丢层/降级时须在发布前明确接受警告，不自动对源覆盖或静默重开为无损；不支持的位深/结构拒绝编辑并保留只读预览。代价是某些输入增加一次确认；如要保留隐藏层，需独立编码器修正任务及 fixtures。
2. **全隐藏图层的 TIFF 可见画面**：现 exporter 回退显示所有层，与“隐藏”直觉存在冲突。建议新格式 composite 按可见层合成、全隐藏输出白色交付底，内部 PNG/隐藏层仍保留；这是可见行为变化，实施前需批准并与 drawing lane 统一。若维持旧回退，则 GUI/输出预览必须明确同一规则，不能各算各的。
3. **Pending 是否延后文件效果**：若产品希望改为纯逻辑暂存，才需集中决定；推荐本轮保留现有物化、可见目录、外部像素编辑和恢复行为。延后到 Save 会改变 Finder/Bridge 可见性和外部编辑时机，因此不能当重构内部细节直接改掉；未批准即实施现有语义。

multiply/screen 的 composite 是否正确、lock/opacity 是否被保留是工程验证和交换契约问题，不拿“需产品决定”推迟核验；没有通过证据前限制声明，不许标为完整 Photoshop round-trip。PSD/SQLite/PDF/cloud/新 AI 均不在此轮。
