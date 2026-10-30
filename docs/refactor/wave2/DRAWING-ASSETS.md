# Drawing / assets 接入设计

2026-10-30；源码基线 `10152aa520ab59fc9dc3cacd6db4d8267f69ae84`。
**本文件是待主管冻结的设计，未实现。** 本轮仅检查源码，不运行测试/build/GUI。
采用 codebase-design：UI 保留手势，像素制作与不可变资产入库分别藏在小 Interface 后；
项目发布、History、checkpoint/Close 调度仍只有 session 一个 owner。
波次一已有纯图像编辑、项目历史和 checkpoint 核心；其组合测试不是新核心接入 GUI 的证明。
已按主管补充只读核对原 main 的 `docs/refactor/wave2/COORDINATOR-GATES.md`（G0–G5）；
未合并其提交，第二轮 GUI 全部仍为 NOT_RUN。下述 session reader 与磁盘保留设计回应其资产审查项。

## 1. 已有能力与真实调用图

以下路径相对仓库根；以符号定位，避免把漂移行号当契约。

| 真实源码 / 调用方 | 已实现职责及本轮观察 | 接入约束 |
| --- | --- | --- |
| `App.tsx` 的 `useBitmapLayerPaintingController`、`paintBitmapStroke` → `ShotCard.tsx` / `JapaneseStoryboardView.tsx` 的 `handleSketchStroke` → `SketchPad.tsx` | 两视图使用同一绘画回调；App 注入旧 queue、effect completion、History、workspace admission | 替换共享回调的组合处；不在两个视图各建一套 Project/History |
| `src/renderer/SketchPad.tsx` 的 `beginStroke`、`extendBitmapStroke`、`commitStroke` | pointer capture、全局收尾、coalesced events、点距、坐标换算、ref/RAF、即时 dot、pending preview；橡皮 live canvas 可直接提交 PNG，画笔通常提交 stroke | 手势和预览留在此处；不能仅重放最终折线就声称橡皮预览一致；pointercancel 当前走收尾，先保持 |
| `sketchRendering.ts` 的 `drawStrokePathOnCanvas` / `fillImageDataAtPoint` | Canvas2D 圆头/圆角、opacity、size×softness 的 shadowBlur；橡皮 destination-out；填充为相邻同 RGBA 精确洪泛 | 首轮复用这些算法；不换画笔引擎或引入平滑、压力/颜色容差新策略 |
| `bitmapLayerCanvas.ts` | DOM canvas 制作 PNG；fill；blur 半径取整到 0–50，0 无操作；选区 clip 后 clear 再画模糊层；matte expand/crop、75px overlay、对白单行省略 | 抽出像素函数时去掉旧 Shot/bitmapPath 依赖；无 context/解码失败应显式失败，不能把旧 source URL 当已编辑成功 |
| `bitmapLayerPaintingController.ts` 的 `enqueuePainting` / 四个 handle | 每 bitmapPath 串行；旧 PNG 一次读取复用于历史/源；write 完成后 dirty/history/project；跨 scope 的已写 effect 仍需完成原归属 | 当前会覆写可变 PNG；新链不调用旧 writeLayerPng 再写一份资产。旧 sourceDataUrl fallback 仅是旧路径行为，新格式缺资产拒绝，不以 preview 猜作品 |
| `SketchPad.tsx` 的 `prepareTransformPreview` / `drawPreparedTransformPreview` / `commitSelectionTransform` | 源 canvas+选区 patch+preview，移动/缩放/旋转；提交后保留临时选区 | 后续抽出像素运算，hit test/选择框留 renderer；当前预览函数会 toDataURL，抽取时只在提交编码 |
| `bitmapLayerActions.ts`、`LayerPanel.tsx`、`src/shared/projectOps.ts` | Add/create-only、Clear、Delete、Merge down/selected/visible、opacity/locks/order；merge visible 保留并隐藏 locked 源 | 单个动作一次项目 History；Clear 变透明 PNG；删除仅移 descriptor，源像素留存。matte/dialogue 的锁定顶层排序必须保留 |
| `shotPresentationController.ts` → `bitmapLayerCanvas.ts`、`projectOps.ts` | 全场 matte/对白覆盖层，resize/多资产事务、失败补偿；Pending 不直接跟随场景按钮 | 需新尺寸/系统层字段和原子复合命令；不能拼多个 applyImageEdit 形成半场成功 |
| `bitmapLayerWriteQueue.ts`、`projectHistoryController.ts`、`bitmapLayerHistory.ts` | per-path queue+exclusive；旧 History 含 Project/selection/PNG data URLs；Undo 写回资产，失败反向补偿且保留未知效果 | 新路径用 immutable 引用切换消除像素覆盖补偿；旧路径未切完前原保护不能删 |
| `electron/main/ipc/layerHandlers.ts` → `layerAppRuntime.ts` → `layerAssetService.ts` / `bitmapLayers.ts` | read/write/create/delete/merge；受控内存、路径与 producer/effect 保护；sharp 合成与旧文件清源 | 这是生产可变层链，不能当新 checkpoint asset depot；新资产禁止从这里 unlink 历史源 |
| `src/core/drawing/index.ts` 的 `applyImageEdit` | 已有同步纯规则：层结构/锁定/引用/revision/visualChanged；不生成 PNG、不读文件 | replacePixels 只校验 assetId 形状；不是字节存在或准入凭据 |
| `src/core/storyboard/index.ts` 的 `createProjectHistory` | 已有项目级 undo/redo、maxEntries；快照保存引用，Undo 给新 project revision | 无 PNG owner、无历史资产枚举/持久化 Interface；image revision 可回到旧值，不能单靠它防 ABA |
| `electron/core/persistence/assets.ts` / `checkpoint.ts` | 已有 SHA-256/PNG 全解码及尺寸校验、immutable blob/version/head 顺序、真实目录检查；全部 images 都是 required（含无 shot 引用者） | save 每次会取所有 required bytes；load 先查文件存在/大小，返回 reader 才按读取校验 hash。reader 仅允许该快照资产；不得宣称 load 已完整解码所有像素 |
| `src/core/integration.test.ts` | 4×3 合成 PNG 的 edit/history/checkpoint/reload、搬目录/Pending、缺资产和 stale 分支组合 | 使用内存 Map 提供新旧字节；未解决生产像素制作/长期保留/真实手势；本轮未执行 |

