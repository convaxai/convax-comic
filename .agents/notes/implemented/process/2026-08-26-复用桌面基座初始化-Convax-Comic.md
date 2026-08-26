# 复用桌面基座初始化 Convax Comic

## 背景

`convaxai/convax-comic` 是新的 AI 漫画项目。已有 `convax/convax-next`
分支完成了 DSH + Cordis 桌面基座、安全 fence、双 profile、独立 Node 闭包
和 macOS ARM64 目录打包，没有必要在新仓库重写这些通用能力。

## 决策

- 保留 `convax-next` 的基座提交历史，使 DSH pin、安全设计和 M1 验收证据
  可追溯；新仓库默认分支为 `main`。
- 通用 `@convax/*` 包名、`CONVAX_*` 环境变量、IPC 与 token header 保持
  稳定，避免人为分叉基座协议。
- 产品身份改为 `Convax Comic`，bundle id 改为 `com.convax.comic`；bootstrap
  在 session 初始化前显式固定独立的 `userData/Convax Comic` 根，从而与
  其他 Convax 应用隔离。
- 保留 compatibility/default、安全 overlay 和全部门禁；本次不引入漫画
  领域插件，也不假设项目 schema、模型供应商或编辑器形态。
- 历史 Agent Notes 保留原名；新项目决策以新 Note 追加，不改写旧证据。

## 被否方案

- **从空仓重新实现桌面壳**：会重复高风险鉴权、进程监督和打包工作，并
  丢失已经通过的可证伪证据。
- **只复制最终文件并压成一个 root commit**：无法审计上游 pin 与桌面行为
  提交的分离关系。
- **连通用协议一起改名**：没有产品收益，却会放大迁移 diff 和安全回归面。
- **迁移时顺手设计漫画业务**：当前没有产品规格，容易把未经确认的假设
  固化进基座。

## 可证伪的验收证据

2026-08-26 在 macOS ARM64 执行并通过：

- `corepack yarn install` 仅将根 workspace lock key 从 `convax-next` 更新为
  `convax-comic`；随后不可变安装通过。
- `yarn check` 通过构建、typecheck、12 个测试文件共 45 项测试、profile、
  布局与组合门禁。dump 摘要为 baseline `cee7cd4d8c75`、compatibility
  `fedf52a4bccb`、default `322d8f116675`；允许差异行集合与导入基座一致。
- `yarn smoke:upstream` 的两个 profile、hostile home patch、HTTP fence、
  `SIGKILL` 重启和产品数据边界全部通过。
- `yarn package:dir` 生成未签名 `Convax Comic.app`；隔离 Node/DSH、PTY、
  只读 Agent roster、auth fence 和依赖 realpath smoke 全部通过。
- 真实启动目录产物后，Electron helper 的 `--user-data-dir` 为
  `~/Library/Application Support/Convax Comic`，DSH 子进程仍为随机
  `127.0.0.1` 端口；退出后进程树回收。
- submodule 仍为 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，tracked
  status 为空；`patches/` 与 `upstream.json#patches` 仍为空。
- preload 暴露面、权限 profile、安全 overlay、host/port 和 token 生命周期
  相对导入基座均无 diff。

## 遗留风险

- 当前 `default` 仍以 DSH 上游 Client 为主，只替换最小品牌 slot；Comic
  产品 UI 和整窗承载方案属于 C1。
- 首版仍是未签名 macOS ARM64 目录产物；签名、公证、更新与 Windows 在
  C3 处理。
