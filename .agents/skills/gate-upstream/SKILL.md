---
name: gate-upstream
description: 上游门禁。变更 deepseek-harness submodule pin、patches/ 清单、Electron 或打包 Node 版本前必读；按清单逐项执行并记录升级 Note。
---

# Gate: 上游依赖

## 规则

- 上游 submodule 永不在 feature 分支内修改；pin 更新单独成提交，
  与桌面行为变更分开。
- 对上游的本地修补只能以 `patches/` 显式清单存在；每个补丁记录
  产生原因与上游 issue 链接。

## 升级清单

1. **补丁复核**：列出当前 `patches/` 全部条目；升级后逐条先尝试删除，
   仍需保留的更新其理由与上游 issue 状态。
2. **变更阅读**：读上游 CHANGELOG / breaking notes；rc 之间也可能破坏，
   不因版本号小而跳过。
3. **回归**（全部 headless）：
   - 真实启动到 Web 可访问；
   - `dump-config` 与升级前基线 diff，逐行解释非预期变化；
   - 插件生命周期测试全绿；
   - `compatibility` profile 零覆盖可跑；
   - gate-security 清单全项重验（fence、权限、暴露面）；
   - 打包产物在无全局 Node/pnpm/上游 checkout 的机器上启动。
4. **运行时决策复核**：Electron / 打包 Node 升级时重述「独立打包 Node
   而非 ELECTRON_RUN_AS_NODE」的 ABI 理由是否仍成立。
5. **记录**：升级写一篇 Agent Note（日期、版本区间、补丁 diff、回归
   结果、遗留风险），放入 `.agents/notes/`。

## 证据

PR 描述必须包含：pin 变更区间、补丁清单前后对照、回归结果汇总、
Agent Note 链接。