现有显示通过 `SketchPad`/`ShotStaticMedia` 等与 `storyboardMediaWindow.tsx` 的 Warm/Hot 窗口，
层请求经 `appProtocolRuntime.ts`。新格式仍需独立按 session+assetId 授权的 URL 解析，
不能把旧路径协议直接指向任意 checkpoint 文件。naming 以 `docs/architecture/NAMING.md` 为准。

## 2. 提议的 Module 与 Interface

### 2.1 FlowPixels：只制作像素

保留纯 `applyImageEdit`。新增 renderer Canvas2D Adapter，私有复用/迁移现有像素算法，
不把 DOM/sharp/IPC 引入 `src/core/drawing/index.ts`。外部只有一个制作入口：

```ts
type FlowStroke = { tool: 'brush' | 'eraser'; points: readonly number[];
  color: string; size: number; opacity: number; softness: number };
type FlowPixelInput = { image: ImageDocumentV1; layerId: string;
  operation: { kind: 'stroke'; stroke: FlowStroke } |
    { kind: 'prepared'; png: Uint8Array; sourceAssetId: AssetIdV1 } };
type FlowPixelOutput = { png: Uint8Array; width: number; height: number };
type FlowPixelResult<T> = { ok: true; value: T } | { ok: false;
  error: { code: CoreErrorCodeV1 | 'resource-limit' | 'unavailable'; message: string } };
type FlowPixels = {
  produce(input: FlowPixelInput, readAsset: AssetReaderV1):
    Promise<FlowPixelResult<FlowPixelOutput>>;
};
```

以上是最小一笔草案，`prepared` 仅接纳已绑定基线的橡皮 live canvas；不接受任意 UI 宣称的 layer 路径。
复制 image/operation/points/输入 bytes 于首次 await 前，回传独占 bytes；read 返回副本或有明确独占移交。
先验目标可见、未锁定且存在，再解码和计算；commit 时 session 再验同一目标。
读取错误/解码失败/Canvas 不可用 → failure，无空白 fallback、无 History。
同像素的可证明 no-op 可直接复用旧编码 bytes；PNG 身份始终是编码字节 SHA，不承诺跨平台编码一致。
后续 operation 分别扩充 fill/blur/transform/clear/merge/overlays，禁止现在暴露通用脚本执行入口。
merge/resize 另输出多个新 layer 结果，由一个复合项目命令安装；不是在这里维护第二套历史。

