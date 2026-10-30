# Session：单一项目状态与编辑生命周期

2026-10-30，核对基线 `10152aa520ab59fc9dc3cacd6db4d8267f69ae84`。**设计提案，未实现**；只交付本文件和 worktree 的 TASK.md。共享类型变更须主管冻结后再实施。已验收的第一轮是独立核心及有限无界面组合；本轮未运行任何测试、build 或 GUI，不增加新核心已接入界面的声明。

已只读核对主管 main 新增的 `docs/refactor/wave2/COORDINATOR-GATES.md`（不合并 main，也不复制到本提交）：以下 S0–S5 对齐 G0–G5，验收案例沿用 `docs/refactor/ACCEPTANCE.md` 的 A01–A16；全部新核心 GUI 场景仍为 NOT_RUN。

主管修订 R1/R2（2026-10-30）：修正 reopen 的合法输出落后判定，并以目标图像/历史分支/真实依赖替换全项目 revision 像素门禁；原稿 `e5b08c4` 的相应措辞以本稿为准，仍未修改共享契约或实现。

## 1. 已有能力与真实调用链

路径以下均从仓库根算起。

| 已核对源码 / 调用方 | 现在实际负责 | 新接入必须保留的语义 |
| --- | --- | --- |
| `src/renderer/App.tsx` 的 `updateProject`，`projectEditController.ts`、`dialogueActionController.ts` | 文字/命名动作进入 owner.publishEdit；App 另记 History、dirty、autosave revision | 一个动作只发布一次事实状态；拒绝/无变化不新增 History。当前控制器直接传旧 Project 的模式不能照搬 |
| `JapaneseStoryboardView.tsx::japaneseStoryboardRows`，App 的 `handleShotDialogueText` | 与普通网格共用 Project，actionText 来自 scriptText，dialogueText 为有序对白投影 | 两个视图编辑同一模型；日式文本编辑复用现有对白 ID/空行规则，不建立第二份作品 |
| `workspaceSession.ts::createWorkspaceSession` | 捕获准入、目的地和 render identity，调用真实 owner | 这不是新项目 Session；路径相等不证明同一次打开，不能复用该名称掩盖缺失能力 |
| `workspaceSlots.ts::requestOpen/freezeForClose`，App 的 `captureSlotView` | 每 slot 独立 ref/adapter、incarnation/generation；冻结、producer/queue/adapter drain、Main 认证、staging 后单点切换 | 隐藏 slot 的错误、History、资产意图不能丢；B 打开失败不能半发布；Close 要全部 slot 的新鲜 capture |
| `projectHistoryController.ts::applyHistoryEntry` | Project、selection、文件名状态和 PNG 快照；真实恢复/补偿与原队列内 required persistence/ACK | Undo 不是只换 JSON；已开始效果即使视图失效仍结算原 slot；失败不得提前弹栈 |
| `bitmapLayerPaintingController.ts::enqueuePainting/handleBitmapStroke` | 捕获原 workspace、像素/Undo 前态、写 PNG、完成与失败归属 | 第一轮 `replacePixels` 不生产像素；异步结果必须验证完整图像基线及会话归属 |
| `workspaceAutosaveController.ts::registerWorkspaceAutosave` → App `persistWorkspace` → `normalSaveAppAdapter.ts::autosaveAndPublish` | 600ms debounce，owner 队列持久化，epoch/sequence/project 限制旧回调 | 内部保存与输出不同；未来调度不得把旧收据当作当前版本已保存 |
| App `handleSaveProject` → adapter `saveAndPublish` / owner → preload/Main | 命名补全/导入准入、排他 Save、实际输出和 required JSON ACK；原 Save 结算与状态回调都 drain | 新 renderer receipt 不能替代 Main 的原生权限、来源、文件身份和失败留存 |
| `storyboardDragEndController.ts` → adapter `pending` | park/restore 经过文件效果、持久化；restore 后按最新非空 peer 场景继承遮幅/对白，空板保自身；History 另做 namespace rebase | 第一轮 moveShots 只是逻辑成员变化。现有 Pending 文件语义及非普通 Undo 行为不能悄悄改变 |
| `electron/main/main.ts` 的 `automaticCheckpoints`/`certifyEditableSet` → `recoveryCloseBarrier.ts` | 当前旧链可编辑终态认证；Close/reload 认证真实 caller/frame，并二次比较新鲜 capture | 保留认证不是完成 Save、不是解锁；超时不取消在途效果；正常 Close 不必烘焙 TIFF |
| `src/core/storyboard/index.ts::createProjectHistory` | 不可变副本，单条 apply，maxEntries；Undo/Redo 新增单调 project revision，图像 revision 可恢复旧值 | 没有 batch/history 导入导出或 lifecycle；每图不能另立 Undo 栈 |
| `electron/core/persistence/{index,checkpoint}.ts` | 新 checkpoint 严格模型/资产校验、资产→版本→head，进程内同 root 串行；最后目录 flush 失败不回成功收据 | 未接生产；head 已替换而 flush 失败可能有磁盘效果，不能称已回滚。版本文件不等于用户 Undo 栈 |

