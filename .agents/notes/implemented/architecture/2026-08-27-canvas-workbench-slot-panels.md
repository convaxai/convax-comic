# Canvas Workbench panel slot 化与视觉收敛

## 决策

- `default` 仍由 `@convax/canvas` 占据 DSH 文档化 `root` slot，但根组件只拥有
  panel 几何和 child slot 渲染权，不再直接拥有左侧项目树或右侧 Agent 内容。
- 根 entry 声明 `sidebar`、`workbench.agent`、`shell.overlay`。DSH 官方
  `ui-sidebar` 继续占据 `sidebar` 并声明品牌、浏览区、设置与 footer seats；
  Canvas 只注册 `sidebar.workspaces`，因此官方折叠 rail、新建会话、设置入口和
  品牌替换链保持可用。`default` 关闭原 `ui-workspace` 单一 occupant 以释放该
  seat；`compatibility` 不变。
- `workbench.agent` 是可替换单一 panel slot。默认 Agent panel 自己声明
  `conversation`、`details` 与 `workbench.agent.header.action`，新建会话按钮是
  一个有稳定 id/order 的 list contribution，而不是 panel 内的固定业务分支。
  根、panel、浏览区和 action 各自持有 disposer；父声明撤销时 child ledger
  递归坍缩，provider 恢复后 `slots.inject` 重新激活贡献。
- `WorkbenchLayout` 对外仍只承诺 DSH 的 `toggleSidebar/openDetails/
  closeDetails`。内部宽度采用 DSH 契约范围：sidebar 264–420、折叠 rail 56，
  Agent 340–520，中心最少 640；空间不足时先缩 Agent、再视觉关闭 Agent，保留
  preference 以便窗口回宽后自动恢复。1024 以下沿用 DSH 窄屏 rail 语义。

## 视觉取舍

- 只参考同级 Convax 的语义 surface 层级、6/8/12px 圆角、32/36px 控件、低层
  阴影、focus/pressed 状态和 graphite 下的 lime 产品强调色。
- 不引入 Convax 的 Tailwind、Radix、`@convax/ui` 依赖、业务 shell、Workbench
  controller、项目领域模型或完整主题系统。Canvas CSS 的底色、文字、边框、
  scrollbar 和 motion 继续绑定 DSH 已呈现到 DOM 的 `--dsw-*` token；lime 仅是
  产品强调 token，并按 `color-scheme` 选择明暗对比值。
- 卡片与工具栏使用同一语义 token，不再维护紫色渐变、任意 rgba 面板和互相
  冲突的媒体查询列宽。节点属性 inspector 不进入首版工作台，避免改变画布
  可视宽度和遮挡刚创建的节点。
- Canvas 顶部空白区与 Agent header 作为 Electron draggable region，交互按钮
  显式 `no-drag`；窗口拖动和双击最大化不新增 preload/IPC。Canvas 不呈现
  Hand/Select 模式按钮：默认编辑态始终允许节点选择、拖动和连线；按住空格时
  临时关闭节点 mutation，并让左键拖拽平移，编辑态中键仍可平移。滚轮/触控板
  平移且普通滚轮不缩放。视图条提供适应视图、连线显隐、确定性横/纵整理、与
  Convax 一致的 8px 网格吸附、小地图和缩放预设。整理使用当前平面 schema 上
  的无依赖算法，批量写回领域坐标；交互状态、连线显隐、吸附和小地图开关不
  进入 `CanvasDocumentV1`。
- Node resize 对齐 Convax 的 `NodeResizer` 契约：仅单选节点显示，边线有 14px、
  角点有 18px 的透明命中区；图片保持宽高比，文本自由缩放，最小尺寸 160×96。
  resize 过程中持续写回 position 与 size（包含从左/上缩放引起的位置变化），
  禁用卡片几何 transition，并由 gesture baseline 合并为一个撤销步骤。
- Comic 新建域只含 note/image。V1 video 仅保留 parse-only 兼容，Client、侧栏、
  外部文件 drop 与 Agent create tool 均不再暴露；在正式迁移前保留旧 JSON，
  避免为了界面收敛静默销毁用户数据。
- 撤销/重做属于 Client 工作区交互历史，不扩展持久 schema。普通领域提交进入
  最多 100 步历史；React Flow 连续拖动用 gesture baseline 合并为一步，viewport
  平移/缩放不占用历史。节点与关联边删除是一次原子提交。

## 验收

- Client 测试证明 root → Agent panel → header action 的递归声明、注册与卸载，
  以及 Canvas 对 `sidebar.workspaces` 的独立贡献。
- 几何纯函数覆盖常规宽度、Agent 收缩、Agent concession 和 56px rail；layout
  测试覆盖窄屏切换、宽度 clamp 与 details 生命周期。
- 交互纯函数覆盖单一编辑/空格平移策略、Convax 核心快捷键与横/纵整理；store
  测试覆盖批量移动、拖动/缩放 gesture undo/redo、视频新建拒绝和节点/边原子删除。
- 节点 click distance 与 drag threshold 固定使用同一个 4px 策略；否则 D3 会先吞掉
  带微抖的 click，而 React Flow 尚未开始 drag，产生完全不响应的指针死亡区。
- default `dump-config` 只把 `ui-sidebar: disabled` 改为
  `ui-workspace: disabled`；compatibility 输出逐字不变，`auth-fence` 仍在场。
