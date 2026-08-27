# GitHub Actions CI 拓扑

## 背景

DSH 上游把主 Node 静态门禁、版本兼容、消费者产物、覆盖率、跨平台和最终
聚合 verdict 分成独立 lane。Convax Comic 当前是仅发布 macOS ARM64 的小型
产品仓库，直接复制上游的 Python、Windows、Wine、覆盖率和真实内核 sandbox
矩阵既没有对应产品面，也没有本仓库可执行的阈值。

## 决策

- PR、main push 和手动触发共用一个 `CI` workflow；过期的同 ref run 自动取消。
- `node 24.9 / quality gates` 在 Ubuntu 24.04 执行 immutable install 和完整
  `yarn check`，覆盖构建、typecheck、测试、组合、安全、profile 与
  `dump-config` 基线。
- `node 22.19 / compatibility` 与 `node 26 / compatibility` 只验证构建、类型和
  单测，分别覆盖根 manifest 声明的最低 Node 与前进兼容面；产品打包运行时仍
  精确固定 Node 24.9.0。
- `macOS arm64 / packaged smoke` 固定使用 `macos-15` Apple Silicon runner，先
  断言 `uname -m = arm64`，再执行目录打包和隔离 runtime/PTY/fence/data smoke。
- `all checks passed` 是唯一稳定的分支保护候选，使用 `if: always()`，任何依赖
  的 failure、cancelled 或 skipped 都显式失败。
- workflow 只有 `contents: read`；checkout 不保留凭据；第三方 Actions 使用完整
  commit SHA。所有 Node lane 先安装兼容 22.19–26 的精确
  `corepack@0.34.1`，不依赖 runner 是否内置 Corepack。首版不引入可变缓存，
  以确定性优先。
- `.github/workflows/ci.yml` 本身由 `check:ci-config` 解析校验，避免 action pin、
  runner、版本矩阵或聚合依赖被无意弱化。

## 暂不进入 required CI 的项目

- 覆盖率：当前没有经评审的基线和阈值，不能用无门槛 coverage 制造绿灯。
- Windows/Linux 打包：C3 之前不是支持目标。
- 签名、公证和发布：依赖发布凭据，只能进入未来显式授权的 main 手动工作流。
- 上游 Python、Wine 和真实内核 sandbox lane：本仓库没有对应实现；安全边界由
  auth-fence、profile/dump-config 测试与 macOS 打包 smoke 覆盖。