## 2. Module 与状态归属

建议新增 headless `src/core/session/` Module，向 UI 提供一个 ProjectSession Interface；Implementation 组合 storyboard history、drawing 结果、资产租约及异步调度。作品模型只有 history.current 一份可写事实；Session 的 immutable snapshot 是它的发布视图。React 仅订阅，不再 `setProject` 另写作品。工作区 registry 持有每个 Session 和当前选择，切换不复制作品模型。

- Session 拥有：作品命令准入/顺序、唯一项目历史、当前 revision、在途 operation、checkpoint/Save 状态、持有的当前/History/在途资产引用。
- drawing-assets Module 拥有：真实像素制作、编码、不可变资产注册/读取与有界缓存。Session 不携带 PNG/data URL，不以 assetId 存在就假定字节可读。
- Main runtime Adapter 拥有：真实 root/caller/document 绑定、文件验证、持久化和输出效果；renderer 中的 sessionId/digest 是关联信息，不是写权限。新 headless Session 不能绕过旧 Main 的保护。
- UI 拥有：焦点、缩放、画笔/Blur 参数、临时选区、拖拽预览；shot/layer selection 作为 per-session ViewState，可由历史条目的附属 before/after 恢复，过滤已不存在 ID，不写作品 manifest。现有工具手感留在 SketchPad/controllers。
- registry 私有管理 open/switch/all-session close。只向 App 暴露 open、active snapshot 和 close capture；不要让每个卡片学习多 slot 协议。

## 3. 小 Interface 草案（待冻结，非现有导出）

```ts
type Version = { sessionId: string; incarnation: string; projectId: string;
  revision: number; snapshotDigest: string };
type Envelope = { version: Version; operationId: string; rootBinding: string };
type SessionRequest =
  | { kind: 'edit'; command: SessionCommand }
  | { kind: 'undo' | 'redo' }
  | { kind: 'checkpoint' | 'save' }
  | { kind: 'freeze'; reason: 'switch' | 'close' | 'reload' }
  | { kind: 'resume'; freezeId: string };
interface ProjectSession {
  snapshot(): Readonly<SessionSnapshot>;
  subscribe(changed: () => void): () => void;
  request(request: SessionRequest): Promise<SessionResult>;
}
```

`SessionSnapshot` 含不可变作品、Version、canUndo/canRedo、lifecycle（active/freezing/suspended/closed）、health（healthy/checkpoint-error/recovery-required）、未结算 operation 摘要及两类独立收据。`SessionResult` 为带 request kind 的判别联合：edit/undo/redo 返回 changed+Version+ChangeSet；checkpoint/Save 返回捕获 Envelope 的收据；freeze 返回 freezeId+受保护 capture。失败返回 code、phase、effect（none/possible/confirmed）、operationId、是否可重试、是否仍需保留原会话；不能用 boolean 吞掉失败。

构造时注入已加载作品、Main 发行的 rootBinding、唯一 session/incarnation、时钟、资产 Adapter、checkpoint Adapter、formats-save Adapter。UI 不拿这些依赖。SessionResult 新增 busy、stale-session、recovery-required 等本地错误，与现有 ResultV1 核心错误分层；不要为 session 私改 CoreErrorCodeV1。序列化 Envelope/收据和 IPC 校验由主管统一定义。

`SessionCommand` 至少分为 board（冻结的原子/复合领域命令）、image（捕获 image baseline 的像素/图层意图，由注入 Adapter 准备资产）、presentation（整场效果）、import、pending。载荷传稳定 ID/参数或受验证准备句柄，不接受任意 Project/回调。当前 V1 已支持的纯命令先用 board；未实现命令明确拒绝，不能通过空操作冒充支持。同图的像素准备按接纳顺序串行，以前一笔结算后的图像捕获下一笔 before；保存可重放的笔画意图，UI 的预渲染 PNG 只可用于其完全匹配的基线。尺寸/目标改变时不能把旧坐标或旧整层 PNG 强塞到新图。同图需等待前笔，其他文字及无依赖图像不等待光栅计算。

### 顺序与 identity 不变量

