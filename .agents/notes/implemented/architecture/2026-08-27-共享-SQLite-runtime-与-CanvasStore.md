# 共享 SQLite runtime 与显式 CanvasStore provider

## 背景

Canvas C1 以单个 JSON 文件验证了 Host 权威、revision 和产品目录边界，但完整
文档 replace、写前修改内存以及每个领域插件自行管理数据库都会放大后续项目、
资产和工作流插件的持久化成本。当前尚无稳定用户数据兼容负担，可以直接把
SQLite 作为默认权威，而不保留运行时自动 JSON fallback。

## 决策

- 新增 Host-only `@convax/sqlite-runtime`，提供全局 `sqliteRuntime` Cordis
  service。它只拥有产品数据根、路径规范、连接、application id、顺序
  `user_version` migration、事务、checkpoint 和 lease 生命周期，不拥有任何
  领域表。
- 每个 consumer 使用小写 owner/name 和 product/project scope acquire 独立
  数据库。路径固定在
  `$CONVAX_PROJECTS_HOME/<project>/.stores/sqlite/<owner>/<name>.sqlite3`；不接受
  任意绝对路径或可逃逸 segment，目录与文件分别收敛到 `0700`/`0600`。
- `sqliteRuntime.acquire(ownerContext, spec)` 在返回前完成连接、PRAGMA、
  application id 与 migration；lease 自动绑定 owner Fiber。owner 卸载关闭自己
  的 lease，runtime 卸载兜底关闭全部 lease；同一路径的并发 acquire 明确失败。
- `compatibility` 与 `default` 都挂载 `app-sqlite-runtime`。该插件没有 Client
  face，且没有 consumer 时不打开数据库，因此 compatibility 仍保持上游 Client
  零呈现覆盖。
- 新增 contract-only `@convax/canvas-store-api` 和 required provider
  `@convax/canvas-store-sqlite`。默认 profile 的链路为
  `sqliteRuntime -> canvasStore -> canvas`；缺任一 provider 时下游保持 `PENDING`，
  provider 恢复后按 Cordis 生命周期重新激活。
- CanvasStore 使用 Canvas-owned migration 与表，持久化 project JSON 和独立
  revision，并在一个 SQLite transaction 内执行 CAS。Canvas Host 把完整 mutation
  串行化，先在临时候选 workspace 计算 next state，持久成功后才发布内存状态；
  写失败时文档和 revision 均保持不变。
- 本次不读取、双写或自动回退旧 `canvas.canvas.json`。SQLite 打开、migration、
  IO 或损坏属于明确故障；SQLite 成为权威后不得因 provider 缺失或故障切换到
  另一份 JSON。JSON 后续只可作为显式导入/导出 provider 或一次性迁移输入。
- 其他插件如需 SQLite，注入 `sqliteRuntime` 并 acquire 自己的独立数据库；如需
  Canvas 数据，必须注入领域 `canvasHost`/`canvasClient` service，不能直接读取 Canvas 表。

## 生命周期与故障语义

- runtime 缺失：CanvasStore `PENDING`，Canvas 也 `PENDING`；
- runtime 卸载：先撤销 `sqliteRuntime`，CanvasStore 和 Canvas 递归卸载，lease
  关闭；
- runtime 恢复：CanvasStore 重新 acquire 同一 owner 数据库，Canvas 重新读取
  持久 authority；
- migration 失败：当前 migration transaction 回滚，`user_version` 不前进；
- mutation 失败：SQLite transaction 回滚，Canvas 内存/project/revision 不发布；
- duplicate provider 或 duplicate owner acquisition：fail loud，不做仲裁。

## 验收证据

- sqlite runtime 单测覆盖根目录、路径穿越、owner 隔离、application id、连续
  migration、DDL/DML 回滚、write rollback、重复 acquire、owner/runtime dispose、
  provider 卸载/恢复和数据保留；
- CanvasStore 单测覆盖 initialize、持久 revision、CAS conflict、重启恢复、
  required runtime `PENDING`/恢复和 duplicate provider；
- Canvas 单测覆盖写失败不发布状态、并发 mutation 串行，以及 runtime -> store
  -> Canvas 两级 provider 卸载/恢复后数据不丢；
- 组合门禁记录 default/compatibility dump-config 前后差异；compatibility 不新增
  Client package，auth-fence 与最终安全 overlay 不变。

## 后续实现

Canvas 已采用 V2 `type + kindVersion + plugin-owned data`、受限 leaf Patch、
revision waiter、Host/Client registry 与 edge map；SQLite runtime/CanvasStore 的
契约未因 schema 重构而改变。Store row 现以 `(workspaceId, projectId)` 为复合主键，
provider 在 initialize/commit/read 时严格验证 V2 payload 身份及 revision。
