---
name: gate-security
description: 安全门禁。触碰 auth-fence、preload 暴露面、导航白名单、agent 权限 profile、端口/host 参数或任何控制面可达性的改动前必读；按清单逐项执行。
---

# Gate: 安全边界

## 背景（不可遗忘的前提）

上游 dsh web 控制面**没有内建鉴权**（上游讨论 #853/#2829；browser-trust
fence 的源码自述 "not an auth layer"）。任何能访问 loopback 端口的本机
进程都能创建会话、驱动 agent 执行 shell、自我批准审批。`auth-fence` 是
本产品唯一的认证层。

## 清单

1. **fence 不可绕过**：「无 token 本机请求被拒」测试保持通过；新增的
   任何 HTTP/WebSocket 端点都必须位于 fence 之后，逐个列出并说明。
2. **token 生命周期**：只由 bootstrap 每次启动生成；只经 preload 只读
   注入；不落盘、不进日志、不进 URL query。
3. **preload 暴露面**：diff 逐项说明理由，默认答案是「不加」。任何新
   暴露必须是只读或幂等操作。
4. **导航白名单**：仍为当次启动的精确 loopback origin；重启后旧 origin
   失效并由 bootstrap 更新。
5. **权限 profile**：不得引入静默提权入口（`commands/execute` 一类）；
   审批策略的任何放宽必须在 PR 里明示并记 Agent Note。
6. **网络面**：`--host` 恒为 `127.0.0.1`；`trustedHosts` 不新增条目；
   端口保持随机分配。
7. **联动**：上游升级后本清单全项重验（由 gate-upstream 触发）。

## 证据

PR 描述必须包含：fence 测试结果、preload 暴露面 diff 及理由、权限
profile diff。任何一项缺失即拒绝合入。
