---
name: gate-composition
description: 组合门禁。修改 cordis.yml、任何 *.patch.yml、profile、插件挂载，或变更 provide/inject 服务名前必读；按清单逐项执行并附证据。
---

# Gate: Cordis 组合

## 触发

- 新增/删除/禁用任何插件 entry；
- 修改任何 profile 或 patch 文件；
- 插件代码里 `provide`/`inject` 服务名的增删改；
- `dump-config` 输出结构的任何预期变化。

## 清单

1. **dump-config 前后对照**：改动前后各跑一次 `dump-config`，diff 附在
   提交或 PR 描述里。无 diff 说明改动无效或跑错了 profile，回头查。
2. **兼容模式不受伤**：`compatibility` profile 跑一遍，仍为上游默认
   client 零覆盖；`auth-fence` 在每个 profile 里都在场。
3. **静态校验**：entry id 全树唯一且可解析；无可执行表达式；平台/渠道
   条件用声明式字段。
4. **覆盖语义**：patch 按 id 整行替换 config。若发现需要深合并，那是
   插件 config schema 的设计问题，回到 schema 解决，不改合并规则。
5. **服务名变更**：确认没有第二个提供方占用同名（duplicate-provide 直接
   报错是预期行为，不许绕过）；消费方在服务缺失时的 `PENDING` 行为有
   测试覆盖。
6. **生命周期**：新挂载的插件有卸载回收测试——effect、事件监听、计时器
   在 dispose 后全部释放；provider 恢复后消费方重新激活。
7. **层归属**：产品 entry 使用 `app-` 前缀 id；不得占用或覆盖用户 patch
   层的 id 空间。

## 证据

PR 描述必须包含：dump-config diff、跑过的 profile 清单、新增服务名及其
提供方/消费方列表。缺证据的组合改动拒绝合入。
