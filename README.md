# Storyboard Flow

本地优先的故事板工作台：排列分镜、写动作与对白、直接绘画、管理图层，通过显式保存同步工作 TIFF。

## 启动与项目

macOS 双击 `启动 Storyboard Flow.command`：使用现有依赖完整构建，再打开软件。启动器的项目选择和试画恢复行为以其实际参数为准；开发热更新用 `npm run dev`。新工作台是唯一入口。

可以打开当前格式项目或受支持的 TIFF 文件夹。“从 TIFF 创建工作副本”创建独立项目，不覆盖原稿。旧项目不自动迁移；不要删除 `.storyboard-flow` 绕过错误，其中可能有画稿和恢复数据。

自动暂存保存内部状态；显式“保存 TIFF”更新工作图、文件名和 Pending 位置，并将已删除输出送入系统废纸篓。手动刷新支持的外部 TIFF，冲突版本保留在 Pending。不承诺 Photoshop 全保真往返。

## 文档与开发

- [当前状态与剩余工作](docs/CURRENT.md)：已实现、实际验证和待验边界。
- [产品设计](docs/DESIGN.md)：设计主旨、宏观组织与单帧细化、具体交互和PD2取舍。参考原文：[PD2 设计文档](docs/PD2-设计文档.md)。
- [架构与数据契约](docs/ARCHITECTURE.md)：六个源码模块、代码入口、Session、保存与恢复契约。
- [开发工具与验证指南](docs/DEVELOPMENT.md)：项目注意事项、验证脚本索引、打包和发布。
- [开发规则](AGENTS.md)。

开发操作及验证入口见上述指南，执行前遵守 AGENTS。

旧前端仅作[交互参考](archive/legacy-frontend/README.md)，不参与运行、构建、测试和打包。自有代码采用 [MIT](LICENSE)，第三方依赖保留各自许可。
