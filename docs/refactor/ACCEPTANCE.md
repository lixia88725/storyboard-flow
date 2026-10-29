# Refactor acceptance — coordinator checklist

2026-10-29；基于 main `c3e8a05` 的源码只读检查。状态：**验收设计，尚未执行**。
本文不更改 wave-1 契约或 Hermes 任务，不代表新功能已实现。

## Evidence rules

每个案例单独记录：候选 SHA、fixture 参数、操作、预期、实测、退出码、原始日志、
截图/像素或文件摘要、平台、耗时、资源清理。状态仅使用 NOT_RUN / PASS / FAIL / BLOCKED。
目前以下所有案例均为 NOT_RUN。已有历史日志不能自动转成新候选的 PASS。
源码阅读只证明接线和规则，不证明手势、速度或实际系统行为。

模块自测、组合验证、真实 Electron GUI、Windows/安装包分别验收。
同一轮中若代码变化，重新界定被测候选；报告提交与实现提交分开记。
完整允许测试集、完整 build 是必要条件；不能替代下面的产品链路。

## Synthetic fixtures

| ID | 内容 | 用途 |
| --- | --- | --- |
| F-small | 4 个 active 镜头 A/B/C/D、1 个 Pending P；64×64 确定性 PNG，透明棋盘/纯色/斜线；每图 3 层；中文、多行、emoji、空字符串 | 像素、顺序、文字、撤销的精确比较 |
| F-mixed | 横竖及混合尺寸；现有遮幅两种模式、对白覆盖层、锁定层；具体尺寸随现有工具支持范围冻结 | 显示/导入/合成一致性 |
| F-scale | 100 / 1,000 个镜头；分别测小型合成资产和独立的 1920×1080、每图 5 层合成资产组 | 元数据与真实解码/显示压力分开测；资源允许后生成 |
| F-failure | F-small 的独立副本：缺失 PNG、内容哈希不符、截断 manifest、未知版本、目标碰撞、受控不可写目录 | 拒绝、不误报完成、失败证据保留 |
| F-portable | 已内部保存的 F-small 完整目录副本，移至新路径且使旧路径不可用 | 不依赖原目录或外部资产 |

这里只规定 fixture 配方，本轮未生成图片或测试项目。后续使用
[test/temporaryWorkspace.ts](../../test/temporaryWorkspace.ts) 和
[临时工作区规则](../testing/temporary-workspaces.md) 分配专属目录；不读取真实作品。
GUI harness 必须隔离 userData/最近目录/端口/进程；默认拒绝 clipboard 和真实 Trash。
需真实 OS 操作的案例另开受控验收，不能拿拦截器结果声称系统行为已验证。
不直接执行现有整套 bitmap smoke：它包含 clipboard/Trash 场景。

## Product scenarios

