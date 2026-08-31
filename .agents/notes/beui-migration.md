# BeUI 整站迁移决策

日期：2026-08-31

## 决策

Convax Comic 的默认产品 UI 迁移到 BeUI 的视觉与 Motion 交互语言，但不把 BeUI 当作运行时黑盒依赖：按其 shadcn registry 的 source-owned 模式，将选中的公开 MIT 组件机制适配进产品自有 UI 层。

- 保留 Cordis 的插件、Service 与 Slot 边界；视觉重写不得把 Canvas、Project 或 Agent 业务硬编码进 Electron 壳。
- `app/packages/beui` 是不挂载、不提供 Cordis Service 的静态共享源码包；`@convax/ui` 只承担默认 profile 的品牌与全局主题适配。Project、Canvas 等独立 Client bundle 在构建时内联所需 BeUI 组件。
- React/ReactDOM 仍由 DSH Client ModuleLoader 提供，所有 Client bundle 必须 externalize，禁止打入第二份 React。
- BeUI 原始 Tailwind utility 不直接进入当前 tsdown Client：保留其交互、可访问性、reduced-motion 与 spring 机制，将样式改写为产品自有语义 class 和 CSS token。
- `motion/react` 与 `lucide-react` 是共享 UI 层的显式依赖；只引入实际使用组件，避免整库与 Shiki 等重依赖进入 Renderer。
- 上游 DSH 控件优先经文档化 Slot 替换；无法替换的部分先用 BeUI token 统一，再按业务复杂度逐个重写。`compatibility` profile 保持上游零呈现覆盖。

## 本次交付

1. 建立 BeUI token、spring/easing、Button、FileTree（含 shared-layout hover/selection）、Input、Switch 与 Tabs。
2. 用共享 FileTree 迁移 Project Files 与 Canvas/Node 列表，保留 `project.canvases` nested Slot。
3. 迁移 Canvas 高频按钮、工具栏动效以及 Project/Agent 安全叶子控件。
4. `@convax/ui` 经官方 `theme.overrideTokens` 生命周期 API 统一 Conversation、Settings、overlay 与上游控件色彩；完整替换 `conversation` 或 `sidebar.settings` 会同时移除上游拥有的子 Slot 声明，当前保留其业务 DOM，不做高风险壳重写。
5. Electron 独立启动/故障页同步 BeUI 视觉，并保留安全与 IPC 契约。

## 验收

- `corepack yarn check` 与 `git diff --check` 通过。
- Project 24/24、Canvas 75/75、Desktop 26/26 测试通过。
- default 与 compatibility 的 `dump-config` 在迁移前后 SHA-256 完全一致；compatibility 继续保持零产品呈现覆盖。
- Electron 实际验证 File Tree 键盘展开、hover shared-layout、Canvas 按钮、Agent 收合/恢复、Settings 弹窗、updater dismiss 与 reduced-motion。
- 验收截图：`artifacts/beui-canvas-verified.png`、`artifacts/beui-settings-verified.png`。

## 来源与许可

- BeUI 组件目录：<https://beui.dev/r>
- File Tree：<https://beui.dev/components/motion/file-tree>
- 源仓库：<https://github.com/starc007/ui-components>
- 公开组件采用 MIT License；复制或实质改写的源码保留来源注释与许可说明。BeUI Pro 私有组件不在本次范围内。
