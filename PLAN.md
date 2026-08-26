# Convax Comic 基座计划

## 总结

Convax Comic 是基于 DeepSeek Harness（DSH）与 Cordis 的 AI 漫画桌面
产品。本次迁移只建立可运行、可打包、带认证边界的公共基座；漫画工作流、
项目模型和编辑器需求尚未由产品规格定义，因此不在迁移中臆造实现。

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
- `default` 当前仍使用上游主要 UI，只替换最小品牌 slot。漫画产品 UI
  必须作为 Client 插件加入；优先使用上游文档化 slot / route。
- 若整窗漫画编辑器无法由现有 slot 承载，可在同一 Host 与鉴权层后提供
  Comic 自有路由；不得把领域 UI 塞进 Electron bootstrap。
- profile 是纯数据，patch 按 id 整行覆盖；新增普通插件只改依赖与 profile。

### 数据

- `userData/harness` 与 DSH 会话 JSONL 由上游拥有，可在升级时重建。
- 漫画项目、角色、场景、分镜、媒体资产和导出物必须由未来领域插件放在
  产品自有目录；具体 schema 与迁移策略在产品需求明确后另记 Agent Note。
- 后端文件能力优先使用上游 `ctx.fs`，Electron 不新增产品文件 API。

## 路线图

| 里程碑 | 内容 | 出口条件 |
| --- | --- | --- |
| B0（本次） | 导入公共基座；隔离 Convax Comic 名称、bundle id 与 userData | 全量门禁、真实运行与目录打包通过 |
| C1 | 明确 Comic MVP 工作流、数据模型与整窗 UI 承载方案 | 产品规格与 UI spike 有可评审证据 |
| C2 | 首个端到端漫画项目工作流 | 可创建、编辑、持久化并导出最小项目 |
| C3 | 签名、公证、自动更新与 Windows x64 | 双平台可分发 |

C1 之前不预设具体模型供应商、图片生成服务、资产 schema 或协作协议。

## B0 测试与验收

- `corepack yarn install --immutable` 不修改 lockfile。
- `yarn check` 通过构建、typecheck、生命周期、profile、布局和
  `dump-config` 基线门禁。
- `yarn smoke:upstream` 用两个 profile 启动真实 npm DSH，验证 hostile
  home patch 无法关闭 fence、放宽权限或启用不安全 Agent preset。
- `yarn package:dir` 生成 `Convax Comic.app`，并在隔离 HOME/CWD、空 PATH、
  无全局 Node/pnpm/上游 checkout 的条件下验证 DSH、PTY、鉴权和数据边界。
- `compatibility` 保持上游 Client 零覆盖；`default` 的组合差异全部可解释。
- preload 暴露面、权限 profile、host/port、source/npm pin 与补丁清单相对
  导入基座无变化。

## 门禁与决策记录

- 门禁路由见 [`AGENTS.md`](AGENTS.md)。
- 架构理由、取舍与可证伪证据写入 `.agents/notes/`；历史基座 Notes 保留
  原名，迁移后的新决策不得回写旧 Note。

## 假设与默认值

- 当前只是桌面基座，不代表 Comic 产品 UI 已完成；初次运行仍可能显示
  上游 DSH 的通用设置与会话界面。
- `@convax/*` 包命名空间、`CONVAX_*` 环境变量、IPC 与 token header 是
  通用基座协议，本次不分叉；应用身份与用户数据由新 bundle id 隔离。
- 插件按可信本地代码处理；控制面鉴权和保守 Agent 权限仍不可豁免。
