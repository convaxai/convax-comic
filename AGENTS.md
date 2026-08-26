# Convax Comic 开发契约

本仓库是基于 DeepSeek Harness（DSH）+ Cordis 的 AI 漫画桌面产品。
[`PLAN.md`](PLAN.md) 是当前唯一的计划真源；桌面基座继承自
`convax/convax-next`，主参考仍为
[`anywhere-labs/deepseek-harness-desktop`](https://github.com/anywhere-labs/deepseek-harness-desktop)
的仓库拓扑与“桌面即插件”模式。

## 仓库形态

| 路径 | 状态 |
| --- | --- |
| `app/` | 产品代码：`desktop/`、`plugins/`、`profiles/` |
| `upstream.json` | 上游源码 commit 与 npm 运行版本的映射真源 |
| `patches/` | 上游补丁显式清单，默认为空 |
| `PLAN.md` | 计划真源 |
| `.agents/skills/gate-*` | 组合、安全与上游门禁 |
| `.agents/notes/` | 决策与验收记录 |

## 硬规则

1. **产品仓库不保存上游源码 checkout。** 可选审计源码只能位于同级
   `../deepseek-harness`；源码 commit 与 npm 版本记录在 `upstream.json`，
   pin 更新与产品行为变更分开提交。本地修补只能存在于 `patches/` 显式
   清单并留审计记录。
2. **桌面即插件。** Electron bootstrap 归 `app/desktop` 所有且保持薄；
   漫画领域能力不得写进 bootstrap。
3. **兼容模式必须永远可跑**：`compatibility` profile 使用上游默认 Client、
   零呈现覆盖；Comic UI 只经自有 Client 插件和 profile 替换文档化 slot
   或路由。
4. **控制面 token 鉴权不可绕过、不可降级。** `auth-fence` 是产品唯一认证
   层，任何 profile 不得移除；Agent 权限由产品 profile 显式声明。
5. **Renderer 保持 `sandbox` + `contextIsolation` + 无 Node**；导航仅允许
   当次启动的精确 loopback origin。
6. **漫画项目数据永不落上游拥有的目录**（`userData/harness`、会话
   JSONL）；领域插件使用产品自有目录和 schema。
7. **一切产品能力都是 Cordis 插件，组合即配置**；`dump-config` 是组合
   真源；不自建 Plugin Host、Catalog、ActiveSet 或 broker。
8. **配置是纯数据**：无可执行表达式；条件使用声明式字段；patch 按 id
   整行覆盖 config，不做深合并。
9. **插件按可信本地代码处理**：信任决策发生在安装/挂载时，不承诺恶意
   插件运行时隔离。
10. **新增普通插件的成本恒定**：安装依赖 + 修改 profile patch，不改壳。
11. **一切检查 headless-safe**：构建、typecheck、测试、Loader smoke 不得
   拉起图形界面；GUI 启动保持显式。
12. **通用基座与漫画领域分层**：安全、监督、profile 物化等通用代码保持
   领域无关；漫画项目模型、资产、编辑器和导出能力进入独立产品插件。

## 门禁路由

改动前先命中门禁，多个命中时全部执行：

| 改动触碰 | 必读并逐项执行 |
| --- | --- |
| `cordis.yml`、任何 `*.patch.yml`、profile、插件挂载、`provide`/`inject` 服务名 | [`gate-composition`](.agents/skills/gate-composition/SKILL.md) |
| `auth-fence`、preload、导航白名单、权限 profile、端口/host、控制面可达性 | [`gate-security`](.agents/skills/gate-security/SKILL.md) |
| `upstream.json`、`@deepseek-ai/*` 版本、`patches/`、Electron / 打包 Node 版本 | [`gate-upstream`](.agents/skills/gate-upstream/SKILL.md) |

## 工作流

1. 动手前读 `PLAN.md` 对应章节与命中的门禁 skill。
2. 架构与流程决策写入 `.agents/notes/`；规则留在契约，理由与取舍进入
   Agent Note。计划或边界变化必须与实现在同一变更内更新。
3. 大方向变更前先提交；上游 source/npm pin 更新始终单独提交。
4. 提交信息使用中文 conventional 格式。
5. 验证以根 package scripts 为准；最低要求是无意外 `dump-config` diff、
   壳测试、插件生命周期与 fence 测试全绿。
