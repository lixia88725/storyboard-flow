# 第二轮主管验收基线

2026-10-30，准备阶段；依据 main `4dac2b4` 的源码与第一轮已验收记录。
本文是功能核对与接入门槛，不是实现完成记录，也不代替待审的三个 lane 方案。
当前全部第二轮 GUI 场景为 NOT_RUN。原运行时 GUI 通过不能算新核心 GUI 通过。
详细场景沿用 ../ACCEPTANCE.md 的 A01–A16，不复制另一套操作定义。

## 功能、所有者与证据

| 必须保留的体验/行为 | 现有入口（src/renderer，另注明路径） | 新归属目标 | 验收编号 / 必需证据 |
| --- | --- | --- | --- |
| 同一工程的网格、日式分镜切换 | App.tsx、JapaneseStoryboardView.tsx | 同一 Session 快照，两种视图投影 | A02/A03；切换前后内容、顺序、选择一致，实际 GUI |
| 镜头新增、多选排序、删除与撤销 | storyboardDragEndController.ts、addShotController.ts、deleteActionController.ts | Board 命令 + Session 副作用协调 | A02/A07/A13；一次动作一次撤销，取消不改内容 |
| 脚本、对白编辑和跨镜头拖动 | projectEditController.ts、dialogueActionController.ts、editableDialogueText.ts | Board 原子复合命令；输入法/焦点归 UI | A03/A07；稳定 ID、Unicode、多行、空对白 blur |
| Pending 移入、移回及撤销 | storyboardDragEndController.ts、electron/normalSavePending* | Board 成员关系 + 有明确输出策略的 Session | A06；现有文件效果不能随数组迁移消失 |
| 画笔、橡皮、填充、模糊、套索变换 | SketchPad.tsx、bitmapLayerPaintingController.ts、bitmapLayerCanvas.ts | Drawing 像素制作 + 资产管理 + Session 提交 | A04/A07；真实手势、前后 PNG、失败不发虚假成功 |
| 图层增删/排序/显示/透明度/混合/锁定/合并 | LayerPanel.tsx、bitmapLayerActions.ts、layerMetadataActionController.ts | Drawing 规则 + 合成；单一项目历史 | A05；锁定政策、合成一致、合并可撤销 |
| 遮幅、对白覆盖层、空镜头尺寸与继承 | shotPresentationController.ts、bitmapLayerCanvas.ts、src/shared/projectOps.ts | 显式作品字段和复合命令；UI 只提供输入 | A15；不把显示文字与脚本正文混为同一字段 |
| 自动暂存、健康关闭、重开可编辑 | workspaceAutosaveController.ts、workspaceCloseGuardController.ts、normalSaveAppAdapter.ts | Session 生命周期 + checkpoint | A08；根 TIFF 不改，未完成写入不能视为健康 |
| 显式 Save、命名、首次原件备份 | normalSaveAppAdapter.ts、electron/main/main.ts、electron/main/managedSourceSave.ts | Save 协调 + Formats + Platform | A09/A10/A11；文件像素/身份、备份、捕获版本收据 |
| 外来 TIFF 与 Markdown | folderImageImportController.ts、electron/main/main.ts、scripts/photoshop-layered-tiff-*.py | Formats 准备结果，Session 原子采用 | A01/A14；导入失败保留当前工程，不暗丢字段 |
| 检查播放、洋葱皮、缩放、平移、框选 | App.tsx、SketchPad.tsx、storyboardZoomController.ts、boardPanController.ts | UI 状态 + Board 活动镜头引用 | A16；保持交互，不增加声音/时长功能 |
| 多工程切换、旧异步回调 | workspaceSession.ts、workspace slots、Save owner | 每会话唯一身份与状态所有者 | A10；A 的回调不能更新 B 或同 ID 的重开会话 |
| 完整文件夹搬迁 | electron/core/persistence、Session/Formats 源绑定 | 项目相对资源；运行时重新绑定根目录 | A12；旧目录不可用时仍可编辑；跨平台另测 |

三核心目前只覆盖这些目标的子集：例如 replacePixels 接收 assetId，不生成 PNG；
checkpoint 的 readAsset 受该快照引用集合限制（electron/core/persistence/checkpoint.ts），
因此历史中的旧像素与新编辑像素的存储/读取责任必须明确，不能交给 UI 临时拼接。

## 共享规则：方案审查的固定底线

1. **一个可写工程状态。** 两种视图、文字与绘画都通过同一 Session 发布；旧 Project
   若临时作为视图投影只能只读，禁止双向同步两份可写数据。
2. **一次用户操作对应一次项目历史。** 跨镜头对白移动、合并、遮幅等复合动作全成功
   才发布；中途失败不能留下半次操作。像素工作成功且基线仍有效后才能采用新资产。
