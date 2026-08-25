# 产品 Agent preset 权限边界

## 背景

Host 的 `workspace-write + ask` 不是所有 Agent preset 的天然边界。上游
`minimal` 在 Agent 私有 realm 中提供裸 `dsh-fs-local`，`cordis` 还提供可执行
模型生成 Host JavaScript 的工具；二者都会绕开产品声明的 Host 权限姿势。
上游 roster 默认还扫描 `$DSH_HOME/.agent-presets`，本地自定义 composition
同样可以挂载任意可信代码。

## 决策

- 禁用上游 `agent-presets` provider，改由 `@convax/agent-presets` 提供同一
  `agentPresets` 服务。
- M1 只暴露上游 `standard` 与 `code`；两者的 shell/filesystem 工具消费 Host
  sandbox、approval 与 command guard。
- roster 只扫描随固定 DSH npm 包发布的 system root，关闭 user root；保存的
  默认项若不在 allowlist，回退为 `standard`。
- 最终 `security.patch.yml` 同时重申旧 provider 禁用和产品 provider 启用，
  home patch 无法恢复不受约束的 roster。

## 被否方案

- **只把默认项设为 standard**：用户仍能在 UI 选择 `minimal`/`cordis`。
- **保留用户 preset 并检查 YAML 文本**：任意 Cordis 插件都是可信本地代码，
  静态字段过滤无法证明它遵守 Host 权限服务。
- **复制并维护整套上游 preset**：扩大升级 diff；产品 provider 直接读取固定
  npm DSH 的 system root，只过滤 roster 身份。

## 可证伪的验收证据

- policy 单测对 `standard/minimal/code/cordis` 只保留前述两个安全项。
- 两个 profile dump 均显示上游 roster disabled、产品 roster active。
- 真实 npm DSH 与隔离打包 smoke 调用 `agentPreset.list`，结果严格为
  `standard`、`code` 且 `authorable=false`。
- 对抗 home patch 尝试反转两个 roster，最终 overlay 仍恢复产品策略。

## 遗留风险

允许的 preset 内容来自固定 DSH npm 版本；每次上游 pin 更新必须重审
`standard`/`code` 是否仍只消费 Host 权限 seam。恢复用户自定义 preset 必须
另做安装/挂载信任决策，不能只打开 `includeUserRoot`。