1. 每个物理 root 在当前进程只允许一个写 Session；registry 先经 Main 识别别名，再查已持有实例。重新打开/renderer reload 必须更换 incarnation；同 path、projectId、revision 也不采纳旧结果。跨进程锁/竞争不由此获得保证。
2. 命令在接纳时固定 Session、目标和控制 generation，准备实际开始时捕获完整 before image 及声明的真实读取依赖。同步作品提交串行；像素准备在提交队列外执行，完成后按下文 PixelAdmission 进入提交队列。**不比较全项目 revision/digest 是否仍等于准备时数值**；无关 scriptText/命名编辑不使笔迹失效。普通命令在执行时读当前状态。
3. 已接纳的像素准备属于该 Session；freeze 停止新准入，尚未开始的任务可明确取消，已开始的任务保留字节并结算原 Session。UI detach 只取消旧视图通知。操作失去基线时不提交，未引用资产仍留存，不自动清理；失败效果不明则进入 recovery-required。
4. 有变化的用户动作只增加一次 project revision 和一条 History；失败/净 no-op 不变。Undo/Redo 走同提交队列，是新 revision；图像 revision 复用不能通过 ABA 校验，须比较完整 before 内容及下述 branchGeneration。新编辑清 redo，但仍保留在途/磁盘引用。保存收据仍绑定原 Version，不因像素准入允许无关文字而放宽 ACK 的版本核对。
5. `snapshotDigest` 是主管定义的 canonical manifest 内容 SHA-256（包含 revision）；初始加载和串行命令提交在发布前经注入的 digest Adapter 计算，Main 在实际副作用时独立重算/比对。异步摘要计算也在同次命令的提交序列中，不能先发布再补写 identity。rootBinding/operationId/document 同时匹配才结算。原 `CheckpointReceiptV1` 无 digest/session 字段，可在 Adapter 包装，不单独改低层存储的权限语义。

### 像素提交准入：Session / drawing 共享的 PixelAdmission 提案（R2）

准备句柄由 Session 注册，至少包含 `{sessionId, incarnation, operationId, shotId, imageId, targetLayerId, branchGeneration, cancelGeneration, beforeImage, dependencies}`，多图复合动作携带所有目标 before。operationId 必须仍是原会话未消费的已接纳操作；调用方不能自行声明“基线有效”。准备时的 project Version 只留作追踪，不充当该准入锁。

- **会话与取消**：incarnation 必须匹配原 Session；operation 的 cancelGeneration 必须未变。显式取消该操作使其失效。Undo/Redo 在准入允许且有相应已提交历史时接纳；接纳时、任何 await 前，单调提升 Session 的 branchGeneration，撤销此前准备/排队操作的提交资格；即使后来恢复为完全相同的图像也不复活。没有相应历史则返回 not-found，不提升 generation；已接纳导航后来失败也不回退 generation。普通前向文本编辑及其清 redo 不提升此 generation。整体替换工程另换 incarnation。generation 不是可由 Undo 恢复的作品字段；溢出拒绝，不回绕。
- **目标基线**：当前仍存在同一 shot→image 关联和命令所需成员状态（如画笔要求 active）；当前目标 ImageDocument 必须完整等于 beforeImage，包含 image revision、画布尺寸、全部层的 ID/顺序/像素引用/锁/显示/属性。再检查目标层当前是否允许该操作。锁变更、层删除、同图其他编辑等造成差异时返回 conflict/locked，不能只比较 layerId/assetId 或忽略图层锁。
- **真实依赖**：由冻结的命令实现生成类型化 read-set，Session 重读比对，不让 UI 任意省略。普通 stroke/eraser/fill/Blur/选区提交读取目标图像、shot 关联/成员状态及捕获的工具/几何输入，不读取 scriptText、项目名、无关镜头顺序；后者可变化。对白 overlay 还依赖其目标对白 ID/文本/顺序与 matte 状态；场景遮幅/继承依赖目标 active 成员、相关场景模式及全部受影响图像。相关对白/成员变化必须拒绝旧准备结果；不把所有作品字段都塞进 read-set。捕获的工具参数是本次动作输入，用户随后改工具不修改它；明确取消选区动作则使 cancelGeneration 失效。
- **最新状态合入及历史次序**：准备完成仅排入串行提交事件；在同一提交临界区核对上述全部条件，用 drawing 结果对**此刻的最新 Project**构造纯 transaction 候选，保留期间提交的无关文字。候选/摘要计算不得先修改 History；期间不允许另一个作品提交插入。摘要等最后一个 await 后再次核对 incarnation、branch/cancel generation 及全部准入条件，最后无 await 地完成一次 history transaction 和快照发布，失败则丢弃候选而不弹/压历史。异步摘要占用提交序列直至完成，其排队延迟需测量；慢光栅准备不占用。先提交的文字先入历史，后完成的笔迹后入历史，各一次；Undo 先撤笔迹时保留文字。多图/overlay 全部条件满足才一次提交。
- **freeze 与失效**：准入 generation（停止新操作）、branchGeneration（历史导航）、operation cancelGeneration 分开。freeze 不撤销已开始操作的原 Session 结算资格；它等待这些操作按原依赖结算后再 capture。若基线/分支无效，保留新资产并报告 conflict/cancelled，作品与 History 不变；纯新增不可变资产失败不凭空变成未知原文件写入，只有实际 possible/confirmed 未结算效果触发相应保护。不自动重放，也不无声丢弃笔迹。若 Undo 先被接纳，旧笔迹必失效；若像素提交已先完成，随后 Undo 撤销该已完成动作。

### checkpoint / Save / freeze

