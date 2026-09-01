# Desktop Host 状态服务收口

## 背景

`@convax/desktop` Host 插件向 DSH 提供 `appDesktop`，并通过 `convax:desktop-query/state` 与 Electron supervisor 镜像 origin、profile 和 ready。仓库没有任何服务消费者；真正驱动窗口与失败页的启动上下文始终由 supervisor 直接维护。为该镜像存在的 profile config 和 `CONVAX_PROFILE` 环境变量也没有其他业务读者。

## 决策

- 删除 `appDesktop` 服务、desktop-state/query 消息类型、supervisor 往返和对应测试表面。
- 删除两个 profile 的 `app-desktop-host.config.profile`，以及只为该服务传递 profile 的 `CONVAX_PROFILE` 环境链。运行 profile 继续由受控 `--profile` argv、supervisor options 和物化目录决定。
- 保留 `@convax/desktop` Host 插件与 `process disconnect -> SIGTERM` 防线；它覆盖插件挂载后的父进程租约，`parent-guard.cjs` 继续覆盖 DSH 加载前窗口。
- 删除的充分理由是私有服务无消费者，不把 auth-fence 描述为 profile/readiness 服务的完全替代。

## 被否方案

- **连 desktop Host 插件一起删除**：会移除 Agent Note 已明确要求的第二层进程生命周期防线。
- **保留 profile config 或环境变量作为未来缝隙**：当前没有消费者，会继续制造组合和实际启动来源的双表示。
- **让 DSH 插件重新读取 supervisor 启动上下文**：没有产品需求，只会恢复被删除的镜像协议。

## 可证伪的验收证据

- `appDesktop`、desktop-state/query、`CONVAX_PROFILE` 在产品源码、测试和文档中归零。
- desktop supervisor 的启动、ready/failure、重启与整树回收测试全绿，disconnect guard 仍在。
- default/compatibility dump 仅删除 `app-desktop-host` 的无效 config；compatibility Client roster 与 auth-fence 不变。
- 根 `yarn check`、`smoke:upstream` 和 `package:dir` 全绿。

## 遗留风险

未来若 Host 插件确实需要桌面启动信息，应以真实消费方重新建立最小契约，并明确状态权威与生命周期；不预留未使用的镜像服务。
