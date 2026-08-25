# DSH Desktop + Cordis 新项目骨架（v2）

## 总结

新建独立仓库，不迁移旧 Convax。参考基线从社区壳 `dsh-desktop` 改为
[DSH 官方 examples](https://github.com/deepseek-ai/deepseek-harness/tree/master/examples)：
Electron 薄壳完全自写；产品能力全部按官方示例的范式以 Cordis 插件 + `--patch`
组合进 DSH 进程。各示例对应的参考用途：

| 官方示例 | 在本项目中的参考用途 |
| --- | --- |
| `web-schedule` | 产品 overlay 插件的标准挂载范式（backend 插件 + `dsh web --patch <yml>`），`app-ui`/`app-runtime` 照此结构 |
| `headless-agent` | 纯 `cordis.yml` 声明式组合一个完整 agent 的范式，`app-bundle` 照此维护产品组合 |
| `jsonrpc-agent` | SDK/JSON-RPC 程序化驱动 harness 的范式，Electron Main 的监督通道与未来自动化测试参考 |
| `web-cordis` | 插件树自省能力，`dump-config` 与诊断面的实现参考 |
| `acp-agent` | 备选的程序化控制面（会话/权限/取消），暂不采用，保留调研记录 |
| `mcp-memory` | 通过官方 `dsh-mcp-client` 挂第三方 MCP 服务器的配置范式 |

```text
Electron Main（自写薄壳）
  ├── 生成一次性鉴权 token
  └── 启动并管理 DSH Web 子进程
        └── Cordis Context
              ├── DSH 内置插件
              ├── app-auth-fence（token 鉴权，P0）
              ├── 产品插件（app-bundle / app-runtime / app-ui）
              └── 用户插件

Electron Renderer（sandbox，无 Node）
  └── 加载 http://127.0.0.1:<random-port>（preload 注入 token）
        └── DSH Web Client Cordis 插件
```

画布不进入骨架，也不进入 Electron Host；后续作为普通 DSH 插件加入，
但其 UI 可行性 spike 是 M1 之后的第一任务（见「风险验证」）。

## 实现方案

### 薄桌面壳（自写，不继承 dsh-desktop）

- 不复制 `dsh-desktop` 代码，不继承其 loader 解析补丁与 HMR fallback。
  如遇相同问题，以显式 patch 文件清单（patch-package 式）修复并留 diff
  审计记录，每次 DSH 升级逐条验证可否删除。
- 固定依赖（exact + lockfile）：
  - `@deepseek-ai/dsh@0.1.1-rc.2`
  - `@deepseek-ai/cordis@4.0.1`
  - Electron `43.4.0`
  - 打包 Node `24.9.0`
  - 决策记录：独立打包 Node 而非 `ELECTRON_RUN_AS_NODE`，原因是 DSH
    原生模块的 ABI 需求；接受双运行时体积，禁止后续「顺手优化」掉。
- Electron Main 仅负责：
  - 创建 `userData/launch-root` 和 `userData/harness`
  - 生成本次启动的一次性鉴权 token（见「安全边界」）
  - 分配随机 `127.0.0.1` 端口
  - 启动 `dsh web --no-open --host 127.0.0.1 --port <port> --patch <app.patch.yml>`
  - 健康检查、日志、崩溃重启、退出与子进程回收
  - 子进程重启后向 Renderer 广播新 origin 并触发自动重连导航
  - 展示启动失败页
- Renderer 开启 `sandbox`、`contextIsolation`，关闭 Node；导航仅允许本次
  启动生成的精确 loopback origin（重启后由 Main 更新白名单）。
- Preload 只暴露：启动失败页的重试/查看日志/退出，以及当前 origin +
  token 的只读注入。不提供文件、画布或插件 API。
- 预留但不实现「native affordance 窄 IPC 缝」：拖出到 Finder、系统菜单、
  剪贴板、deep link 等只能在 Electron 实现的能力，未来经一个显式声明的
  窄 typed IPC 进入，不得散点打洞。此预留写入仓库架构说明，防止
  「Electron 零产品逻辑」教条被破窗式突破。

### 安全边界（P0，进 M1 验收）

- DSH web 控制面自身无鉴权（官方 README 明示，参见上游讨论 #853/#2829），
  loopback + browser-trust fence 不是认证层，任何本机进程可驱动 agent
  执行命令。因此：
  - `app-auth-fence` 插件：校验每个 HTTP/WebSocket 请求的 token header，
    无效即 403；token 由 Main 每次启动生成并只经 preload 注入 Renderer。
  - 验收测试：无 token 的本机 curl 请求被拒；持 token 请求正常。
- Agent 权限姿势在产品 patch 中显式声明保守组合：默认工作区限定、
  危险命令需审批；禁用（或 fence 拦截）`commands/execute` 一类可静默
  提权的入口。不继承开发者工具默认。

### Cordis 组合

- 使用一个产品 `cordis.patch.yml` 挂载产品插件（对齐 `web-schedule` 的
  挂载方式），不建立自定义 Plugin Host、Catalog、ActiveSet 或 broker。
- 四个最小本地包：
  - `app-bundle`：声明 DSH bundle 并维护产品插件组合（对齐 `headless-agent`
    的组合范式）。
  - `app-auth-fence`：token 鉴权 fence（见上）。
  - `app-runtime`：注册 `ctx.appRuntime`，提供应用名称、版本和运行模式。
  - `app-ui`：DSH Client Cordis 插件，只通过现有 UI slot 增加最小品牌
    标记，用于证明客户端插件装载成功（对齐 `web-schedule` 的 client 面）。
- 增加一个测试消费插件，声明 `inject = ['appRuntime']` 并直接调用
  `ctx.appRuntime`，验证插件间无需 Electron Host 转发。
- 开发态支持配置热重载；生产态插件异常进入明确失败页并提供日志，
  不允许静默跳过必需插件。
- 提供 `npm run dump-config`，输出最终 Cordis 插件树，作为组合真源
  （实现参考 `web-cordis` 的自省能力）。

### 数据边界

- 产品文档数据（未来画布等）永不落在 DSH 拥有的目录（`userData/harness`、
  会话 JSONL）内；由对应插件自管独立数据目录。DSH 升级可自由重建
  harness 目录而不触碰产品数据。

### 文件与未来画布边界

- 后端文件插件直接注入 DSH 已有的 `ctx.fs`；Electron Host 不新增
  `readFile/writeFile/listDirectory`。
- 目录树插件未来只在确实需要树状态、监听和增量投影时注册
  `ctx.folderTree`；普通文件读写继续直接使用 `ctx.fs`。
- 其他后端插件通过 Cordis `inject` 直接调用这些服务。必需服务缺失时
  插件保持 `PENDING`；提供方卸载时消费者及其 effects 一并撤销。
- 浏览器插件无法跨进程直接持有后端对象。需要 UI 的插件自己提供 DSH
  remote contract（backend/client 双面实现，范式对齐 `web-schedule`），
  不经过 Electron Host。
- 后续画布使用单独的 `@app/canvas` DSH bundle：
  - Node 入口注册 `ctx.canvas`
  - `/client` 入口通过 DSH UI slot 渲染画布
  - Agent 操作注册到 `ctx.tools`
  - 其他插件通过 `inject = ['canvas']` 使用
  - 加入画布只修改插件依赖和 Cordis 配置，不修改 Electron 壳

## 风险验证（M1 之后立即执行）

1. **画布级 UI 在 DSH Client 插件缝内的可行性 spike**：整窗编辑器、
   React Flow 量级依赖、手势与渲染性能。若 slot 承载不了，验证退路：
   harness 服务一个完全自控的独立页面/路由。此赌注失败则重画拓扑，
   因此必须最早拿到证据。
2. **单进程崩溃域评估**：用户插件崩溃对 UI 与（未来）画布数据的影响；
   画布落地时再决定是否值得独立进程。

## 测试与验收

- Cordis 生命周期测试：
  - provider/consumer 配置顺序不影响启动
  - 缺少必需服务时 consumer 为 `PENDING`
  - provider 卸载会释放 consumer 的事件、计时器和注册
  - provider 恢复后 consumer 重新激活
- 桌面壳测试：
  - 仅监听随机 loopback 端口
  - 无 token 请求被拒；持 token 请求通过（P0）
  - readiness 超时、崩溃、重启、退出和日志路径正确
  - 强杀（kill -9）DSH 子进程后自动重启，Renderer 自动重连新 origin，
    无产品数据丢失
  - 外部 URL 交给系统浏览器
  - Renderer 无 Node 权限，非当前 Harness origin 导航被拒绝
- 集成测试：
  - 启动真实 DSH，等待 Web 页面可访问
  - `dump-config` 包含产品 bundle、`app-auth-fence`、`app-runtime`
    和 `app-ui`
  - 测试消费插件成功调用 `ctx.appRuntime`
  - 打包产物在无全局 Node、DSH 和 Cordis 环境下仍能启动
  - DSH 升级回归入口：真实启动 + 配置装配 + 插件生命周期 + 补丁清单
    逐条复核（自动化脚本）
- 第一里程碑验收：
  - `npm install && npm run dev` 直接打开 DSH UI
  - 用户能通过 DSH 原生 Workspace 能力添加目录并启动 Agent，
    且权限姿势为产品 patch 声明的保守组合
  - Electron 源码不存在产品文件操作、画布逻辑或插件间转发
    （native affordance 预留缝除外，当前为空实现）
  - 新增一个普通 Cordis 插件只需安装依赖并修改产品 patch

## 假设与默认值

- 首版仅做骨架，不包含画布、旧数据迁移、协作协议、Marketplace、
  自更新和移动端。
- Cordis 插件按可信本地代码处理，不承诺恶意插件隔离；但控制面鉴权
  （P0）与保守权限姿势不因此豁免——前者防的是插件体系之外的本机进程。
- 首先验证 macOS ARM64，随后验证 Windows x64；不同架构分别安装依赖
  和打包。
- DSH 与 Cordis 使用精确版本和 lockfile；对上游的任何本地修补必须以
  显式 patch 文件清单存在，升级必须经过真实启动、配置装配、插件生命
  周期回归与补丁逐条复核。