### 2.2 FlowAssets：Main 所有的不可变 PNG 准入和读取

**必要前置扩展，不是已有能力。** 由主管分派 persistence owner 复用现有 `storeAsset` 的
验证/独占发布/路径绑定实现，提供独立资产准入；不能为每一笔伪造一个临时 Project 或提前推进 head。
Module 的 Interface 绑定主管创建的 opaque session handle（Main 内部持有 canonical root）：

```ts
type FlowAssetReceipt = { sessionId: string; operationId: string;
  assetId: AssetIdV1; width: number; height: number; byteLength: number };
type FlowAssetError = { code: CoreErrorCodeV1 | 'resource-limit' | 'unavailable';
  message: string; effect: 'none' | 'blob-retained' | 'unknown'; operationId: string };
type FlowAssetResult<T> = { ok: true; value: T } | { ok: false; error: FlowAssetError };
type FlowAssets = {
  put(input: { operationId: string; png: Uint8Array; width: number; height: number }):
    Promise<FlowAssetResult<FlowAssetReceipt>>;
  read(id: AssetIdV1, operationId: string): Promise<FlowAssetResult<Uint8Array>>;
};
```

Session adapter 绑定 capture/producer 的 operationId，将 `read` failure 转为拒绝的
`AssetReaderV1` Promise，供现有 store 调用。Main 在首次 await 前复制 put bytes；read 返回副本。
Main 计算 hash，不信 renderer 提供的哈希；全解码、核尺寸和已有同名 blob；不重新编码、不覆盖冲突 blob。
put 不写 Project/head/TIFF/root source，成功仅证明对应 PNG 入库及其平台 flush 成功。
必须补齐或验证资产目录 flush（现 `storeAsset` 发布后未单独 sync assets 目录），不从注释推导断电保证。
并发 put/checkpoint 共用 root 串行准入和同一写入原语，避免两套 writer 语义。

Main 读取白名单为“此 session 初始 loaded 引用 + 已成功 put 的引用”；在 session 内保留此集合，
所以新 head、Undo、Redo 清空或 maxEntries 裁剪都不会让旧 reader 丢失资格。允许本 session 的
checkpoint/Save capture 继续读取，直到所有持有者 settle；相同 root 重开必须是新 sessionId。
失败且可能入库的 blob 保留，但不凭失败回执授权 Project 安装。重复 operationId 同内容返回原回执，
不同内容 conflict；put 回执须由 Main/session 账本验证，renderer 伪造对象不构成权限。
没有 delete/releaseBlob/磁盘 GC Interface；put 成功而发布失败留下孤立 PNG，保留并记录原因。
未来若加 GC，必须同时追踪 current、undo、redo、正在制作/保存 capture、versions/recovery，单独审批。

### 2.3 主管需要冻结的共享改动（本轮未修改）

| 契约 | 必要内容 / owner |
| --- | --- |
| session command + receipt | sessionId/incarnation、operationId/调度次序、History 控制与取消 generation、目标 shot/image/layer、完整 before image、sourceAssetId 与操作实际读取的作品依赖；按 §3.1 准入并在最新 Project 上一次 history.apply 原子发布。project revision 只用于版本/回执，不作为一切异步像素结果的全局相等门槛。session owner 冻结精确类型 |
| 资产准入 | 上述 scoped put/read、错误 effect、存储/内存预算准入、opaque session 与源绑定；persistence owner 实现，主管持有共享类型 |
| 完整作品模型 | 明确 matte mode/sourceHeight/barHeight、overlay role/顺序、尺寸替换、图层组移动/opacity/merge 的复合编辑。不能仅用保留层名字猜 role；锁定系统层的授权命令与普通编辑分开 |
| UI 瞬态 | activeLayerId、选区、brush settings 保持视图/session 状态，不写 Project 的任意 metadata bag；切层后选区以 session+shot+layer+asset 基线失效 |
| 导出快照 | formats 只拿冻结 Project+scoped reader/所需资产集合；不从屏幕 preview 或任意最新路径读取。输出版本与 checkpoint 回执分开 |

