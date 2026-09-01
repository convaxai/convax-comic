# Project 窄屏契约与 Canvas 旧壳收口

## 背景

Project Client 接管 `root`、`layout`、项目侧栏与 Agent panel 后，Canvas 仍保留迁移前的整窗壳、布局状态机、项目浏览器、Agent panel 和对应 CSS。旧入口已不可达，但旧布局测试仍是仓库里唯一覆盖 56px rail 与窄窗 concession 的测试；与此同时 Project 的 `narrow` 状态没有参与实际列宽计算，现行实现并未完整承接 PLAN 中的窄屏契约。

## 决策

- Project 是通用 workbench 几何的唯一所有者。列宽由 shell 实测宽度、用户的 panel 开关与偏好宽度共同求解；窄窗只改变本次渲染列宽，不回写偏好。
- 空间不足时先把已打开 panel 压缩到最小宽度，再视觉让出 Agent；仍不足时把 sidebar 收敛为 56px rail。窗口恢复后自动恢复用户原有开关和偏好宽度。
- 删除 Canvas 中不可达的整窗壳、旧项目浏览器、旧 Agent/action、旧布局类与只固定这些实现的测试。Canvas 继续只贡献 `workbench.center` 与 `project.canvases`。
- CSS 按真实 DOM selector 清理，保留 `CanvasCenter`、`CanvasProjectCanvases` 与 Canvas overlay/launcher 仍消费的规则。

## 被否方案

- **直接删除旧布局测试而不补 Project 契约**：会掩盖现行窄窗行为与 PLAN 不一致的问题。
- **让 concession 改写 `sidebarOpen`、`agentOpen` 或偏好宽度**：窗口恢复后无法还原用户意图。
- **按历史行号整段删除 Canvas CSS**：变量组和相邻规则被新旧组件共享，容易误删仍在生产使用的样式。

## 可证伪的验收证据

- Project 几何测试覆盖宽窗偏好、按比例压缩、Agent concession、56px rail 与回宽恢复。
- Client entry 仍只注册 `workbench.center` 与 `project.canvases`；旧 Canvas 壳符号和 `layout.ts` 归零。
- Canvas/Project build、typecheck、test 与根 `yarn check` 全绿；两个 profile 的 dump-config 无新增差异。

## 遗留风险

当前 concession 按单窗口本地宽度求解，不持久化自动让步状态。若未来需要用户可配置的移动端断点，应进入 Project layout 的显式产品契约，而不是重新在 Canvas 内维护第二套壳。
