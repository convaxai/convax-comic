# BeUI Chat App Agent 侧边栏与当前项目历史

日期：2026-09-02

## 决策

- `@convax/project` 继续占据 `workbench.agent`，但将 panel body 改为 source-owned
  `@convax/beui` `ChatApp` 窄壳组合；新 primitive 只负责 inset、off-canvas navigation、
  焦点恢复、Escape 与 reduced-motion，不拥有会话业务。
- DSH 官方 `conversation` 与 `details` single slots 保持唯一业务权威；`conversation`
  沿用上游 `session-maybe` scope 以保留无会话 hero，`details` 继续使用 `session` scope。
  History 打开时 Chat App 只对 inset 设置 `inert` / `aria-hidden` 并覆盖 navigation，两个 slot 的 React
  子树持续挂载，因此 streaming、draft、queue/steer/cancel、附件、模型/权限、计划、
  todo、question、approval、tool card、details 和 subagent 状态继续由上游维护。
- History 范围固定为 Active Project 对应的当前 Workspace。列表直接派生自
  `workspaces.list.items[].sessionIds`、`sessions.list.byId` 与
  `workspaces.list.archivedSessionIds`：隐藏 archived、`origin === 'subagent'` 和非当前
  blank session，按 `updatedAt` 降序及 id 稳定排序。切换只调用 `sessions.open(sessionId)`，
  不调用 `connectWorkspace`，不会改变 Project/Canvas scope。
- `workbench.agent.header.action` 保持 list extension seat；New Session 仍调用
  `ComicProjectRuntime.newSession()`，仅通过 owner prop 在成功后关闭 history。History
  trigger 与 Agent collapse 是 Project shell 自有安全叶子控件。
- Project root 与 pinned DSH AppFrame 保持 details 清理语义：持续观察当前 nonblank session，
  当已观察的 nonblank session id 发生变化时在 layout effect 中调用 `layout.closeDetails()`；
  blank 过渡不覆盖最后观察值，因而不会改变 rc.2 的首会话与 New Session 行为。
- 官方 composer 仍拥有 textarea、命令菜单、附件、mode/model、queue 与 send/stop 处理；
  Project 只通过上游稳定的 `data-composer-card` / slot / aria 契约附加 BeUI semantic classes，
  可见 surface、focus ring、32px actions 与 send/stop swap 由 `BEUI_COMPONENT_CSS` 提供。
  上游实际由 backdrop 绘制可见输入文字、透明 textarea 绘制 caret、hidden mirror 负责高度；三层必须共享
  完全相同的 font/padding/line-height/wrapping，不能只覆盖 textarea 与 mirror，否则文字和光标会错位。
  命令加号监听 `aria-expanded`，按 BeUI Prompt Input 的 0°↔45° swap 做 overshoot 动效，
  并在 reduced-motion 下直接切换终态；窄于 430px 的 composer 将 model trigger 折叠为保持
  完整 `aria-label` 的 32px `AI` 图标，底部 actions 强制保持单行。折叠后 model menu 通过
  `ResizeObserver` 和实际边界测量校正在 composer 左右 8px safe area 内；加号菜单最多 480px、
  随 composer 收缩，并解除说明字段的 ellipsis，空间不足时完整换行而不遮挡。上游在 model menu
  展开期间会暂时卸载 quota control；adapter 只保存最后一次进度、颜色及相对位置叶子值，并用
  无交互、绝对定位且不参与 flex layout 的 CSS placeholder 保持 48×6px 用量条连续绘制；打开前按
  trailing 右边缘记录所有稳定 control 的位置，quota 暂时卸载时用 individual `translate` 逐项补偿，
  因而 speed、model、context、send 均不漂移。关闭菜单后立即交回真实 control，避免闪烁、重叠和响应式反馈环。
- Agent 空态 headline 由 Project 改写为“实现你的任何想法”（英文为 “Bring any idea to life”）；
  上游 `hero.chooseWorkspace` 按钮在 Agent 内标记并隐藏，使 Project sidebar 成为唯一项目切换入口。
  DOM observer 和 Fiber cleanup 同时负责 React 重绘后的重应用与原文/标记恢复。
- Project 左栏的 FILES/CANVASES 仍各自滚动；两处分区标题使用相同的 10px 水平 inset 和
  stretch hitbox。CANVASES sticky 标题以 sidebar base 色覆盖滚动内容，避免透明标题下的
  首行文字与图标穿透重叠。
- Agent 宽度、resize、显式 collapse/reopen、窄屏 concession 与 details 生命周期继续
  完全由既有 `ProjectLayout` 拥有，本次不新增 Host Service、持久化 schema、profile、
  Electron/preload 或安全边界。

## 取舍

- 不替换完整 `conversation` slot。该 occupant 同时声明内部 child slots，并封装完整
  InputHub/chat-store 流程；复制会造成两个会话权威并让上游能力漂移。
- 不为 history 新建 Host RPC、缓存或 Project 持久表。Workspace/Session stores 已是
  组合后的事实源，Client 派生避免 session membership 与 archive 状态双写。
- 不在 300–640px 的 Agent panel 内常驻双栏。参考 BeUI Chat App 的 responsive posture，
  history 使用全宽 off-canvas navigation；打开时 conversation 保持 mounted 而非 hidden
  条件渲染，适合可收起、可 resize 的窄侧栏。

## 验收契约

- BeUI 测试覆盖 Chat App SSR 语义、conversation 持续挂载、`inert`、Escape、焦点恢复、
  来源注释与 drawer motion。
- Project 纯函数测试覆盖当前 Workspace 过滤、archive/subagent/blank 过滤、状态与稳定排序；
  Client 注册测试覆盖 `workbench.agent` 对现有 runtime/sessions/workspaces 的注入；CSS 与
  source contract 覆盖 Chat App seat、history trigger、官方 slots 和 reduced-motion。
- default 与 compatibility profile dump 必须与实现前 hash 一致；`auth-fence`、compatibility
  零呈现覆盖和现有 Agent geometry 测试必须保持不变。