## 3. 顺序、保留、内存和失败语义

**建议先全 session 串行提交像素动作**，UI 预览持续即时响应。每层命令到达时保存操作数据，
执行到队首再读取上一次提交的完整 image；快速两笔不都基于旧 PNG。Undo/Redo、锁定、删除、
Merge、resize、成员变化与 Save capture 进入同一有序调度；异步像素计算不持有 React state owner。
无关纯文字命令可在像素制作等待期间同步发布；其 project revision 变化不能单独使该笔失败。

### 3.1 准入键与安装次序（R2 明确化）

建议的键由以下事实共同组成；名称是设计说明，精确类型由主管统一：

1. **归属**：sessionId + incarnation。目录/projectId 相同或从 A 切回 A 都不代表原会话仍存在。
2. **操作资格**：operationId + 有序调度位置 + 未取消的 producer generation + History 控制 generation。
   generation 不是 React render 次数、project revision 或任何普通文字命令的计数。
3. **目标基线**：shot 仍属于捕获的允许成员集合、shot→imageId 映射未变；目标完整 ImageDocument
   与制作时的 before 深度相等（含层数组、顺序、尺寸、属性、锁与所有 assetId），目标层仍可编辑，
   sourceAssetId 一致。image revision 相等只是其中一项，不能替代内容校验。
4. **实际读取依赖**：只比较此操作真正用于制作/政策判断的其他作品数据。普通 brush/eraser 不读
   scriptText/dialogue，故无关文字改动不冲突；对白 overlay 的生成确实读了台词、排版与 matte 参数，
   这些变化必须拒绝旧结果或重新制作。merge 读的全部源层、resize 读的画布/系统层设置也必须列入。

手势开始时保存归属与 generation，入队时检查其仍有效并登记 operationId/次序；FIFO 到队首后，
在同一资格下捕获完整制作基线与依赖，再制作/入库；安装前重新校验所有事实，并验证资产回执。
**不要求当前 project revision 等于制作开始时的 project revision。** 校验成功后，以最新 Project
作为 `history.apply(applyImageEdit)` 的 before，只替换核验过的 image，保留其余最新内容；
该次发布基于最新 project revision 增加一次，不能安装 producer 缓存的整份旧 Project。
例如 R10 开始画笔，文字先发布 R11，画笔应在 R11 上发布 R12；Undo 画笔得到保留新文字的 R13，
再 Undo 文字才恢复旧文字。若文字动作还会刷新依赖的 overlay，它须作为复合图像动作进入调度，
不能伪装成“无关纯文字”旁路修改 image。

**History 次序**：默认 Undo/Redo 不越过已准入 producer，在其安装或明确失败 settle 后执行；
若一笔已安装，随后 Undo 就撤销该笔。Undo/Redo 真正执行、History 重置/替换时推进控制 generation，
不因最终 image 内容恰好恢复而回退。普通文字 apply（包括按现有规则清空 redo）不单独推进该控制
generation，否则仍会把无关文字误当取消。来自较早 Undo/Redo 世代的手势/prepared 不能在新分支迟到安装。
显式取消可立即推进对应 producer generation、撤销其安装资格，但所有已开始入库仍等待 settle，
blob 与失败证据保留；不能靠超时或 generation 变化宣称磁盘写入已取消。

