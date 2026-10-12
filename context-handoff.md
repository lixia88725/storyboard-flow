# 当前交接 — Storyboard Flow WIP 源码检查点

## 当前目标与授权边界

当前目标是保全最新数据安全 WIP 源码、检查点上传、交接更新与复盘；不是验收、正式发布或继续实现的授权。依据发起方提供的用户确认摘录，必要源码及脱敏文档已提交到已有 PUBLIC 仓库的独立检查点分支；未合并 main，未发布安装包。

- 目标分支：`checkpoint/data-safety-wip-20261012`。
- 公开基线：`2131f65423c8b67de7ccc0ba45daf5d9e217bf48`；仅以此为父版本准备，不引入本机私有 dirty HEAD 历史。
- 本机原 main 的 dirty/untracked 成果保持不变。远端 main 的并行变化未合入；不得自动 pull/rebase/merge、创建 PR/tag/Release、安装依赖或新增/禁用 CI。
- 现状：**已上传源码检查点 / WIP / NOT ACCEPTED / 未合并**。源码提交 `d572cdfaf0ffb7e2d00a81f78c6f3b2b425f1877` 已从 GitHub 读回，522 项源码与清单全部匹配；文档后续更新不改变该源码身份。远端 main 保持原版本，读回时检查点分支 Actions 运行数为 0。

## 源码与证据身份

完整 **522** 项源码/测试/必要配置逐字节核对，公开身份文件为 [SOURCE-MANIFEST.json](research/data-safety/SOURCE-MANIFEST.json)，SHA256 `05fda907f9d878a47abb9812a331725e220ee8ee50686eeda857b0998bef3646`。

[检查点摘要](research/data-safety/SOURCE-CHECKPOINT.md)记录实现范围、完整八个失败身份、自测与咨询限制。累计补丁身份 `4d5a96bc92e3fb6ec74e327a7d38d515ec3516831f6c95ae957deb0b9ff41380` 指向旧 dirty 基线，不能直接应用到公开基线；本次按文件相对公开基线覆盖完整成果，不是只保存最后 12 个修订路径。

复用最终同源本机自测：264 文件 / 1963 assertions / 1955 pass / **8 fail** / 0 pending，原 1959 身份全部保留；build（两端 typecheck）、preload parity、Node safety 11 tests 通过。真实 CJS/TS 有限 Add→Undo→Save→Close→冷 Redo own ACK→Close，以及 fresh 无额外 Save Close 已通过对应接缝。**不是全套 PASS、独立验收或所有 producer 证明。** 原始 GUI trace、私有 fixture、原始 JSON/log、依赖与构建输出不上传；摘要不是原始证据可公开下载的承诺。

## 必须保留的未完状态

1. 五个 retained-set native case 受 CLI-only injection adapter 的 import/stdin 阻塞影响，原 120s deadline 超时；三个 ordinary-observation case 因未提供 Python 参数却提前 spawn 而失败。属于引入的兼容/纯观察回归，本轮不修、不删测试、不改断言/timeout。
2. 旧 517 源身份上的独立 custody 静态咨询提出 current canvas 历史版本重放、producer absence、cold receipt/current-version/document-origin 证明、committed cleanup-warning custody 缺口。522 有 absence/reader 自测修订，但未获独立复审，不宣布这些 findings 全部关闭；不要混淆另一轮已静态闭合的 cancel-intent / 私有 Close 信号 F1/F3。
3. mounted 负例 harness 在 Electron 启动前因重复声明失败，TS 对应负例未跑；wrong-document/Root/history-byte/unknown-absence、0400/window/pins 扩展仍 NOT VERIFIED。
4. before-first-Save 与其他 PNG producers 不完整，Windows 未完成，生产 quota 未批准；有限 fixture budget 不是产品默认配置。权限/存储契约不得扩写为新批准。
5. 有硬编码 Homebrew Python、vendor/旧 spike fallback；没有安装或干净机器获取/运行验证，不声称跨机可运行。查看 README 的最短获取与检查说明。

下一步是复盘本轮实际执行证据，区分必要安全验证、重复工作、工具返工及执行偏差；不直接改动工作规则或重启实现。后续修复、矩阵和高风险独立验收另核授权。[TODO](todo.md)保留唯一待办，[SYSTEM](docs/architecture/SYSTEM.md)复用现有架构入口。
