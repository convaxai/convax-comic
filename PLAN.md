# Convax Comic 基座计划

## 总结

Convax Comic 是基于 DeepSeek Harness（DSH）与 Cordis 的 AI 漫画桌面
产品。公共基座已经可运行、可打包并具备认证边界；当前在该基座上完成 C1
画布交互切片，验证漫画领域 UI 能以独立 Host + Client 插件进入 DSH，而
不侵入 Electron bootstrap。同一项目内的多个画布已经由 Host 经可插拔
`canvasStore` 持久化到产品目录内的 SQLite；完整项目模型、持久资产库和漫画
工作流仍留给后续规格。

基座继承 `convax/convax-next` 的可审计提交历史，并保持以下结构：

```text
Electron bootstrap（app/desktop，尽量薄）
  ├── 生成每次启动的一次性 token
  └── 用独立 Node 24.9.0 启动固定 DSH 运行时
        └── Cordis Context
              ├── 上游插件（原样）
              ├── desktop Host 插件
              ├── auth-fence / command-guard
              ├── 通用产品插件
              └── 未来 Comic 领域插件

Electron Renderer（sandbox、无 Node）
  └── http://127.0.0.1:<random-port>
        ├── compatibility：上游 Client 零覆盖
        └── default：产品插件按 slot / route 渐进替换
```

## 当前基线

| 项目 | 固定值 |
| --- | --- |
| DSH npm 运行闭包 / source commit | `0.1.1-rc.2` / `b150a551…` |
| Electron | `43.4.0` |
| 打包 Node | 独立 `24.9.0`，不使用 `ELECTRON_RUN_AS_NODE` |
| 首发平台 | 未签名 macOS ARM64 目录产物 |
| profile | `compatibility` / `default` |
| 上游补丁 | 空 |
| default 附加模型 provider | `dsh-codex-connect@0.1.0-alpha.4.20` |

产品仓库不包含上游源码。`upstream.json` 记录 npm 版本与 source commit
映射；需要读源码或运行上游构建时，可在仓库同级放置可选的
`../deepseek-harness` checkout。最终应用只使用精确版本的 npm 依赖闭包，
全部位于应用 `Resources` 内。

## 仓库拓扑

```text
app/
  desktop/          Electron bootstrap、监督器与私有 Host 服务
  packages/
    beui/            默认 UI 的 source-owned BeUI token、Motion 与共享 React primitives
  plugins/
    agent-presets/  只读安全 Agent roster
    auth-fence/     HTTP / WebSocket token 鉴权
    command-guard/  高风险 shell 命令审批
    runtime/        appRuntime 服务
    test-consumer/  生命周期证明插件
    ui/             默认 profile 的 Comic 品牌 slot 与 BeUI 全局主题适配
    canvas-api/     JSON-only V2 contract、leaf Patch 与 Host/Client 扩展接口
    sqlite-runtime/ 通用 owner-scoped SQLite 生命周期、migration 与事务运行时
    canvas-store-api/ Canvas 持久化 provider 契约
    canvas-store-sqlite/ 基于 sqliteRuntime 的默认 CanvasStore provider
    project/        DSH Workspace 项目切换、受限文件树 Host 与 workbench Client
    canvas/         项目作用域 Canvas V2、Typert Remote、Agent tools 与 React Flow UI
    canvas-builtins/ 可独立卸载的 note/image/sequence Host 类型与 Client renderer
  profiles/         compatibility / default / 最终安全 overlay
patches/            上游补丁清单（默认空）
upstream.json       npm 运行版本与外部源码 commit 映射
.agents/            门禁与决策记录
```

## 基座边界

### 桌面壳

- Electron 只负责目录、随机 loopback 端口、token、子进程监督、窗口安全、
  崩溃恢复和失败页。
- Preload 仅暴露失败页操作和只读启动上下文；没有通用 IPC、文件或 shell
  能力。