| 反例 / 并发操作 | 必须得到的结果 |
| --- | --- |
| 普通一笔制作期间改另一镜头脚本，或改本镜头但画笔不读取的文字 | 不按 project revision 拒绝；安装到含新文字的最新 Project，一次画笔 History；Undo 画笔保留文字 |
| 同图连续 S1、S2 均在旧画面上预览，S1 编码较慢 | S2 在 S1 安装后取最新完整 image 制作；S1/S2 均保留且顺序一致，不在旧源上分别制作再覆盖。S1 失败须明确反馈，后续仅可按其实际当前基线执行 |
| prepared 橡皮来自 S1 前的 live canvas，轮到它时 S1 已提交 | prepared 的完整基线/次序不符，绝不直接安装；仍有原操作且控制 generation 未变时可明确重放于最新源，生成新的 prepared/回执，否则 conflict。不得只用相同 image revision 放行 |
| 持有旧 prepared，Undo→Redo 后像素及 image revision 都恢复原值；或 Undo 后改另一分支再回到同内容 | History 控制 generation 不同，旧 prepared 被拒绝；不能因深度相等或 assetId 相同恢复已失效资格。需要新用户操作，不能跨此 fence 自动重放 |
| lock→unlock、delete→同 ID 重建、resize→原尺寸，最终表面上与旧基线相同 | 正常动作 FIFO，不能插入当前 producer 中途；在此前已捕获的迟到手势须因目标失效 generation 拒绝。锁/删除/resize 执行时推进受影响目标的 producer generation，即便状态后来恢复也不退回 |
| 外部接入或复合命令改变目标完整 image / shot 映射 / 成员身份 | 即使 project/image revision 数字意外相同也拒绝；已入库 blob 保留，不记 History、不覆盖最新 Project。受控实现本应避免这种旁路，仍须防御验证 |
| 对白 overlay 制作时改了参与排版的台词；普通画笔制作时只改无关台词 | 前者依赖失配，重新制作/拒绝；后者继续安装。不能用“所有文字都并行”或“所有 revision 都冲突”替代依赖判断 |

同图笔迹的 producer generation 不随每次正常 S1/S2 安装递增；它记录失效/取消事件。
旧 UI 若预先捕获目标，入队时也要检查其 generation；不能到队首才换成新 generation 并让旧手势复活。
以 stroke 意图重取前序像素的资格与使用 prepared 整层 PNG 的资格必须区分：前者仅在原会话、同目标
且无控制/目标失效 fence 时按 FIFO 重算，后者要求制作时完整基线与次序吻合。

| 状态 | 拥有者 / 失败结果 |
| --- | --- |
| preview / queued | renderer 持有临时预览与操作，session 记录未完成 producer；尚未改作品。预算不足拒绝新动作并告知未提交，保留当前作品 |
| producing | 读 immutable 源，一次制作，限制解码/编码并发；失败不写 History、revision/head 不变 |
| admitting | Main 正在验证/入库；Close/switch 必须等待 settle，超时不是取消；失败记录 none/blob-retained/unknown，不能报“已保存” |
| ready → installed | 按 §3.1 重查归属、调度/generation、完整目标与实际依赖及 receipt；在最新 Project 上同步 history.apply 成功才发布，实际 changed 时 image/project 各增一次，no-op 均不增且不记历史；无关文字不拒绝，失败只保留 blob，不覆盖旧作品 |
| installed, checkpoint pending/failed | 新 Project 与引用仍是当前作品；checkpoint 失败不撤销用户笔迹，保留未持久状态、阻止健康 Close，允许明确重试 |
| checkpointed | 仅捕获 revision 已完成内部保存；旧 ACK 不清新 revision，TIFF 仍可能待输出 |

内存不靠“引用保留 = 常驻所有 PNG”。资产先入库再进 History，历史只留 descriptor；
对每次读/解码/Canvas/编码/IPC 副本与 sharp native workspace 预留预算，Main 沿用受控内存准入，
不能以 512MiB 单 PNG 协议上限当 RAM 安全值，也不能以 8GiB recovery 磁盘预算当 RAM 上限。
建议初始 renderer 可控 raster+encoded 工作集 256MiB、可丢弃 decoded/URL cache 64MiB（均为待测配置），
全 session 一次重型像素任务；4WH 只算一张 RGBA surface，blur 至少两张、选区至少源/patch/preview，
加上输入/输出、IPC 副本、填充 visited/栈，必须逐项收费。浏览器/GPU/GC/native 峰值不能声称由这些计数硬封顶。
队列也须按操作/points/已准备 PNG 字节收费并设上限，不能把无限排队换成隐藏内存增长；准入后预览绑定
operationId 保留至安装或明确失败。未准入/失败需显示未提交状态，不能仅移除预览造成无提示的笔迹消失。
超过可预估预算时先淘汰无使用者缓存，再拒绝新任务，不缩图、不丢历史；原支持尺寸若被拒绝须作为行为限制报告。
流式/worker/tiles 是后续测量驱动优化，不在最小路线新装引擎。

