# Default profile 安装 Codex Connect

## 决策

- 仅在 `default` profile 挂载 `dsh-codex-connect@0.1.0-alpha.4.20`；
  `compatibility` 不增加第三方 Host 或 Client entry。
- npm 版本仍在 Yarn 供应链冷却期内；匹配 GitHub tag
  `v0.1.0-alpha.4.20` 已验证为 commit
  `f2535ca04844914304813b2d2455022442ca809c`，但 Yarn 无法 pack 该 pnpm
  workspace（`Unsupported workflow`），因此不使用 Git source。
- `.yarnrc.yml` 通过 `npmPreapprovedPackages` 仅批准精确 descriptor
  `dsh-codex-connect@0.1.0-alpha.4.20`。全局冷却期与 Git source 白名单不变，
  registry tarball 继续由 lockfile checksum 与发布 integrity 校验。
- 使用包的 canonical `llm-openai-codex` row，使其 keyed Plugin configuration
  与 `doctor` 能识别官方 provider；该 row 属于受静态白名单约束的外部 entry，
  产品自有 entry 仍必须使用 `app-*`。
- 按插件兼容矩阵直接 pin `@earendil-works/pi-ai@0.82.1` 和
  `@deepseek-ai/dsh-llm-pi-ai@0.1.1-rc.2`。DSH source/npm pin、Electron、打包
  Node 与 `patches/` 均不变。
- 保持 `enableProxy` 为 `false`，启用 `enableSearch`、`enableImageTool`、
  `enableImageGeneration`。不修改 `agent-default-model` 或
  `web.searchProvider`：Codex 搜索只注册为可选 provider，全局搜索仍走
  DeepSeek；安装过程不读取或启动 OAuth。

## 边界

OAuth 状态由插件写入 DSH home 下独立的 owner-only 文件；产品代码不得读取、
复制或提交该文件，也不得读取 `~/.codex/auth.json`。登录与授权只能由用户在
Codex Connect 设置卡中显式完成。

## 验收

- default dump 恰好新增一个 `llm-openai-codex` row，三项获批可选能力为
  `true`、proxy 为 `false`；默认模型与搜索路由相对安装前不变。
  compatibility dump 与安装前逐字一致。
- secret-free `doctor --json`、根 `yarn check`、真实双 profile smoke 与目录
  打包 smoke 通过。
- 源码闭包与打包产物的独立 Node 24.9 均运行 `doctor --json`：版本组合为
  compatible、providerConflict 为 false、凭证文件 missing、三项获批可选能力
  启用且 proxy 关闭。
- 真实 Electron Client 的模型选择器显示独立 OpenAI Codex 分组及完整模型
  目录；关闭目录后当前选择仍是 DeepSeek-V4-Flash，未启动 OAuth。