| ID | 操作与观察点 | 通过标准 | 验证层 |
| --- | --- | --- | --- |
| A01 | 打开合成 TIFF 文件夹，建立可编辑内部项目 | 来源在显式 Save 前字节不变；准备失败不替换当前可编辑项目；最终直接编辑入口是否接通单独记录 | formats + GUI |
| A02 | 普通拖动、多选排序、边缘滚动；取消拖动；切换网格/日式分镜 | 两视图顺序/选择一致；取消不改数据；不恢复 Alt 拖拷贝 | storyboard + GUI |
| A03 | 编辑脚本文字、对白增删/跨镜头移动；日式分镜内修改后切回网格 | Unicode/换行/顺序正确；脚本与对白不混淆；输入法和焦点不触发画板快捷键；空对白 blur 行为保持 | storyboard + GUI |
| A04 | 画笔、橡皮、吸色、填充、模糊、套索变换 | 同尺寸/工具参数下观察 stroke、预览及最终 PNG；撤销恢复前像素；不能用 replacePixels 单测冒充工具验收 | drawing + GUI |
| A05 | 图层增删、排序、隐藏、opacity/blend、锁定及合并 | 合成正确；锁定只允许既有查看/解锁行为；至少一层；合并后撤销恢复各层及像素；历史所需资源仍可读 | drawing + history + GUI |
| A06 | A/B → Pending → active；包含已有对白和绘画；切换视图 | 成员/相对顺序/内容不丢；Pending 不进入活动输出、检查播放或脚本；文件副作用政策须先冻结（见集成文档） | storyboard + session + GUI |
| A07 | 文字 → 排序 → 绘画 → 图层属性，逐步 Undo/Redo；Undo 后新编辑 | 内容逐步精确恢复；新分支清 redo；项目 revision 单调；绘图与项目无双重历史记录；陈旧图像结果被拒绝 | 三核心组合 + GUI |
| A08 | 编辑后仅等内部自动保存，正常关闭，fresh-process reopen | 可编辑文字、顺序、图层和像素一致；根 TIFF 未改；健康关闭不弹恢复提示；不能把未完成写入视为健康 | persistence + session + GUI |
| A09 | 绘画后显式 Save；Undo；再次 Save；fresh-process reopen | 两次 TIFF 解码分别对应所捕获状态；内部可编辑资产一致；首次原件备份不被后续 Save 覆盖 | formats + save + GUI |
| A10 | 保存过程中继续编辑；快速重复 Save；切到另一个项目 | ACK 只归属原项目和被保存版本；更新编辑仍待保存；不覆盖新状态；重复动作不产生并行冲突写入 | session + IPC + GUI |
| A11 | 保存时注入资源/版本/head 发布失败；外部修改来源；命名碰撞 | 不返回成功 receipt；旧可读 checkpoint 不被坏输入取代；部分效果如实报告并保留；不 chmod 或静默覆盖 | 真文件系统 + save |
| A12 | 内部保存后复制整个文件夹；旧路径不可用时打开副本 | 文字、Pending、全部可编辑层可用；不从旧绝对路径取文件；Mac→Windows 另测，不由同机复制推断 | 真文件系统 + GUI + 双平台 |
| A13 | Delete → Undo；另跑 Delete → Save | 保存前不物理删除；撤销仍可恢复；Save 的删除去向和首次备份按来源类别核对，不将普通工作 TIFF 与 managed source 混为一谈 | storyboard + save + 受控 OS |
| A14 | Markdown 修改/显式 Import；相同条数、更多条目；外部 TIFF 变化 | 位置更新/新增与既有行为一致；不自动接受外部内容作为已同步；失败不丢当前编辑 | formats + GUI |
| A15 | 遮幅/对白覆盖层、空镜头新增、Import、Pending 回移 | 尺寸/覆盖层及场景继承一致；不把覆盖文字与脚本正文混为同一字段；撤销范围明确 | drawing + storyboard + GUI |
| A16 | 检查播放/邻帧 onion skin、缩放/平移/框选、项目切换 | 只引用 active 镜头；不增加声音/时长功能；当前手势保持；异步完成不会改另一个项目 | GUI |

## First end-to-end acceptance sequence

F-small：记录原始像素及目录清单 → 改中文脚本 → 移动 B → 给 A 画一笔 → 改层 opacity
→ 撤销两步 → 重做两步 → 等内部 checkpoint → 关闭 → 新进程打开 → 比较 metadata/PNG
→ 显式 Save → 核对 TIFF 解码和首次备份 → Undo 一笔（独立同会话分支）→ 第二次 Save。

注意：fresh-process reopen 后继续 Undo 不是 wave-1 已有保证。基础序列把“同会话撤销”和
“重开后仍可编辑”分开。跨会话历史的产品承诺须单独决定并实现，不能靠 versions 文件存在推断。
失败分支：在同一序列的 checkpoint/head/TIFF publication 前后注入受控故障；检查状态与文件，
不是只检查一个 Promise rejected。先完成不涉及 TIFF 的组合，再启用完整链。

## Performance measurement proposal

参照 M1 / 32GB，不假定当前测试机就是参照机。记录硬件/系统/显示倍率、构建模式、
缓存冷暖、资产去重比例、尺寸、层数、并发测试负载。开发中的三个完整测试不能与性能采样混跑。

分别记录打开首屏/全部就绪、拖动与绘画反馈、Undo、checkpoint、显式 Save、Close 的耗时；
记录 p50/p95（多次样本）、主线程长任务、Electron 各进程内存及峰值、读写量、解码图片数。
metadata-only 的 1,000 条通过不等于 1,000 张高清绘图顺畅。
建议以“视口按需解码、编辑不等待整项目 TIFF 输出”为设计目标；具体毫秒/内存上线标准
先测当前可运行基线后冻结，不能临时放宽数字换 PASS。本轮不宣称任何性能改善。

## Delivery review gates

1. 核对 briefing 之后的实现提交及修改范围；审查 DELIVERY/QUESTIONS 与原始日志。
2. 对共享语义做反例检查：stale/ABA、no-op、锁定、history 资产、失败 publication。
3. 只整合实现。三个根 DELIVERY.md/QUESTIONS.md 属于各 lane 报告，应保留于来源 worktree
   或复制到 coordinator 的分 lane 证据目录，不能互相覆盖。briefing 不合入 main。
4. 三核心组合测试通过，再接真实 preload/Main 与 GUI；变更 preload 时运行 check:preload。
5. 所需案例缺证据则该范围不通过；源码实现、自测、独立验收、发布分别记。禁止推送。