- 子进程以进程组监督，父进程退出后必须回收整棵运行时进程树。

### 安全

- 上游 Web 控制面无认证，`auth-fence` 必须在 HTTP 与 WebSocket 分发前
  拒绝无效 token。
- token 每次启动随机生成，只通过 preload / Electron 请求头注入；不得
  落盘、进入日志或 URL。
- Host 固定 `127.0.0.1` 随机端口；权限固定保守的
  `workspace-write + ask`，用户 home patch 不能放宽最终安全 overlay。
- Renderer 保持 `sandbox`、`contextIsolation`、无 Node，并只允许当前
  精确 origin。

### 组合与 UI

- `compatibility` 始终保留上游 Client roster，作为升级和排障退路。
- `default` 的产品界面采用 source-owned BeUI 视觉与 Motion 交互层：公开 MIT 组件经
  `app/packages/beui` 适配为无 Tailwind 运行时依赖的共享 primitives，各物理 Client
  插件在构建时内联所需实现，React 仍使用 DSH ModuleLoader 单例；上游控件先经官方
  theme token 收敛，再按文档化 Slot 逐个替换，`compatibility` 不挂载任何该呈现层。
- `default` 由 Project Client 接管文档化 `root` 与 `sidebar.workspaces` slot，
  但 panel 内容仍不硬编码进壳：顶部项目选择器投影 DSH Workspace，切换时通过
  官方 `workspaces.connectWorkspace` / `sessions.open` 同步当前会话；左侧为项目
  文件目录与嵌套 `project.canvases` seat；Canvas 只向 `workbench.center` 和该
  nested seat 贡献 React Flow 画布与画布列表。右侧由 `workbench.agent` 单一
  slot 承载可替换 Agent panel，并继续声明官方 `conversation`、`details` 和
  可追加 header action slots。Project 提供与上游三方法兼容的 `layout` service，
  按 DSH 的宽度、窄屏 rail 与 concession 顺序管理 panel。该替换只存在于
  `default`，`compatibility` 仍保留上游 Client roster 与呈现零覆盖。
- Active Project 是由 Project Client 根据当前 Session 所属 Workspace 提供的
  required `comicProject` Cordis service；切换撤销旧 provider，使 Canvas Fiber
  在完整 cleanup（含长轮询取消和乐观写收敛）后按新 scope 重启，不额外维护
  全局 ActiveSet 或消息 broker。
- `default` 额外挂载精确 pin 的 Codex Connect provider，默认模型仍为
  DeepSeek、全局搜索仍走 DeepSeek；独立搜索、图片查看与图片生成能力启用，
  proxy 保持关闭，OAuth 只能由用户在设置中显式发起。`compatibility` 不挂载
  该第三方 provider。
- 漫画产品 UI 必须作为 Client 插件加入；不得把领域 UI 塞进 Electron
  bootstrap，也不得自建 Plugin Host、Catalog 或消息 broker。
- profile 是纯数据，patch 按 id 整行覆盖；新增普通插件只改依赖与 profile。

### 数据

- `userData/harness` 与 DSH 会话 JSONL 由上游拥有，可在升级时重建。
- C1 的项目绑定直接复用 DSH Workspace 身份：`workspaceId` 是注册目录的稳定
  Workspace UUID，Canvas 的根项目固定为 `project:root`。浏览器只向 Host 发送
  Workspace ID 与受限相对路径；Host 从 `workspaceRegistry` 取规范根目录，以
  `ctx.fs.resolve/contains/listDir` 做权威的一层读取，绝不跨 Typert 返回绝对路径
  或内部 target。Chokidar `followSymlinks:false` 只发送批量失效提示，目录项仍
  以 `ctx.fs` 重读为准；Client 懒加载展开分支、虚拟化可见行，并在序列缺口、
  watcher 错误或恢复焦点时 reset/refetch。删除后以同一路径重新注册会获得新的
  DSH UUID，C1 不自动别名或迁移旧 Canvas；这类 orphan/rebind 归 C2 项目目录
  catalog 与显式迁移流程处理。
