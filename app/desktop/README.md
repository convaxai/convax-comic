# `@convax/desktop`

Convax Comic 的最薄 Electron 壳与 Cordis Host 插件。它只负责独立 Node 子进程、
启动鉴权、窗口安全、崩溃恢复和最小原生操作，不承载产品文件 API、插件转发或
Client UI 覆盖。

bootstrap 在任何 session 或产品目录初始化前把应用名与 `userData` 根固定为
`Convax Comic`，与其他 Convax 产品的数据目录隔离。

## 私有 Host 服务

插件提供 `appDesktop`。服务只读暴露当前命名 profile、当前 loopback origin 和
readiness；它是产品内部服务，未承诺为第三方插件 API。该包没有 `dsh.client`
声明，因此 `compatibility` profile 不会获得任何桌面 UI slot 覆盖。

## Preload 暴露面

`window.convaxDesktop` 只包含 `getLaunchContext()`、`retry()`、`openLogs()`、
`quit()`、`onOriginChanged()` 和当前为空的 `native` typed affordance。没有通用
`invoke`/`send`，token 不写磁盘、日志或 URL。

## 运行时

生产依赖精确固定 `electron@43.4.0` 与独立
`node-bin-darwin-arm64@24.9.0`。M1 将生产闭包放在普通的
`Resources/app` 目录，避免 `node-pty` 把 `app.asar.unpacked` 二次改写后找不到
`spawn-helper`；外部 Node 可直接运行 `@deepseek-ai/dsh`，并禁止
`ELECTRON_RUN_AS_NODE`。当前只配置 macOS ARM64 的未签名目录产物。

启动前，壳从开发态 `app/profiles` 或打包态 `Resources/profiles` 物化所选命名
profile，并把产品 Host 包链接到 `harness/profiles/node_modules`。
profile 的组合源始终是根 `app/profiles`，本包不维护 patch 副本。
桌面拒绝调用方传入 `--patch`，只在 DSH 的可写 home 层之后追加
`Resources/profiles/security.patch.yml`，作为产品拥有的最终安全断言。

物化器从纯数据 patch 的 `insert[].name` 自动发现普通插件，并要求它已是本包
的直接运行依赖；因此新增插件只改依赖与 profile，不改 bootstrap 清单。