显示缓存 key 为 sessionId+assetId+渲染参数；metadata/排序不重解码无关 PNG，opacity/blend/order
更新合成而非单层像素 cache。维持 Warm base-first/Hot 编辑器及交互 pin；只缓存有限工作集。
URL/ImageBitmap/Canvas 在最后显示使用者离开且无 producer 使用后撤销/close/清尺寸；禁止因 cache eviction
unlink 资产。全场操作分批制作入库，不常驻全场 raster，最后一次复合命令原子安装；失败保留当前场景及孤立 blobs。
磁盘空间/保留预算另由主管统一准入，无资金拒绝新写入，不自动清理 History/恢复/版本文件。

## 4. 一笔 → Undo → checkpoint → 重开 → Save

1. 主管最小接线只使用全新合成项目，先把初始 image PNG 入库并 checkpoint；在当前 UI 挂载一个
   scoped drawing adapter，Project 的唯一写入口为 session。旧 Project 若需渲染只做只读投影，不双写。
2. `SketchPad.commitStroke` 将原 stroke/橡皮已准备像素交给 adapter；手势、即时 preview 不动。
   adapter 按 §3.1 绑定 session/operation/控制与目标 generation，队首再捕获完整制作基线；
   橡皮 prepared 基线失配时不得直接安装旧像素，仅无失效 fence 且仍有原 stroke 时可重算，
   否则 conflict 并保留错误证据。不能把 pending brush 再重复叠进制作结果。
3. FlowPixels 读源制作 → FlowAssets.put → `applyImageEdit(replacePixels)` → session 的
   `history.apply(applyImageEdit)`。按 §3.1 校验后在最新 Project 发布一次，保留制作期间的无关文字；返回受 scope 限制的显示源，
   不再返回用于反复持有的永久 data URL。旧 `onStroke: Promise<string|undefined>` 回调须由主管统一改型。
4. session 捕获 revision R 调 store.saveCheckpoint(root, frozenProject, scopedReader)。
   仍按现契约校验全部 required images；不能为了快跳过 retained images。Undo 等待该笔安装后执行，
   只换引用，project revision 变 R+1；Redo 可恢复新 asset，不重写旧 blob。再 checkpoint R+1。
5. Close 等所有 producer/capture settle 并完成健康 checkpoint，销毁瞬态 cache；新进程 strict load
   +绑定 reader，实际读 PNG 核 hash/解码后显示和继续编辑。Undo 栈是否恢复由 §8 决定，versions 不等于 Undo。
6. 显式 Save 捕获最终 revision S 与资产引用，formats 读取同一批 immutable PNG 输出真实 TIFF，
   经过 formats-save 规定的源身份、首次备份、命名/删除/权限和最终回执，才报告 S 已输出。
   Save 期间新笔产生 S+1 时，S 的成功不能标记 S+1 已同步；仅内部 checkpoint 不碰 root 图片。

具体反例：A→B→A 重开同 root 后旧 A 的 put/编码完成，不得污染新 A；入库后目标层被删除/锁定、
或 Undo 分支改变，只保留 orphan blob，不加 History；head 替换后 directory flush 失败按现 store 返回失败，
即使磁盘可能已有新 head 也不制造成功 ACK；旧 checkpoint reader 拒绝“更新后独有的 asset”，
必须使用 session reader，不能 catch 后退回空白；Save 正在读旧 asset 时 cache 驱逐/Redo 清空不影响其可读性。

## 5. 实施归属与分阶段任务（全部待下发）

以下是建议任务划分，**不扩大本轮两个文档的所有权**。不共享编辑文件后才可并行。

