# Agent Notes

架构与流程决策记录，对齐参考仓库 `anywhere-labs/deepseek-harness-desktop`
的分工：**契约（AGENTS.md / PLAN.md）只保留规则，理由与取舍写进 Note**。

## 约定

- 文件名：`YYYY-MM-DD-主题.md`，中文撰写。
- 新决策先落在本目录根；对应实现合入后移至 `implemented/architecture/`
  或 `implemented/process/`。
- 每篇 Note 包含：背景、决策、被否方案与否决理由、可证伪的验收证据、
  遗留风险。
- 修订历史决策时新开一篇并互相链接，不改写旧 Note。

## 待写清单（随里程碑产出）

- 外层包管理器选型（Yarn vs Bun，M1 前）
- 独立打包 Node 的 ABI 理由（M1）
- 画布 Client 插件缝 spike 结论（M1.5）
- 单进程崩溃域评估结论（M1.5）
- legacy 四内核包复用决策（M2）