- changed 后沿用 600ms debounce；同 Session 最多一个 checkpoint 在途，另保留一个最新目标。捕获不可变 manifest 和可达资产读租约后再 await；完成 r 只记录 r。若当前 r+1，继续 dirty 并安排下一轮，不倒写旧 head。普通调度失败停止自动热重试，保留资产和错误；下一次编辑或显式 checkpoint 可重试。
- 读租约覆盖捕获快照的全部 images（包括 retained images），历史引用另 pin；旧快照未完成前不能因新资产或缓存淘汰而丢可读性。只有明确字节已在验证过的持久存储，才可释放其 RAM 副本；无自动磁盘 GC。
- `loadCheckpoint` 的 readAsset 仅允许该快照引用集合；Session 注入的资产 Adapter 必须另索引新制作资产及 History/旧快照持有的 reader/持久位置，不能拿“最后一次 load 的 reader”读取所有资产。每个来源仍做绑定和哈希校验。
- 分开 `current Version`、`checkpoint receipt`、`output receipt`。内部 checkpoint 成功只代表可编辑内容保存；output receipt 还需 formats-save 返回每个 active shot 的内容/输出身份、命名/删除/脚本/来源义务已结算证据。输出没变化也必须检查外部文件身份，不能只用 revision 相等显示 synced。
- 首条 Save 请求与已有 producer 共用顺序：先等此前已接纳准备完成，再冻结一个目标版本、先 checkpoint 该版本，再执行输出并完成必要后置 manifest/输出账本 ACK。Save 在途仍可接受后续普通编辑，但输出相关 Pending/Import/第二条 Save 排队；相同在途 Save 请求复用原 Promise。r 成功而当前为 r+1，返回 r 的真实成功及 stillDirty，不给当前内容显示全部同步。
- checkpoint 与输出副作用串行，禁止嵌套等待同一独占队列。新编辑可先在内存排入更高 revision，但其 checkpoint 等待旧 Save 的必要尾部结算。部分输出成功后 checkpoint/来源备份/删除/脚本失败都不是完整 Save；保留原 root 的 receipt/义务，后续普通编辑不能清错误。
- `freeze` 先取消 debounce、提升准入 generation，再等待已接纳 producer、命令、checkpoint/Save 和状态发布全部结算，然后 flush 最新 checkpoint。冻结期间作品不接新编辑；不把“等待超时”当作已取消。返回的 capture 必须来自实时 Session，不缓存第一次结果。
- switch：先验证 B 的 root，冻结/认证 A；B 在私有 staging 严格 load 后单点发布，A 变 suspended。B 失败保持 A 的内容/身份与全部义务；若 A 健康且 Main 确认无未结算效果，可经 freezeId resume；否则只读保留。恢复 A 只切 UI selection，不创建第二套 Project。
- close/reload：registry 冻结所有 held/staging Session，Main 认证全体 caller/root/内容/资产，要求第二次 fresh capture 完全一致才允许实际关闭。健康且 checkpoint 完整可静默关闭，不强迫 TIFF Save；未知效果、保留意图、失败 staging 或缺资产必须继续走既有留存/拒绝协议。取消 Close 只恢复准入，不退休失败/解锁。

现有 `electron/core/persistence/errors.ts` 只返回 code/message，不能从 message 字符串解析 phase/effect；未扩展结构化结果前，store 的 I/O 失败一律保守按 possible 处理并重新验证 head，不宣称磁盘无变化。输出账本与 manifest 无现成跨文件原子提交：formats-save 必须提供 journal/读回认证，按下表区分正常版本落后和真实未结算/损坏；不得因未点击 Save 就永久 recovery-required。这是 G0 前提，不是已有实现。

### reopen 判定：checkpoint 与 lastCompletedOutput 独立验证（R1）

设 `H` 为严格校验成功的当前 checkpoint，`O` 为可为空的 lastCompletedOutput。O 必须记录 projectId、捕获 revision、snapshotDigest、受限相对 snapshot 引用、输出计划/实际身份和完成证据；校验对象是**O 当时捕获的不可变历史 snapshot**及其资产/计划，不要求 O 的 revision/digest 等于 H。当前 store 保留 versions，但尚未公开按版本读 Interface；需主管指定 Main Adapter 增加受绑定校验的读取能力，不在 UI 拼路径。重新打开时新 incarnation 不必等于 O 的历史来源会话；文件夹搬迁重新绑定 root，作品/历史 snapshot/输出关系仍须被验证。

以下各行以 H 健全为前提；H 或其资产不健全仍按原严格 load 规则拒绝。先核对 journal/账本完整性，再判断内容同步状态，不能只比较两个数字。