| 阶段 | 可交付任务与建议独占路径 | 顺序前置 / 退出证据 |
| --- | --- | --- |
| D0 主管冻结 | `electron/shared/refactorV1.ts` 或独立 wave2 类型、完整作品字段、session/asset receipt、预算/Close、preload 协议 | 先协调 session 与 formats-save；尤其 put 权限和输出 capture，不由 lane 各造 sessionId |
| D1 资产准入 | persistence owner：`electron/core/persistence/**` 的 scoped put/read + 原语复用/目录 flush/真实 FS 测试 | D0；put 不发布 head、不覆盖、跨实例串行，失败效果留证，snapshot reader 限制用例通过 |
| D2 像素制作 | drawing owner：新增 `src/renderer/drawing/**`，必要纯规则 `src/core/drawing/**`；小合成像素回归 | D0；D1 未合入时可注入 reader 制作，不能伪称入库链已通过；先 brush/eraser，后 fill/blur/selection |
| D3 最小接线 | 主管独占 `App.tsx`、`SketchPad.tsx`、`ShotCard.tsx`、`JapaneseStoryboardView.tsx`、Main/协议及三份 preload 声明；session owner 保 session 私有目录 | D1+D2+session 可用后顺序进行；完成 G2 指定流程；两个视图共享状态，未接入工具/完整日式交互仍 NOT_RUN |
| D4 功能等价 | 主管将 `bitmapLayerActions.ts`、`shotPresentationController.ts` 等逐个指定单 owner；drawing 新目录实现 merge/overlay 等像素制作 | 完整字段+复合命令先落地；fill/blur/transform/merge/matte/对白/剪贴板/Pending 同一 History，失败原子安装 |
| D5 Save/性能/退役 | formats owner TIFF/来源保护；主管最终切换调用和删除；drawing 配合显示 cache 测量 | 真 Save+重开及失败矩阵通过，再运行完整允许套件/build、独立审查；100/1000 镜头、Mac/Windows 各自取证 |

D2 抽取算法时旧文件由主管在单独切换提交移除/重导入，避免两队同时改 `sketchRendering.ts` 等共享入口。
保留旧运行时直到当前调用者全部有替代证据，不维护旧/新两套可写作品作长久过渡。
与主管门槛对应：D0→G0；D1/D2+session 的真实无 GUI 组合→G1；D3→G2；
TIFF 完整闭环→G3，必须单独达标；D4/删除→G4；规模和平台→G5。D2 制作成功不能越过 G1/G2。

## 6. 旧职责 → 新 owner → 切换与删除证据

| 旧职责 | 新归属 / 实际切换点 | 允许删除的证据 |
| --- | --- | --- |
| painting controller 的 read/write/history/dirty 编排 | session + FlowPixels + FlowAssets；App 共享绘画回调 | 两视图、快捷键/Blur/Fill/Select 调用全部切换，无旧 writer 调用；真实延迟/失败/Close 通过，再删旧 controller |
| bitmapLayerCanvas 的 brush/fill/blur/overlay 制作 | renderer drawing Canvas2D Adapter；各工具制作入口 | 合成像素与真实 Electron 对照、半透明/边界无退化；最后调用迁走才删对应函数 |
| SketchPad 源/patch/preview 像素逻辑 | drawing 私有 selection/live eraser 实现；手势仍 SketchPad | 缩放/旋转/橡皮预览与提交一致、125%/200% 命中；无每帧编码，再移除原实现 |
| mutable PNG History snapshot/restore/compensate | storyboard 引用快照 + session 读取资格；projectHistoryController 切换 | Undo/Redo 后 cache 驱逐、重 head、分支与 Save capture 都能读旧 bytes；旧消费者为零才删 PNG 回写链 |
| per-path queue/exclusive | session ordered producers/capture | 快速两笔、Undo/Save/Close/批量互斥和所有 effects settle 证据；旧 Import/Pending 等仍用 queue 时不得删 |
| layer create/delete/merge 源清理 | descriptor 原子编辑 + immutable blob 保留；Main scoped put/read | 所有 layer IPC callers/preload handlers 退役后才删除这些入口；TIFF/Import 仍用的受保护写入器不随之删除 |
| 旧显示 URL + per-shot revision | scoped asset URL +有限缓存，composite 以有序 descriptor 为 key | Static/Hot/Timeline/Onion Skin/LayerPanel 无旧 bitmapPath 依赖；跨 session URL 拒绝与最后使用者释放验证 |

删除门槛是调用方搜索、替代行为/反例与真实连接证据同时成立；长文件、旧名称或绿单测均不足以授权删除保护。

## 7. 验收标准

本节全部 **TODO: verify**；当前只有源码核对。每轮记录精确实现 SHA、命令/exit、原始日志、
合成数据尺寸、平台/内存峰值、失败留存和资源释放；自测、主管独立验收、发布分开。

