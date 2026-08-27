# Convax Comic 基座计划

## 总结

Convax Comic 是基于 DeepSeek Harness（DSH）与 Cordis 的 AI 漫画桌面
产品。公共基座已经可运行、可打包并具备认证边界；当前在该基座上完成 C1
画布交互切片，验证漫画领域 UI 能以独立 Host + Client 插件进入 DSH，而
不侵入 Electron bootstrap。同一项目内的多个画布已经由 Host 持久化；完整项目模型、
持久资产库和漫画工作流仍留给后续规格。

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
  plugins/
    agent-presets/  只读安全 Agent roster
    auth-fence/     HTTP / WebSocket token 鉴权
    command-guard/  高风险 shell 命令审批
    runtime/        appRuntime 服务
    test-consumer/  生命周期证明插件
    ui/             当前最小 Comic 品牌 slot
    canvas/         Canvas Host service、Agent tools、React Flow UI 与 V1 schema
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
- `default` 由 Canvas Client 接管文档化 `root` slot，但 panel 内容不硬编码
  进壳：左侧继续使用 DSH 官方 `ui-sidebar` 外壳，Canvas 仅注册
  `sidebar.workspaces` 的漫画项目浏览器；中间是 React Flow 画布；右侧由
  `workbench.agent` 单一 slot 承载可替换 Agent panel，并由该 panel 继续声明
  官方 `conversation`、`details` 和可追加 header action slots。产品 `layout`
  service 保持上游三方法契约，并按 DSH 的宽度、窄屏 rail 与 concession 顺序
  管理 panel。该替换只存在于 default，`compatibility` 仍保留上游 Client
  roster 与呈现零覆盖。
- `default` 额外挂载精确 pin 的 Codex Connect provider，默认模型仍为
  DeepSeek、全局搜索仍走 DeepSeek；独立搜索、图片查看与图片生成能力启用，
  proxy 保持关闭，OAuth 只能由用户在设置中显式发起。`compatibility` 不挂载
  该第三方 provider。
- 漫画产品 UI 必须作为 Client 插件加入；不得把领域 UI 塞进 Electron
  bootstrap，也不得自建 Plugin Host、Catalog 或消息 broker。
- profile 是纯数据，patch 按 id 整行覆盖；新增普通插件只改依赖与 profile。

### 数据

- `userData/harness` 与 DSH 会话 JSONL 由上游拥有，可在升级时重建。
- Canvas 首版定义严格的 `CanvasDocumentV1`，只包含版本、领域节点、边和
  viewport；React Flow 的选择、拖动中间态、组件、`File` 与 `blob:` URL
  永不进入文档。最小 `CanvasProjectV1` 只负责 active canvas 与多个独立文档，
  不混入树展开态或 React Flow UI 状态。Host 的 `ctx.canvas` 是唯一写入权威，经 DSH 官方
  Typert/Remote 同步 Client，并以 revision 防止陈旧覆盖。
- Canvas 交互以 Convax 的单一编辑态为基线：节点始终可选择、拖动和连线，
  不呈现 Hand/Select 工具状态；按住空格时临时以左键平移画布，编辑态中键仍
  可平移、左键框选。视图条提供适应视图、连线显隐、确定性横/纵整理、8px
  网格吸附、小地图和缩放。节点 resize 使用宽透明命中区，图片等比、文本自由
  缩放，并在 gesture 内连续提交位置与尺寸；拖动/缩放历史各合并为一次 undo step。
- 画布项目原子写入 `$CONVAX_PROJECTS_HOME/default/canvas.canvas.json`，权限
  为 `0600`；它与 `userData/harness`、DSH session JSONL 完全分离。其他 Host
  插件可注入 `canvas` service，Agent 通过 `canvas_list/create/select` 与
  `canvas_get/create_node/update_node/delete_nodes/connect` 工具读写当前画布。
- 外部图片文件以 opaque asset id 进入文档，`File` 与 object URL 仅在
  插件的临时资源表中存在，并在节点失去引用或插件卸载时释放。后续持久化
  必须把资产写入产品自有目录，不得写入 DSH storage、attachments 或会话。
  V1 中已有的 video 节点仅作无损读取兼容，不再呈现，也不能由 UI、外部拖入
  或 Agent tool 新建；正式 schema 迁移前不静默删除旧数据。
- 漫画项目、角色、场景、分镜、媒体资产和导出物最终必须由领域插件放在
  产品自有目录；持久 schema 与迁移策略在项目工作流明确后继续演进。
- 后端文件能力优先使用上游 `ctx.fs`，Electron 不新增产品文件 API。

## 路线图

| 里程碑 | 内容 | 出口条件 |
| --- | --- | --- |
| B0（本次） | 导入公共基座；隔离 Convax Comic 名称、bundle id 与 userData | 全量门禁、真实运行与目录打包通过 |
| C1（当前） | Host-owned Canvas、React Flow 画布与三栏工作台 | 同一项目可持久化多个画布，可新建/操作文本与图片节点、外部拖入图片，Agent/插件经 service 操作当前画布 |
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
- Canvas 的文档/项目 schema、Host 多画布持久化/revision、Remote 同步、Agent 工具、外部
  拖拽解析、临时媒体释放与 root slot 卸载均有 headless 测试；React Flow
  依赖完整内联到动态 Client bundle，不产生孤立 CSS。单一编辑/空格平移策略、
  核心快捷键、整理布局、批量移动、拖动/缩放历史、无点击/拖动阈值死亡区与非零 viewport 高度有回归测试。
- preload 暴露面、权限 profile、host/port、source/npm pin 与补丁清单相对
  导入基座无变化。

## 门禁与决策记录

- 门禁路由见 [`AGENTS.md`](AGENTS.md)。
- 架构理由、取舍与可证伪证据写入 `.agents/notes/`；历史基座 Notes 保留
  原名，迁移后的新决策不得回写旧 Note。

## 假设与默认值

- 当前只完成桌面基座与 Canvas 文档持久化切片，不代表完整 Comic 项目模型、
  持久媒体资产库或端到端漫画工作流已完成。default 固定进入三栏工作台；
  需要上游原始界面时显式启动 `compatibility` profile。
- `@convax/*` 包命名空间、`CONVAX_*` 环境变量、IPC 与 token header 是
  通用基座协议，本次不分叉；应用身份与用户数据由新 bundle id 隔离。
- 插件按可信本地代码处理；控制面鉴权和保守 Agent 权限仍不可豁免。