| reopen 情况 | 校验依据 | 会话及后续写入判定 |
| --- | --- | --- |
| 无输出的首次工程 | 有可验证的新建/输出初始化记录，明确 `lastCompletedOutput: null`、无未结算 journal/未知效果；未曾发起输出，或先前失败已有无效果/完整补偿的认证；导入来源不是一次 completed Save | healthy；从 H 可编辑，checkpoint 正常、输出为 never-output，允许首次显式 Save。失败记录仍保留，补偿不是成功 Save；不得把任意丢失账本都解释成“尚未输出” |
| 内部领先：H=r+1，O=r | O 与所捕获 r 的完整历史 snapshot/digest/输出完成证据有效，r<H.revision，且无未结算 journal；当前输出外部冲突另按末行处理 | **合法正常状态**，healthy、内部已保存、输出待同步；允许编辑/checkpoint/下一次 Save 和健康 Close。不能拿 H 的新 digest 否定 O，不要求把 H 回滚为 r |
| 输出完成且配对 | O 与其捕获 snapshot/计划配对成功；若 O.revision=H.revision，两个 snapshot digest 也必须一致；实际文件身份仍通过校验 | healthy；只对匹配的输出义务显示 synced。checkpoint 与完整输出状态仍分别记录；不能仅凭相同 revision 标全部完成 |
| effect 未结算 | 有已发起但未完成的 journal、部分输出/后置 ACK 缺失，或效果无法确证；即使可读取上一条 O 也不能抵消 | 保留全部证据及原 O，不颁新成功 ACK；进入 recovery-required/受保护只读，拒绝普通覆盖写入，按 Main 留存/显式受控修复协议处理；不自动重放或清 journal |
| 账本内容损坏/无法绑定 | 非法结构/hash、所指 snapshot 缺失或摘要不符、project/root 关联无法认证、O 超前于 H 且无可验证协议解释，或应有账本丢失而没有“从未输出”证据 | 这是完整性失败，保留 H、账本和资产；受保护只读并报告具体原因，拒绝不受控写入。不能用“内部领先”的规则掩盖坏账本 |
| O 内部有效，但输出文件在外部被改动/缺失 | 历史 snapshot 和完成记录成立，当前输出身份不同 | 单独报告 external-conflict/待 Import，不冒充账本损坏或已同步；按现行外部输入准入政策处置，禁止自动覆盖。内部可编辑快照仍保留 |

实现需保证首次工程的初始化状态可认证（不允许根据缺文件猜测 null），并保留 O 所引用的历史 snapshot/资产。后续每次 autosave 只推进 H，不重写 O 为当前 revision；只有一次输出的所有必要效果与尾部 ACK 确认后才能更新 O。O=r 的 journal 已完成证据与 H=r+1 可以并存，这是合法时序；未退休的未知效果或 cleanup 失败仍须独立报告，不能靠版本落后/同号来豁免。无输出与正常内部领先都不能单独造成 recovery latch。

## 4. 共享契约缺口：先补齐再切换相关入口

`storyboard` 和 persistence 都严格限定字段；直接给 ProjectV1 加属性会被拒绝，先扩类型、纯编辑器、校验/编码和往返测试，再连接 UI。不要临时双写旧 Project 或放 generic metadata bag。

| 缺口 | 建议归属与表示 | 所需命令 / 原调用方 |
| --- | --- | --- |
| project name 可读但无编辑命令；naming 三字段不存在 | Project 的显式 name/naming；文件名是输出派生，不用 shot.name 充当路径 | setProjectName/setNaming；projectEditController |
| matte、sourceHeight、系统图层角色缺失，不能 resize | Shot.presentation.matte 的明确模式/top/bottom/sourceHeight；Layer 增加 content/matte/dialogue role；尺寸随不可变像素结果原子更新 | setScenePresentation、受验证的整图 resize；现有场景遮幅/对白控制器，锁定系统层由该命令专用权限管理 |
| 对白跨镜头移动、Merge、批量层与整场效果无单事务 | `applyTransaction` 由 storyboard 统一验证暂存结果，最终发布一次；专门 moveDialogue 原语维护唯一 ID/顺序 | 源删+目标加、两侧对白 overlay 更新为同一次动作；层 merge 的 replace/remove/hide、场景多图 resize 同理 |
| Clear 的 cleared 标记、层 active ID、order 与 legacy 描述 | Clear 生产同尺寸透明 PNG，不新增持久 cleared；数组为唯一层序；active layer 存 ViewState | clearLayer/copy-paste/merge 产资产后一次提交；无自动从 TIFF fallback；缺资产明确失败 |
| pendingDeletedShots、pendingBake/source/fileName/flow status | Main 持久输出账本：shotId + 受验证的相对目标/来源身份、last-output 内容指纹、未结算删除/来源效果；与作品分工 | removeShots 可 Undo；Save 根据当前成员与最后输出基线生成计划，Undo 在 Save 前撤销删除义务；Save 后恢复为新输出，不假称从 Trash 取回 |
| 普通 Pending 的可见文件、外部编辑、restore 继承 | 保留现有外部可见 Pending 事务；新 Session 分开成员历史与 Main 输出 namespace，不能仅调用 moveShots | 专用 park/restore 命令；非空 peer 继承/空板保持的表现结果要准备完整后一次提交；失败留存交 formats-save |
| createdAt/updatedAt、Markdown mirror、可编辑输入状态 | 若保留时间则显式项目字段，不以时间作 revision；Markdown 仍是可编辑镜像，Main 记录外部基线；输入就绪/冲突存 session/输出账本 | 显式 script Import/图片 Import 准备完整后事务提交；外来项目未准备完成不得假装可编辑 |

