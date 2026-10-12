# 剩余工作 — Storyboard Flow

当前为数据安全 **WIP 源码检查点，不是验收或发布**。版本、授权与证据入口见 [当前交接](context-handoff.md)及 [检查点摘要](research/data-safety/SOURCE-CHECKPOINT.md)。此前正常 Save、AI 退役和非冻结模块优化的已接受范围保留，不因本 WIP 重置为零进展，也不扩大其旧验收。

## 本轮授权终点

- [x] 在公开基线 `2131f65423c8b67de7ccc0ba45daf5d9e217bf48` 的独立分支准备最新完整 522 源身份，保持既有测试断言和 full collection/exclude。
- [x] 提供脱敏交接、源码 manifest、已知失败与权限范围；不上传私有 fixture/原始证据/依赖/构建缓存。
- [x] 已提交并上传 `checkpoint/data-safety-wip-20261012`；源码提交 `d572cdfaf0ffb7e2d00a81f78c6f3b2b425f1877` 已从 GitHub 读回，522 文件与 manifest 全部匹配。后续仅更新交接文档，源码身份不变；未合并或发布。
- [ ] 上传后更新本机私有交接并复盘；不因此启动产品修复或新增验收矩阵。

## 待后续授权的修复与验证

- [ ] 原生 authorization session 的 CLI-only import/stdin injection adapter 兼容和 pure-observation lazy-start：保留现有八个失败身份、认证请求、namespace/inventory/readback、120s deadline 与事实保全；不得删测试或假取消求绿。
- [ ] 对 522 最终源取得高风险独立复审：custody current canvas 必须绑定 current version；absence 必须认证 lifecycle/Project/Root；cold 历史 provenance 与 present/deleted inventory；committed cleanup-warning 必须保真实 effect evidence。旧 517 咨询不自动接受最新修订。
- [ ] 修复并执行缺失的 mounted negative harness；现有重复声明启动前失败/TS 未执行不算负例通过。覆盖 wrong document/Root/history bytes/absence、0400 persistence failure、window/pins/History 保全。
- [ ] before-first-Save、其他 PNG producers、多资产 History partial/ABA/reload/晚 completion、失败恢复及 source unlink 仍需完整批准项对应证明；不能借有限 Add lifecycle 接缝自测宣布全部完成。
- [ ] applicable full gates 与正常 GUI 生命周期、冷重开、权限/native failure、资源 drain/cleanup 必须按最终源绑定验证。真实 Photoshop、Trash、clipboard、设备和完整竞态未由替身认证。
- [ ] Windows 和干净 Apple Silicon 获取/构建/最小 TIFF 往返、Python/vendor 可携性、打包交付未完成；本轮未安装或重新打包。
- [ ] 生产 quota 数字仍未批准；不将 fixture budget 转成产品默认，不自行 GC、删除 namespace/backup 或真实素材。

## 不在本轮内

不改 main、不引入并行 remote main、不发布 tag/Release/PR、不修改 CI；不恢复内置 AI、不启用冻结 origin、不扩展 PSD/PDF/SQLite/cloud 等产品范围。源码检查点上传不是权限/存储契约变更，也不是 full PASS 或部署。
