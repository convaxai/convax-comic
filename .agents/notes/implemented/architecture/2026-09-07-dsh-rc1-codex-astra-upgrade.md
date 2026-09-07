# DSH rc.1 与 Codex Astra 升级

## 版本与来源

- DeepSeek Harness：`0.1.1-rc.2`（`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`）升级到 `0.1.2-rc.1`（tag `dsh-v0.1.2-rc.1`，`a66e4702047846cdaa10c66c9d3df3951f5ea70d`）。
- Codex Connect：`0.1.0-alpha.4.20` 升级到与 rc.1 验证配对的 `0.1.0-alpha.4.30`。
- pi-ai：`0.82.1` 升级到 `0.84.4`；Cordis 运行闭包同步到 rc.1 所需的 `cordis@4.0.2`、include `1.0.7`、loader `1.0.3`、timer `1.1.4` 与 schemastery `3.18.2`。
- `patches/` 升级前后均为空；仓库没有 `.gitmodules`、gitlink 或内置上游 checkout。可选同级 checkout 在升级前仍为旧 commit，产品构建和验收没有依赖它。

## 迁移决策

- rc.1 删除 `dsh-client-runtime` 和 Host ApiProxy，产品 Client 改用 `ctx.remote`、`remote.$host.isLoopback` 与 `settings/openSettingsDocument`；Host/Client 自有 Typert Remote 继续使用 slash endpoint。
- 上游 Agent preset 从 `code` 改名为 `ptc`。产品只允许 `standard` 与 `ptc`，关闭 user root，并使用 rc.1 的 shipped preset root。
- rc.1 在产品控制 token 之外新增浏览器会话认证。`auth-fence` 仍是最外层、不可绕过的控制面认证；组合完全 settled 后，它只通过 Host→Electron 私有 IPC 发送上游一次性浏览器认证 URL。Electron 主进程用受信 Session 完成 303/cookie 交换，然后只加载 clean origin。一次性 URL不进入 preload、Renderer 状态或日志。
- rc.1 的默认遥测模式变为 `FEEDBACK_ONLY`。为保持产品升级前行为，Electron 子进程固定注入 `DSH_TELEMETRY_MODE=DISABLED`。
- Codex Connect 4.30 自带缺失目录时的 `gpt-6-astra` fallback。默认模型仍为 DeepSeek。由于 4.30 的 `enableSearch` 会接管 profile 全局搜索，产品将其显式设为 `false`；图片查看/生成保持开启，`enableAutoReview`、proxy 显式关闭。

## 配置差异

两个 profile 的共同差异均来自 rc.1 上游基线：新增 DeepSeek API extension、session log、package inventory、session controller、settings controller、workspace controller、UI session/chat/approval 等 rows；移除 ApiProxy、client-runtime 与旧 subagent-report row；Web 增加 HTTP fetch provider。`compatibility` 仍没有 Convax Client 覆盖，最终安全 overlay 仍保留 auth-fence、command guard 与保守权限。

`default` 另将 Codex Connect 从 4.20 升至 4.30，并显式配置：

- `enableSearch: false`
- `enableImageTool: true`
- `enableImageGeneration: true`
- `enableAutoReview: false`
- `enableProxy: false`

## 安全复核

- 无产品 token 的 HTTP、错误 token 与 upgrade 仍在任何路由分发前返回 403。
- 上游浏览器 cookie 不能替代产品 token；产品 token 也不能替代上游 cookie。
- preload 暴露面无新增；一次性上游认证 URL仅存在于 Host→Main IPC。
- 导航仍只允许本次启动的精确 `127.0.0.1:<random-port>` origin；host、随机端口和权限 profile 不放宽。

## 验收

- 定向 typecheck 与 auth-fence、desktop、agent-presets、UI、Canvas 测试通过。
- `yarn smoke:upstream` 通过 default/compatibility、双层认证、Agent roster、Canvas V2 Remote、SIGKILL 恢复和数据边界。
- 升级前后 dump-config 已对照；差异为上述 rc.1 基线及 Codex 显式能力变化。
- 根 `yarn check` 与目录打包验收结果见本次交付记录。

## 遗留风险

模型出现在目录中不代表 ChatGPT 账号具有 Astra entitlement。真实 OAuth、模型请求、图片生成与额度查询仍需用户账号做手工验收；本次不会读取或输出 OAuth 文件内容。