`applyTransaction` 不是任意 replaceProject：只接受冻结的有类型命令/图像结果集，拒绝重复 ID、未知字段、越权锁操作，按暂存状态逐步验证，验证全部成功才 append 一条 history。中间 revision 不发布/不落盘；每个改变的 image 只增加一次 revision。`ChangeSet` 对 before/final 重算，不能简单 OR 中间变化把净 no-op 算成编辑。现有 `ProjectHistoryV1.apply` 可内部委托单元素事务；history 的可达资产枚举/淘汰通知由 storyboard 提供给 Session 内部，不能再偷偷维护第二栈。

**需要主管冻结的最小合同包**：作品字段与对应 strict validators；transaction 原语/History 资产保留；PixelAdmission 的完整目标基线、incarnation、取消/branch generation 与命令 read-set；Envelope 与 failure effect 分类；asset lease/pin；输出初始化/null、历史 snapshot 读取/保留及 lastCompletedOutput/journal 判定、Save/Close 认证收据。不得在本 lane 各造一份同名协议。账本的磁盘布局和后置 ACK 由 formats-save 提案决定，Session 不假定当前 checkpoint store 能保存账本。

## 5. 一条完整链与反例

1. 在新合成项目上 Main loadCheckpoint 校验全部引用；registry 给新 incarnation，Session 从 manifest revision r 建立 History。两个视图订阅同一快照。
2. SketchPad 原手势产一笔准备任务，资产 Module 保留新 PNG，drawing 根据完整 before 生成结果；Session 通过 storyboard transaction 提交 r+1，一条 Undo，释放临时预览但保留资产租约。
3. checkpoint r+1 成功；Undo 得 r+2 和旧 assetId，再 checkpoint。正常 Close 经全 slot 二次认证；新进程 reopen 读 r+2 的可编辑 PNG，不依赖 TIFF 或旧 RAM。跨重启 History 是否恢复见产品问题，不能把 versions 自动当 Undo。
4. 再画一笔并点 Save；等待此前 producer，checkpoint 目标 r+3；formats-save 校验来源/首次备份、两阶段命名、输出 TIFF/脚本/删除义务并完成后置 ACK。只有绑定 r+3 的完整收据可呈现该版本已同步；实际新核心 GUI 全链是未来验收。

| 具体反例 | 必须结果 |
| --- | --- |
| A→B→A 相同路径，A 的旧画笔或 checkpoint 回调晚到 | 旧 incarnation 不发布当前 UI；已开始效果仍由原 A 完成或保留失败，不能静默丢其字节 |
| r 的慢笔迹准备中穿插同镜头 scriptText 编辑，先提交 r+1 | image/关联/read-set 与 generations 不变，笔迹成功合入最新作品得 r+2；文字保留，两条独立历史。Undo 笔迹得新 revision，文字仍在；无关 project revision 增长不拒绝 |
| 开始慢像素准备后 Undo，再 Redo，完整图像甚至 image revision 都回到准备时值 | branchGeneration 已提升，旧结果必须拒绝并保留/报告；不因相等基线自动复活，History 不多出旧笔迹 |
| 准备期间锁定目标层，或先锁再解锁；另测同图重排/删层 | 锁策略/完整 image before 不符即拒绝；锁再解锁仍有不同 image revision，不绕过。既有锁定编辑保持，失败不新增 History |
| 普通笔迹准备时改无关镜头文字；另测对白 overlay 准备时改它消费的对白 | 前者允许；后者 read-set 变化整笔/整组拒绝，不发布过时 overlay。scriptText 不因为“都是文字”被错当对白 raster 依赖 |
| r checkpoint 在途时文字改为 r+1 | r 收据留下真实保存事实；r+1 仍待 checkpoint；旧回调不清最新 dirty/error |
| Save r 完成后仅 autosave 到 r+1，正常 Close/fresh reopen | 分别核对 O→历史 r、H→r+1；healthy 可编辑，内部已保存/输出待同步，下一次 Save 可正常推进；不得错误锁死 |
| 从未输出的初始化工程 reopen；另测篡改 O 的 digest/删掉它引用的 snapshot | 可认证 null 的首次工程健康；损坏对照进入受保护状态。缺账本不得伪装首次工程，不能静默用 H 替换 O 的历史依据 |
| 已产第 1 张遮幅 PNG，第 2 张失败 / 对白 move 目标冲突 | 作品及 History 无中间状态；暂存资产留存；不存在源对白已删目标未加的可见状态 |
| head rename 成功但目录 flush 失败 / TIFF 成功但账本 ACK 失败 | 不推进成功收据；标 possible/confirmed 效果并保护原会话。允许先重新校验同内容重试 checkpoint；不能假设旧 head 未变 |
| Save r 在途追加 r+1 stroke；或隐藏 A 的 Save 失败 | 只结算原版本/原 Session 的义务；B 和 r+1 不被清 dirty；Close 检查隐藏 A |
| switch/Close 在 PNG 准备或输出中开始，随后超时/取消 | 等待实际 settle 或保留窗口；不得释放 producer pin/转交 root；取消不移除 recovery latch |
| 缺失一个 retained image 资产 / strict load 失败 | load 拒绝；不拿 TIFF 合成预览冒充可编辑资产；staging 不切 active、不自动 repair |

