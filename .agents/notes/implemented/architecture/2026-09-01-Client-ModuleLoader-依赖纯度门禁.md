# Client ModuleLoader 依赖纯度门禁

## 问题

Project Client 曾在启动时生成 `require("@deepseek-ai/dsh-typert-protocol")`。该包既不是浏览器平台 seed word，也没有作为独立 Client package 进入启动图，因此 DSH ModuleLoader 在物化 `@convax/project` 时拒绝加载，桌面显示 “Failed to load plugins”。

## 根因

Project 与 Canvas Client 为了取得 `$mount` descriptor，从包含 Host `TypertRemoteService` 实现的 `remote.ts` / `remote-v2.ts` 导入常量。正常依赖图下 bundler 会继续内联协议实现，但当 workspace 依赖解析暂时不完整时，tsdown 只给 warning 并把协议包保留为外部 `require()`，构建仍然成功。既有单测直接导入 TypeScript 源码，没有执行构建后的 ModuleLoader factory，因此未覆盖该错误。

## 决策

- Project/Canvas Client 直接从纯 descriptor 模块 `remote-contract.ts` / `remote-v2-contract.ts` 读取 contribution，不再通过 Host Remote service 模块取得同一常量。
- 构建完成后扫描全部产品 Client bundle 的直接 `require()`；只允许 DSH ModuleLoader 平台 seed word，以及 Motion 在 `try/catch` 内显式吞掉的 `@emotion/is-prop-valid` 可选探测。
- Canvas Client 对必须内联的 `@convax/canvas-api` 与 `@convax/project/contracts` 建立显式 workspace-source alias，不能依赖另一个 workspace 已经残留 `lib/` 产物。这样单包构建和全新 checkout 都得到相同 bundle，也避免用 dev dependency 制造第二份 Cordis 类型上下文。
- 根 `yarn build` 必须执行该扫描，因此 `yarn check`、`yarn package:dir` 和开发构建都会在坏 bundle 进入桌面前失败。

## 边界

不改变 Typert descriptor、Remote namespace、Host service、profile、slot、权限或数据协议。修复只收紧 Host/Client 源码依赖方向和构建产物门禁。

## 验收

Project/Canvas 定向 build 与单测、Client bundle gate、根 `yarn check`、真实 upstream smoke 和目录打包启动验证均已串行通过。Canvas 还必须在删除自身、Canvas API 与 Project 的全部 `lib/` 后独立构建，并证明 bundle 不含任何 `require("@convax/…")`。另以 Electron CDP 执行真实 Renderer，确认页面 `readyState=complete`、不存在 “Failed to load plugins”，并保存验收截图 `module-loader-fix-verified.png`。