- Canvas 使用严格的 `schemaVersion: 2` Contract：项目与文档各自带 revision，
  node/edge 以 ID map 保存 `type + kindVersion`、核心几何和 JSON-safe 插件 data；
  React Flow 选择、历史、拖动中间态、组件、`File` 与 `blob:` URL 永不持久化。
  Host 的 `ctx.canvasHost` 是唯一权威，执行叶级 Patch、文档/project 双重 CAS、
  原子 active-canvas mutation 与 committed-after-persist 事件；Client 的
  `ctx.canvasClient` 使用乐观 overlay、串行写入、单一有界 waiter 和 session-only
  undo/redo，经严格 Typert `canvasV2` namespace 同步。旧 V1 payload 返回稳定的
  `UNSUPPORTED_SCHEMA_VERSION`，没有自动迁移、JSON fallback 或双写。
- Canvas 交互以 Convax 的单一编辑态为基线：节点始终可选择、拖动和连线，
  不呈现 Hand/Select 工具状态；按住空格时临时以左键平移画布，编辑态中键仍
  可平移、左键框选。视图条提供适应视图、连线显隐、确定性横/纵整理、8px
  网格吸附、小地图和缩放。节点 resize 使用宽透明命中区，图片等比、文本自由
  缩放，并在 gesture 内连续提交位置与尺寸；拖动/缩放历史各合并为一次 undo step。
- `sqliteRuntime` 是 Host-only 通用能力，为每个 owner/name 在产品目录下提供
  独立 SQLite 数据库、顺序 migration、受控事务、WAL checkpoint 和绑定 Cordis
  Fiber 的 lease；它不拥有任何领域表，也不允许路径逃逸。`compatibility` 与
  `default` 均挂载该无呈现能力，只有消费者 acquire 后才打开数据库。
- Canvas 通过 required `canvasStore` 契约使用默认 `canvas-store-sqlite` provider，
  权威数据位于 `$CONVAX_PROJECTS_HOME/default/.stores/sqlite/canvas/canvas.sqlite3`
  并保持 `0600`；SQLite 以 `(workspaceId, projectId)` 复合身份隔离项目，写入前
  严格验证 V2 payload 身份与 revision。provider 缺失时 Canvas 保持 `PENDING`，
  打开、迁移或写入失败时明确失败，绝不自动切换 JSON。其他 Host 插件注入
  `canvasHost` 注册类型或执行权威操作；Client 插件注入 `canvasClient` 注册 renderer。
  Agent 仍通过精确八个 `canvas_list/create/select` 与
  `canvas_get/create_node/update_node/delete_nodes/connect` 工具读写同一权威；
  每次执行按 `exec.agent.session.header.cwd` 经 `workspaceRegistry.resolveByPath`
  解析 scope 并惰性初始化根项目，绝不跟随另一个浏览器全局选择。
- `@convax/canvas-builtins` 是独立 physical plugin：Host 贡献
  `comic.note@1`、`comic.image@1`、`comic.sequence@1`，Client 对称贡献 renderer。
  type registry 以 `(type, kindVersion)` 建键，插件缺失或版本不匹配的既存 data
  无损只读，仍可移动、resize、连接和原子删除；外部图片 `File` 与 object URL
  只在临时资源表存在并在失去引用或插件卸载时释放。后续持久资产必须写入
  产品自有目录，不得写入 DSH storage、attachments 或会话。
- 漫画项目、角色、场景、分镜、媒体资产和导出物最终必须由领域插件放在
  产品自有目录；持久 schema 与迁移策略在项目工作流明确后继续演进。
- 后端文件能力优先使用上游 `ctx.fs`，Electron 不新增产品文件 API。

## 路线图

