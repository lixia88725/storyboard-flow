# Storyboard Flow naming

2026-10-29：用户明确批准全部统一，不要求兼容之前的测试项目。本规则取代早期保留内部旧名的要求。
历史验收报告、旧任务记录和 Git 历史保持原样，不把旧候选的测试结果伪装成新命名的结果。

| 用途 | 统一名称 |
| --- | --- |
| 产品、窗口、安装包展示 | Storyboard Flow |
| 包名、文件前缀、域名 | storyboard-flow；storyboard-flow.local |
| TypeScript 类型与函数 | Flow / flow，例如 FlowImageMetadata、importFlowFormat |
| 项目内格式状态字段 | flow / flowMetadata |
| 环境变量 | FLOW_*，例如 FLOW_PYTHON_DEPS_DIR、FLOW_USER_DATA_DIR |
| IPC | importFlowFormat 等完整发送端/接收端名称 |
| TIFF | app: Storyboard Flow；format: flow-tiff；flow:metadata；https://storyboard-flow.local/ns/1.0/ |
| 恢复/资源协议 schema | flow.*；原有 version 字段单独表达协议版本 |
| 当前运行时内部数据 | .storyboard-flow/storyboard.project.json、layers/ 等 |
| 导入生成的子项目 | .storyboard-flow-project/，与内部数据目录分开 |
| 新核心检查点 | .storyboard-flow/checkpoints/project.json、assets/、versions/ |

上面最后三项是目录角色，不是三个产品。检查点核心仍未接入生产界面；独立子目录避免与当前
运行时的项目记录、图层或导入标识冲突。父目录和 checkpoint 目录分别做真实目录/符号链接检查。

本次不改磁盘上已有作品、恢复数据、系统配置和已安装应用；不扫描或迁移旧格式目录。
旧字段、环境变量、IPC、TIFF 自定义标识不再作为当前读写接口；旧 TIFF 仍可能被当作外来
普通图片浏览/显式导入，但不承诺读取旧应用专有图层或工程信息。新版本应使用新建的测试项目。

允许保留旧名的范围：历史/审查记录、变更映射、明确验证旧数据不被修改的测试。
活跃代码不增加隐式旧名别名。无需把 Photoshop 等第三方格式名称换成产品名。

三个 Hermes 的旧分支保留为已验收来源，不逐个就地批量改写；下一轮从统一后的 main 建立任务。
启动脚本的现有行为与内容保持不变。所有命名调整需完整 tests/build、preload 一致性与资源准备验证；
源码/测试通过不代表已安装包、真实 GUI 或跨平台已验收。