## 6. 分阶段接入与归属

以下是待主管派发的任务，**本轮不实现**。S0 是所有并行工作的串行前提；未冻结共享文件前不能开始各自写运行时。

| 阶段 | 归属 / 可独立改动路径 | 前提与完成出口 |
| --- | --- | --- |
| S0 冻结 | 主管：`electron/shared/refactorV1.ts`、共享 session/输出/asset 契约、配置；指定核心补齐负责人 | 对第 4 节字段/事务及两 lane 输出达成一致；固定 command 与 effect/error/schema，确定产品问题。可先单独批准只支持当前 V1 的合成纵切，不接不支持功能 |
| S1 headless Session | session 实现 lane：`src/core/session/**` 及其中聚焦测试；storyboard 补齐负责人独占 `src/core/storyboard/**` | 基础 edit/undo/checkpoint 调度、延迟 ACK/ABA/freeze 用真实三核心组合通过；资产/output Adapter 由注入提供，缺少能力明确 unavailable |
| S2 真实 transport（G1 的接入准备） | 指定 runtime lane 独占 `electron/main/refactorSessionRuntime.ts` 及聚焦测试；主管独占 IPC 注册、preload 两份与 `global.d.ts` | drawing-assets 的真实 Adapter 及 checkpoint transport 就绪；同 root 绑定/调用方、资产读租约通过合成文件系统；输出账本可按 G3 顺序补齐。不得返回 renderer 自报 receipt |
| S3 最小 GUI / TIFF 两步纵切（G2→G3） | 主管/UI 接线 lane 独占 App、工作区 registry Adapter、相关 controller 切换；session lane 仅修 owned Module | G2：4 镜头+1 Pending、每图3层，中文脚本→排序→一笔→透明度→Undo两次/Redo两次→checkpoint→Close→新进程逐项精确 reopen。G3 等 formats-save/账本就绪后再合成 TIFF→画→Save→Undo→Save→reopen 并核首次备份。未支持功能明确关闭且报告，不做旧新双写 |
| S4 完整交互 | 主管分配不交叉的 views/controllers；Session 只扩已冻结命令 | 日式视图/对白拖动、完整层工具/场景、Add/Paste/Import/Pending/删除/Markdown 逐项验收后才取代旧入口；不能把 S3 称功能等价 |
| S5 删除与性能 | 主管主导调用方/失败路径审计与独立评审 | 下表删除证据齐全，完整允许测试/build、实际 GUI、真实平台与代表规模测量；未通过部分标 TODO: verify |

### 旧职责 → 新归属 → 切换 → 删除证据

| 旧职责 | 新归属 / 调用方切换 | 删除前证据 |
| --- | --- | --- |
| App/updateProject 和分散 dirty/autosave revision | Session transaction + receipts；project/dialogue/DND controllers 发命令 | 两视图无直接作品写入、无旧 ref 双写；no-op/拒绝/文本与像素各一次 History |
| projectHistoryController 的 PNG 恢复与 JSON 双栈 | storyboard 单历史 + immutable assets pin；Undo shortcuts 到 Session | 精确像素/选择恢复、分组/redo/淘汰、失败不弹栈；旧格式路径仍存在时保留旧恢复保护 |
| workspaceAutosaveController 的定时与 UI 保存状态 | Session scheduler；状态只订阅 receipts | 600ms 合并、在途新编辑、失败/重试、关闭 flush，旧 ACK 无错清 |
| workspaceSession/slots 的分散作用域和生命周期 | registry+Session freeze，Main 原认证职责延续 | A/B/ABA/别名/failed staging/隐藏 slot/Close/reload 全链；未知效果不误关闭 |
| normalSaveAppAdapter/owner 中模型编排 | Session；文件效果与恢复归 Main/formats-save | 实际 TIFF、来源首次备份/冲突、命名/Trash/Pending、后置失败有原效果证据；禁止直接整体删除 owner |
| Pending namespace 历史重定位和场景后补 | 专用命令+formats-save namespace 事务 | 保留可见 Pending/外部编辑政策；History 策略获决定，部分失败与空板继承有 GUI/文件证据 |

由主管对运行时代码和允许测试做显式调用搜索，证明无人使用后逐项移除；不能只看 import 数量或 wrapper 行数。失败/History/恢复文件不属于可删除代码，始终留存。

