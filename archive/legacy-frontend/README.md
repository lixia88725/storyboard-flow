# 旧前端交互参考

2026-11-03 按用户批准退役旧入口。这里保留旧 App、RecoveryEntry、经典 Grid/Japanese/Inspect 及独占控制器、测试和迁移前的混合 FlowEditor 快照，供交互设计参考。

- 这些文件不参与运行、类型检查、测试、构建或安装包。
- 归档不保证独立可运行；仍被新版使用的共享组件留在 `src/renderer/`，旧后端由 Git 历史追溯。
- 当前唯一界面是 `src/renderer/flowEditor/Workbench.tsx`。旧 Inspect 独占播放界面随旧路径退役。
- 未包含用户项目、画稿、恢复数据或禁止读取的测试文件。
- 文件来源及退役清单见 [retired-paths-2026-11-03.json](retired-paths-2026-11-03.json)；迁移前基线为 `e8bd9db`，混合 FlowEditor 快照还包含此前未提交的已验收工作。
