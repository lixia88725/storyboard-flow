# 第二轮实现第一批：真实资产 + 像素制作 + 会话组合

2026-10-30 用户已批准开工。共享类型唯一来源 `electron/shared/flowWave2.ts`；本文约束该文件的
顺序、错误与测试语义，优先于三份设计提案的未冻结草案。主管留 main；三个会话独占下列范围。
只服务合成新格式工程，先完成 G1，为 G2 做准备；本批不宣称完整重构或实际 UI 已接入。

## 归属和入口

| 会话 | 可编辑实现 | 必须导出 |
| --- | --- | --- |
| Session | src/core/session/** | index.ts: createFlowSession(options: FlowSessionOptions): FlowResult<FlowSession> |
| Drawing Assets | src/renderer/drawing/** | index.ts: createFlowPixels(limits: FlowPixelLimits): FlowPixels |
| Formats Save（本批调任资产存储） | electron/core/persistence/**、electron/core/platform/** | depot.ts: openFlowAssetDepot(options: FlowAssetDepotOptions): Promise<FlowResult<FlowAssetDepot>> |

各自可维护 TASK.md、DELIVERY.md；不要合入主线的同名文件。共享类型、配置、既有renderer控制器、
App、SketchPad、Main/preload、旧模块删除由主管独占。本批不改 refactorV1、storyboard 核心，
不实现 TIFF/输出账本、复合场景命令、持久Undo、Pending文件流程或跨平台新策略。
发现类型不够向主管报告，不另造并行协议。只允许新增模块及必要持久化原语复用，保留既有断言。

## 所有模块共同语义

输入在首个 await 前复制/验证，返回的可变 bytes/对象不与内部状态共享。非法值不能静默钳制。
失败用 FlowFailure；effect=none 是没有该操作的新文件效果，retained 是已知保留的不可变 blob，
unknown 是效果无法确认；不因失败就删除旧资产、不 chmod、不造成功回执。不承诺 hostile进程安全。
PNG SHA 是编码字节，不重新编码来“规范化”。既有严格校验与受控路径规则保留。
队列/预算必须可拒绝新工作，不自动删旧数据。所有本批入口都不是 IPC 权限边界。

## 资产存储

- open 绑定 canonical root 与 sessionId，复用现有 layout/锁/读写原语。若已有 checkpoint，
  经正常 load 验证并把其引用集合加入本 depot 读取白名单；无 checkpoint 的合成新目录允许空集合。
  必须区分真正不存在与损坏/权限失败，不把任何 load 错误当新项目。open 不推进 head。
- put 复制 bytes、验证 operationId/尺寸/预算、真实 hash/full PNG decode；独占发布 immutable
  assets，不写 project.json 或 versions，不伪造临时 Project。复用同 root 队列与现有 storeAsset。
- maxPngBytes/maxPixels 都是有限正安全整数；先编码大小/metadata尺寸准入再 full decode，
  解码库自身限制也保持。此为局部准入，不是进程总内存封顶。值由调用方给定，无全局配置修改。
- put 成功需确认发布后 assets 目录 sync；Windows skipped 如实返回。既有 checkpoint 资产发布
  同样补齐该 flush，包含重试/已存在路径，防止第一次flush失败、第二次复用误称完成。
- 成功 put 的 assetId 加入本 depot 白名单，保持到 depot 不再被持有；失败不能增加资格。
  同 operationId 同输入在本 depot 幂等；不同 bytes/尺寸冲突。成功幂等重试仍验证文件存在/完整，
  不能返回已被外部删除的资产收据。跨会话不声称幂等。
- read 只允许初始 checkpoint 引用或本 depot 成功 put 的资产；复核绑定/hash，返回私有副本。
  新 head/Undo/Redo 不删旧白名单。没有GC/delete；未安装的blob保留。read失败本身无新写效果。
- 错误层不能解析 message 猜阶段；无法确证的写入失败保守 unknown。不得扩大原store唯一公开
  index.ts合同；新入口放 depot.ts，旧消费者行为除资产flush外保持。

## 像素制作

- Canvas2D Adapter；复用 `sketchRendering.drawStrokePathOnCanvas` 的真实画笔/橡皮算法，
  不编辑旧函数。points 和 size 在目标图像像素坐标系，不进行隐式1024坐标缩放；UI接线另适配。
- stroke 严格验证 brush/eraser、#RGB/#RRGGBB颜色、正有限size、opacity/softness [0,1]、
  偶数有限points至少一对，maxPoints按坐标对计；允许画布外坐标，canvas自然裁剪。
- 验证目标image/layer结构、visible且未locked、尺寸匹配；原asset只能用注入reader取得。
  PNG解码真实尺寸必须等于声明，不能缩放错误尺寸冒充正确；上下文/解码/编码失败明确返回。
- maxPixels/maxPngBytes/maxPoints 在大分配前检查可检查项；输出大小超限拒绝。清理自己创建的
  URL、临时canvas/bitmap；不释放调用方资源。无DOM时 unavailable，无空白或旧源成功fallback。
- produce返回完整新PNG，不入库、不改Project/History。opacity=0可返回原bytes；其他不承诺
  PNG编码稳定或像素相同必为no-op。不纳入prepared橡皮live画布；G2实际接线前另适配并验基线。
- 必须有真实 Electron Canvas 像素证据（合成小图）：透明底单点、连续线、半透明笔、橡皮alpha、
  软边与现有算法结果对照。Mock canvas调用记录不算像素证明。可在 owned 目录放独立 .mjs harness，
  用现有Electron隐藏窗口、临时独立userData，禁用网络/clipboard/Trash，无需修改生产入口。

## Session 调度

- 唯一作品状态通过现有 createProjectHistory 管理；初始数据先验证/复制。snapshot 返回副本，
  listener异常隔离；没有第二份可写Project。sessionId/incarnation固定。无生产root/IPC/Close认证声明。
- 本批命令：active镜头文字、active镜头组内排序、active镜头layer规则编辑、一笔、Undo/Redo、
  checkpoint/freeze/resume。禁止借 moveShots 恢复Pending；parked可在快照里保留但本批不操作。
- 不接受外部制作的ImageEditResult。layer调用真实drawing再history；paint内部读取队首图像，
  pixels.produce→assets.put→真实drawing replacePixels→history。校验receipt session/operation、
  尺寸和assetId形状；依赖返回错误/抛异常不变成成功。operationId由Session内部生成唯一序列。
- 单Session重型paint FIFO，下一笔从前笔实际提交后的源开始；同图layer/排序/Undo/Redo/冻结
  在有序队列中等待此前producer settle。只有 setScriptText 可在慢paint等待期穿插提交，且不能
  越过已经排队的Undo/Redo/freeze等屏障。paint在最新Project上安装，完整image/shot归属仍匹配；
  scriptText变化不拒绝，不覆盖新文字。History按实际提交次序：文字先、笔迹后。
- Undo/Redo在队首才判断history是否存在，先等早先paint完成；导航真正执行前提升控制generation，
  no-history不提升；拒绝迟到的旧操作，generation不回绕。freeze不取消已开始工作。
  单实例Promise重复完成必须至多一次发布。所有请求/笔画数组入口快照，防调用方中途修改。
- maxPendingRequests约束未结算请求数；超限返回resource-limit且不改变当前内容，不能让无界队列
  持有无限stroke。单stroke最大points由pixel依赖限额控制，Session仍须验证基本结构。
- changed后600ms debounce。最多一个checkpoint在途及一个最新待保存目标；捕获Project和资产
  reader后提交。checkpoint在途允许后续编辑；r的成功只确认r，r+1仍待保存。回执projectId/revision
  必须匹配捕获。拒绝/异常不会回滚用户编辑，不热循环重试，下一次编辑或显式请求可重试。
  不持有history队列等一个会回调同队列的任务，避免死锁；禁止旧head覆盖新head。
- checkpoint失败lastError保留；成功重试只清对应checkpoint错误，不清无关未结算失败。
  本批无TIFF状态，绝不可出现“全部输出已保存”宣称。初始checkpoint=null，初始project也可显式保存。
- freeze立即停止新编辑准入、取消debounce，等待已接纳工作和其回调，再flush最新checkpoint；
  成功phase=frozen，失败保留phase=freezing和错误，可再次freeze重试。resume仅允许已成功frozen，
  回到active；不提供绕过失败resume。重复freeze共享进行中工作。frozen无timer遗留，正常Close尚需
  以后Main认证，不能直接把此结果当作生产关闭许可。
- readAsset桥接depot.read的typed失败，不返回空白。当前/history/checkpoint引用均保留；本批不GC，
  不清除跨重启历史来宣称等价。maxHistoryEntries由调用方给定，最小测试用例可小，后续UI默认60。

## 验收与依赖

各lane先聚焦，再完整允许测试 + npm run build，保留精确候选SHA/raw logs/退出码。
用 scripts/wave2-verify.py；focused路径按lane固定。重型检查共享已有锁；75=忙，不是假PASS，
不得删别人的锁。main node_modules可建立只读使用的符号链接；Python依赖从主管现有vendor读取，
不安装依赖。runner不自动获取包。没有依赖或权限则报告，不扩大环境配置。

Session必须测试：慢paint夹文字、同图两笔、快速paint后Undo、Redo分支、no-op/error、突变输入、
回调抛错、异常依赖、r/r+1 checkpoint、冻结在途/失败/重试、满队列；用真实drawing/history。
Assets必须真临时FS：put不改head、权限/符号链接/损坏/blob复用、入库后新旧读取、篡改/删除后幂等
重试、相同op不同bytes、并发root、flush失败后重试、输入突变、尺寸/限额、重新open白名单。
Pixels必须本地聚焦验证与上述真实Canvas像素harness。现有允许完整套件保留禁止fixture排除。

交付仅owned实现提交与独立DELIVERY.md报告提交；不要提交TASK/设计修订混入实现。
DELIVERY写implemented/self-tested/independent acceptance区分。主管完成真实三模块组合、反例审查
和完整组合测试后再合入；原生产路径本批保持。完成后停止，后续G2接线另派。