## 7. 验收标准（全部待运行）

- **聚焦公开 Interface**：edit/no-op/error、Undo/Redo 单调 revision、复合命令原子性/净 no-op/锁策略、对白 ID/顺序、双视图投影一致；stale before 与 ABA；资产被 current/history/inflight 持有，淘汰 RAM 后仍能读取；maxEntries 默认沿用当前 App 的 60，可配置但不宣称总内存有界。
- **R2 像素准入**：慢光栅准备与同镜头/其他镜头 scriptText 穿插都保留文字和笔迹；精确比较最终 PNG、项目历史顺序及一次 Undo 的范围。Undo→Redo 完整 ABA、显式 cancel、锁→解锁、图层结构变化均拒绝旧结果；同图连续两笔用前笔结果；依赖对白变化只使消费该对白的 overlay 结果失效。freeze 不误用 branchGeneration 取消已开始任务；所有失败保留应保留资产，不写虚假成功。
- **调度/生命周期**：虚拟时钟检查 600ms、最多一个 checkpoint+一个最新目标、Save 重复请求、r/r+1 receipt；freeze 后拒新准入但原 producer/尾部 ACK 必须完成；全部 hidden slots、失败 staging、别名、A→B→A、取消关闭、二次 capture 改动均覆盖。错误通知只属于目标 Session。
- **真实合成文件系统**：复用 `test/temporaryWorkspace.ts` 的允许方式；真实 PNG→drawing→storyboard/history→store→fresh load，再经 Main Adapter 组合；missing/hash/dimension、readonly/symlink/冲突、head 替换后 flush 失败和 output 尾部失败保留；无原图或 recovery 自动清除。注入故障和真实 OS 拒绝分别报告。
- **R1 reopen 矩阵**：逐行覆盖上表。特别实际落盘 O=r→autosave H=r+1→正常 Close→新进程 reopen，断言无需 Save 也不产生 recovery-required、能继续编辑/checkpoint/显式 Save；另测合法 null、相同版本配对、未知效果 journal、损坏/丢失账本、历史 snapshot 摘要不符和外部输出变化，不能只用内存 mock 把“输出落后”与“损坏”合并。
- **实际隔离 Electron GUI**：新建合成素材、隔离 userData；普通网格与日式视图完成文字/对白拖动、画笔/擦除/选区/Blur、层 merge/clear、场景遮幅/对白一次 Undo；Pending park/restore、Add/Paste、删除在 Save 前撤销及 Save 后行为、首次备份、外部冲突；画→切项目→返回→Undo→checkpoint→正常 Close→新进程可编辑 reopen→显式 Save。核对真实 PNG/输出身份、无旧会话通知和受保护近邻流程。只通过第一笔不能勾完整交互。
- **最终 gates**：主管协调重型测试窗口；最终记录候选 SHA，运行完整允许枚举 suite、`npm run build`（两端 typecheck）。如改 preload 跑 `npm run check:preload`，如改打包资源跑 `prepare:package-resources`；执行 smoke 前先读脚本并完成隔离。受禁测试始终不读/不哈希/不执行；不安装依赖来补环境。
- **验收限制**：Mac/Windows、安装包、崩溃/断电/目录 fsync、跨进程竞争分别取证；现有 store 进程内串行不等于跨进程安全。100/1000 镜头与实际尺寸的资产/History/在途内存峰值、冷/热 reopen 时延需测量；60 步和 8GiB recovery 磁盘预算都不是 RAM 上限。不以小 PNG、mock 或第一轮绿测证明这些能力。

## 8. 真正需要产品决定的问题

1. **正常关闭再打开是否保留用户 Undo 栈？** 当前可恢复 capture 持有 History，现有新 store 仅存作品版本，尚无用户 History 序列化协议。建议正常 reopen 保持可编辑作品、从空 Undo 栈开始；同进程切换仍保留最多 60 条，并完整保留受保护故障证据。若要求跨重启 Undo，必须另加可验证的 History manifest、引用保留/容量政策，不能直接遍历 versions。该决定冻结前不得宣称等价。
2. **Pending 的 park/restore 是否变成普通一次 Undo？** 当前 namespace 转移会 rebase 兼容历史，新核心 moveShots 默认能 Undo，二者有真实差异。建议本轮保留现有可见 Pending/文件移动及 namespace 历史政策；仅将像素/继承和模型发布原子化。若要普通 Undo 或改成 Save 才物化，需要明确新产品决定及双向文件补偿验收；未批准时不启用第一轮 moveShots 的直接 Pending Undo。

其余事项按现行规则执行，无需再问产品：普通健康 Close 静默保留编辑；显式 Save 才同步输出/首次备份；删除到系统 Trash；工具手感、普通 Pending、双视图保留；不恢复 AI/Alt-copy，不加 SQLite/PSD/cloud/旧项目迁移。技术选择（identity、队列、digest、资产 pin）由主管合同审查解决。
