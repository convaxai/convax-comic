# React Flow 画布与数据边界

## 背景

首个 Comic 领域 UI 需要验证四件事：DSH 的桌面即插件模式能承载产品工作台，
Agent 与其他插件能操作同一个 Canvas 权威，外部文件能直接拖入，React Flow
运行时对象不会污染未来项目数据。画布文档需要跨启动恢复，但临时媒体仍不能
写进 DSH 会话与 storage。

## 决策

- 新增独立 `@convax/canvas` Host + Client 插件，只在 `default` profile
  挂载。Host 提供 `ctx.canvas`；Client 通过 DSH 官方 Typert manifest 与
  `RemoteService` 访问，不自建 HTTP route、RPC 或 broker。
- Canvas Client 接管文档化 `root` slot，声明 conversation/settings 所需的
  子 slot，并提供兼容 `layout` service。工作台固定为左侧项目/文件与画布树、
  中间画布、右侧上游官方 conversation；`compatibility` 不做这些替换。
- 固定 `@xyflow/react@12.11.3`；更新的 12.11.5 尚在 Yarn 发布冷却期内，
  不为追新绕过供应链门禁。React Flow 是交互适配层，领域真源是严格
  `CanvasDocumentV1`；文档只含 `version`、文档 id/标题、节点、边和 viewport。
- 节点是 `note | image | video` 判别联合。外部集成使用版本化 MIME payload，
  Finder/文件管理器拖拽只接受白名单图片和视频类型及明确大小上限；导入
  文档、节点数和边数也有硬上限，避免外部 JSON 无界占用渲染进程。
- 本地 `File`、object URL、选择/拖动态和 React component 留在浏览器临时
  资源表。文档只保存 opaque asset id，节点标题/alt 留作领域展示字段；失去
  引用或插件卸载时 revoke object URL。
- `CanvasService` 是唯一写入权威：严格解析后原子写入
  `$CONVAX_PROJECTS_HOME/default/canvas.canvas.json`，以 `0600` 权限与 revision
  乐观并发控制保护项目。项目文件使用严格 `CanvasProjectV1` 包含 active id 与
  多个独立 `CanvasDocumentV1`，并兼容读取首版单文档文件。该目录由产品拥有，
  与 DSH home/session 分离。
- 全局注册 `canvas_list`、`canvas_create`、`canvas_select`、`canvas_get`、
  `canvas_create_node`、`canvas_update_node`、
  `canvas_delete_nodes`、`canvas_connect`，让 Agent 与注入 `canvas` 的 Host
  插件操作同一个 service，而不是绕过 schema 直接改文件。
- React Flow 受控属性使用稳定回调与细粒度 memo；只更新 viewport 或 edge
  时保留未变化 graph slice 的引用，避免 selection/viewport effect 与领域
  snapshot 互相触发更新循环。
- Client 的受控 store 与 Host 以完整 V1 文档同步；画布列表、新建和切换由
  Remote 的独立严格方法承载。产品界面不暴露底层 JSON 导入/导出入口；持久
  资产服务必须另行落到产品目录，并重新走安全与数据评审。

## 被否方案

- **继续使用 overlay 承载 Canvas**：无法形成左树、中画布、右 Agent 的稳定
  产品信息架构。default 明确由产品 Client 接管 root，并主动复用官方
  conversation；Electron bootstrap 不参与领域 UI。
- **新增独立 Host pathname / RPC**：DSH 已提供 Typert/Remote 与 service
  注入；自建协议会制造第二套控制面和生命周期。
- **直接持久化 React Flow JSON**：其中包含 measured、selected、dragging 等
  表现态，升级库版本会把项目 schema 一并绑死。
- **把 `File`、base64 或 `blob:` URL 写进文档**：不可跨进程或跨启动恢复，
  还会制造体积、隐私与释放问题。

## 验收证据

- `compatibility` 不增加 Canvas Client；`default` 新增 `app-canvas` 并仅关闭
  会争用 root/sidebar 的上游布局行。
- schema、Host persistence/revision、Remote 同步、外部 payload、节点操作、
  临时媒体释放与插件 disposer 均有 headless 测试。
- Electron 实机已验证三栏工作台、新建 Note、画布树同步以及文档以 `0600`
  落入产品目录；新建上游会话不要求模型 Key。
- JSON round-trip 不含 `blob:`、`File` 或 React Flow 表现态；未知字段被严格
  拒绝且不破坏原文档。

## 遗留风险

- 画布文档会恢复，但本地拖入的媒体字节与 object URL 仍是浏览器会话态；
  重启后 opaque asset id 不足以恢复预览。
- 后续资产服务需要真实格式嗅探、容量治理、视频 Range 响应和产品目录存储，
  届时必须命中组合与安全门禁。