| 里程碑 | 内容 | 出口条件 |
| --- | --- | --- |
| B0（本次） | 导入公共基座；隔离 Convax Comic 名称、bundle id 与 userData | 全量门禁、真实运行与目录打包通过 |
| C1（当前） | DSH Workspace 项目切换、实时文件树、Host-owned Canvas、React Flow 画布与三栏工作台 | 多个绑定目录可在顶部切换，左侧目录实时失效重读，画布按项目隔离持久化；可新建/操作文本与图片节点、外部拖入图片，Agent/插件按其 Session 项目经 service 操作当前画布 |
| C2 | 首个端到端漫画项目工作流 | 可创建、编辑、持久化并导出最小项目 |
| C3 | 签名、公证、自动更新与 Windows x64 | 双平台可分发 |

C2 之前不预设具体模型供应商、图片生成服务、持久资产 schema 或协作协议。

## B0 测试与验收

- `corepack yarn install --immutable` 不修改 lockfile。
- `yarn check` 通过构建、typecheck、生命周期、profile、布局和
  `dump-config` 基线门禁。
- `yarn smoke:upstream` 用两个 profile 启动真实 npm DSH，验证 hostile
  home patch 无法关闭 fence、放宽权限或启用不安全 Agent preset。
- `yarn package:dir` 生成 `Convax Comic.app`，并在隔离 HOME/CWD、空 PATH、
  无全局 Node/pnpm/上游 checkout 的条件下验证 DSH、PTY、鉴权和数据边界。
- GitHub CI 在 Node 24.9 跑完整 headless 门禁，在 Node 22.19/26 跑兼容构建、
  类型与单测，并在 `macos-15` ARM64 runner 跑最终目录打包 smoke；稳定的
  `all checks passed` 聚合任何 failure、cancelled 或 skipped 结果。
- `compatibility` 保持上游 Client 零覆盖；`default` 的组合差异全部可解释。
- SQLite runtime 的路径隔离、application id、顺序 migration、事务回滚、lease
  回收与 provider 卸载/恢复，以及 CanvasStore workspace 复合身份/CAS、Canvas
  两级 required provider `PENDING`/恢复均有 headless 测试。Project Host 的
  Workspace 根解析、relative path/containment/symlink 防逃逸、lazy list、事件
  批量/序列 reset、watcher 与长轮询 disposer，以及 Client 项目/session 对齐、
  切换 race 与虚拟化文件树均有 headless 测试。Canvas V2 的严格 schema/leaf
  Patch、Host 多画布 revision/active CAS、Typert Remote、单 waiter、
  乐观 Client、builtins 生命周期、Agent 工具、外部拖拽、临时媒体释放与 root
  slot 卸载均有 headless 测试；React Flow
  依赖完整内联到动态 Client bundle，不产生孤立 CSS。单一编辑/空格平移策略、
  核心快捷键、整理布局、批量移动、拖动/缩放历史、无点击/拖动阈值死亡区与非零 viewport 高度有回归测试。
- preload 暴露面、权限 profile、host/port、source/npm pin 与补丁清单相对
  导入基座无变化。

## 门禁与决策记录

- 门禁路由见 [`AGENTS.md`](AGENTS.md)。
- 架构理由、取舍与可证伪证据写入 `.agents/notes/`；历史基座 Notes 保留
  原名，迁移后的新决策不得回写旧 Note。

## 假设与默认值

- 当前只完成桌面基座、DSH Workspace 项目绑定/目录浏览与 Canvas 文档持久化
  切片，不代表完整 Comic 项目模型、持久媒体资产库或端到端漫画工作流已完成。
  default 固定进入三栏工作台；
  需要上游原始界面时显式启动 `compatibility` profile。
- `@convax/*` 包命名空间、`CONVAX_*` 环境变量、IPC 与 token header 是
  通用基座协议，本次不分叉；应用身份与用户数据由新 bundle id 隔离。
- 插件按可信本地代码处理；控制面鉴权和保守 Agent 权限仍不可豁免。