3. **三种状态分开。** 当前内容、内部 checkpoint 已保存内容、TIFF 已输出内容各自记录。
   不能用一个 saved 布尔值表达。具体收据结构由主管审查后冻结。
4. **回调绑定原会话与捕获版本。** 保存进行期间允许的新编辑不能被旧 ACK 清除；
   切换/关闭后旧回调不更新另一个会话。超时不表示已取消磁盘效果。
5. **资产有明确所有者。** 制作中、当前内容、Undo/Redo、正在保存所需资产均可追溯；
   内存缓存释放与磁盘资产删除分开。没冻结保留规则前不引入 GC。
6. **显式 Save 才同步正常输出。** 自动 checkpoint 不顺带写 TIFF/改真实文件名；
   已有 Import/Create/Pending 的例外要逐条记账，不能靠命名重构扩张写入权限。
7. **失败如实返回。** checkpoint 成功不等于 TIFF 全成功；部分写入、外部改动、
   缺图和未知权限都保留诊断与失败边界，不能为简化界面把它们当成功。
8. **现有交互优先。** 遮幅层排序、锁定反馈等第一轮纯核心与现有 UI 的差异需要
   显式适配或产品决定；新格式不要求兼容旧测试工程，不代表可以丢失现有功能。

## 接入顺序与第一条可交付流程

**G0：接口冻结。** 比较三个提案，确认 Session/资产/Formats 的数据责任、收据和
失败语义；列出最小流程必需字段与全功能必需字段。单独列出尚需用户决定的产品行为。
实现阶段才能修改共享契约，三个 lane 不分别发明自己的版本。

**G1：无 GUI 的真实组合。** 合成新项目、真实 PNG、真实临时磁盘；改文字/排序/像素，
统一 Undo/Redo，checkpoint/reload；补充保存期间编辑、切换与资产失败反例。
这是第一轮组合测试的扩展，不能代替 G2。

**G2：最小真实界面闭环。** 对专属合成新格式工程接入现有界面：4 个镜头 + 1 个 Pending，
每图 3 层；改中文脚本 → 排序 → 一笔绘画 → 改透明度 → 撤销两次 → 重做两次 → 等待
checkpoint → 正常关闭 → 新进程重开，精确比较文字、顺序、图层与 PNG。
入口应隔离选择新工程链；同一工程不能同时走新旧两套写入链，不承诺旧工程自动迁移。
此门槛只验证实际实现过的工具；其他工具和日式视图完整交互仍列为 NOT_RUN。

**G3：TIFF 完整闭环。** 用新 Formats 从合成 TIFF 建立可编辑工程，画一笔 → Save →
Undo → 再 Save → 重开；核对两次输出和首次备份。另测重复 Save、保存中编辑、A/B
切换、外部文件被改动、部分输出失败。仅验证受支持 TIFF 子集，不声称 Photoshop 全保真。

**G4：功能补齐与清理。** A01–A16 全部逐项接入；每个旧实现必须满足“新所有者 +
调用方切换 + 正反例通过 + 无剩余调用”才可删除。纯转发层不因结构好看就增加。

**G5：规模与平台。** 100/1000 镜头、高清多层资产，分别测打开首屏/就绪、绘画、Undo、
checkpoint/Save/Close、内存峰值与解码量；参照 M1/32GB，记录实际测试硬件。
Mac、Windows、安装包和目录搬迁分别提供证据；小 PNG/元数据测试不充当电影级验收。

## 尚待提案收敛，不能默认为产品决定

- 跨会话 Undo 是否保留、历史容量/分组；versions 目录不等于持久 Undo 栈。
- Pending 是否改为纯逻辑暂存并延后文件效果；当前先保留既有行为。
- TIFF 隐藏层、空层、透明度与合成结果的支持范围及显式提示；先核对现有行为。
- 选择/活动层等跨会话 UI 偏好的保存位置；不混进作品事实而造成双状态。
- 缓存预算和逐步性能目标；先测量，不能事后放宽指标换取 PASS。

这些由主管合并提案后提出具体推荐，需要改变交互/保存承诺的再集中询问用户。

## 测试与交付安排

设计文档阶段仅校对来源/链接、范围和 git diff --check，不运行二十分钟的完整测试。
实现期间模块聚焦测试可独立运行，重型原生全量测试按共享验证槽串行，避免相互干扰。
每个实现候选需完整允许测试与 npm run build；preload、资源准备、真实隔离 GUI 按改动补验。
记录 SHA、命令、日志、失败/跳过和资源清理；主管完成组合复核后再整合，不推送。