- 像素 Interface：单点/连续 stroke、opacity/softness、橡皮部分 alpha、两笔无重复；fill 精确 RGBA、blur 0/1/50 和 clip 清除；selection move/scale/rotate；透明 Clear；层顺序/opacity/multiply/screen、merge locked 保留；matte resize/反向 crop、对白中日英省略。精确像素或注明合理容差；fake canvas 调用断言不算像素等价。
- 资产真实临时 FS：错误 hash/尺寸/截断 PNG、已存在坏 blob 不覆盖、只读/无空间/符号链接拒绝；同 operation 重试/不同内容冲突、入库后安装失败 orphan 保留；并发 put/checkpoint、目录 flush 失败；不读个人目录。
- session/History：逐项覆盖 §3.1 反例，尤其 R10 画笔/R11 文字→R12 画笔→R13 Undo 保留新文字；同图两笔、prepared 橡皮旧源、Undo/Redo ABA、锁定/删除/resize 后恢复同状态、真实 overlay 文字依赖。还须验证 cache 淘汰后 Undo/Redo、旧 loaded reader 的白名单限制、新 session reader 读取本会话新旧 asset；Redo 清空不影响保存中的 frozen capture；metadata 修改不被旧 image edit 覆盖。
- checkpoint：真实 public Interface 制作 PNG→入库→安装→保存→Undo→保存→新进程重开→继续画；逐字节核旧/新 PNG，Project 字段和两视图内容保持。缺资产/flush 失败不推进已确认 revision、不发健康 Close。
- G2 固定合成工程：4 个活动镜头+1 个 Pending，每图 3 层；中文脚本→排序→一笔→透明度→Undo 两次→Redo 两次→checkpoint→正常关闭→新进程重开，精确比较文字/顺序/图层/PNG。只验证已接入工具，不能以此宣布完整绘图或日式视图验收。
- 实际隔离 Electron：保留 pointer/RAF/即时 dot/橡皮/长按/拖出画布/快捷键手感；真实 preload/Main，Save 更新合成 root TIFF且首次备份准确，autosave 不写 root；绘制期间 switch/Close 和失败提示；两视图、图层抽屉/锁定/选择/滚动 pin、Pending 附近链验证。需先审 smoke 脚本、仅 test-owned userData/合成媒体，未获范围不得触及真实 Trash/clipboard。
- 性能：1920×1080 及 4K、1/3/8 layers、100/1000 shots，记录首点/提交/Undo 延时、峰值 RSS/external/JS heap、缓存与 Canvas 数；长时间编辑/切换后 cache 回落且历史资产可读。对比同机器旧路径，未测不承诺速度或全尺寸支持。
- 实施最终门槛：focused 回归、完整允许枚举套件、`npm run build`（renderer+Electron 两个 typecheck）；preload 改动运行 `check:preload`，资源打包改动按规则运行资源检查；无依赖安装。禁止 fixture 始终排除，单测或 typecheck 不替代 GUI。Mac 本机结果不代表 Windows、安装器、断电/crash 或跨进程竞争保证。

## 8. 真正需要产品决定的问题

**重开后是否仍须用户 Undo 之前会话的编辑？** 推荐第一条最小接线路线先维持波次一的会话内
`maxEntries` 历史（当前 `App.tsx` 的 `maxUndoHistory = 60`，不静默改小），重开只恢复最新可编辑作品；所有磁盘版本/PNG
继续保留，明确不把它们称作可操作 Undo。若要求跨会话 Undo，必须在接线前新增 history manifest、
原子写入/重开校验及版本/预算策略；不能只序列化当前 Project。主管应先核对旧 UI 是否已承诺跨会话历史，
若已有承诺就必须保留，无需再次让用户选择缩水方案。

PNG 不可变全层、暂不 GC 是此轮推荐的技术路线；若代表尺寸/历史负载无法在既有资源政策下通过，
主管应带真实测量再请用户决定持久历史容量或另行批准 tile 等存储方案。缓存阈值、reader 资格、
锁定/系统层/复合命令不是新的产品选项，按既有交互与数据保护冻结。普通 Pending 的文件行为由
formats-save 统一提问，本 lane 不另提延后物化或改变用户可见文件的方案。
