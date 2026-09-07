# Canvas 图片 source 诊断与有限恢复（2026-09-07）

## 背景

重启后的图片失效有两类原因：持久化的本地 HTTP URL 指向已退出进程的随机端口；
或节点只保留会话内临时 asset ID，没有原始路径或图片字节。这不是 Canvas V2 JSON
或 SQLite schema 损坏。本文不记录实际 Workspace 标识、项目名称或媒体路径。

## 决策

- 旧 HTTP loopback source 使用精确 pathname，经当前 Canvas 所属 Workspace 的既有
  `readProjectFile` 重读派生预览；排除 credentials、query/hash、路径穿越与控制字符。
  Host 仍执行既有 workspace/path/symlink/类型/大小校验，无新文件路由或认证旁路。
  保留原始 URL；恢复失败维持原始 source，不根据标题推断替代内容。
- 新 Files 图片导入使用既有 `source: {type:'asset', assetId:'project-file:<相对路径>'}`
  预留命名空间。Workspace 由文档和 reader scope 提供，不接受 source 自带绝对根目录。
  它是原文件引用，不是资产复制；超出既有 512 字符 ID 上限明确拒绝，不降级为临时 ID。
- Client 最多两个并行重读，相同引用去重；节点移除、画布切换、dispose 撤销 object URL
  并取消待处理读取。临时 URL 和 bytes 不进入权威数据。失败不产生重试循环。
- 仅有临时 asset ID 时，文件名匹配不作为自动重绑依据。用户明确确认后才通过既有
  Canvas source 叶级 patch 与新鲜 revision CAS 重绑，保留节点几何信息和连线。

## 被否方案

- 重启旧随机端口或把临时 Blob URL 写入数据库：仍依赖进程生命周期。
- 自动按同名文件替换所有失效节点：缺少原资产到文件的权威映射。
- 把图片字节写入 DSH attachments 或上游存储：违反产品数据边界。

## 验收

- Canvas typecheck 通过，完整测试 17 files / 99 tests 通过。
- 根 `yarn check` 与 `yarn package:dir` 通过。
- 实机验证自定义目录树存在、17/17 图片解码成功；重新初始化 Renderer 后仍为 17/17。
- 经确认的重绑使用 Canvas API 原子提交，位置、大小和连线前后一致，无直接 SQLite 写入。

## 遗留风险

项目文件引用在原文件被移动或删除后仍会失效。外部 File 拖入仍使用 session-only
临时媒体；重启后长期保留外部图片需要单独设计 C2 产品资产存储、身份与迁移，
本次不引入数据库大字段或媒体服务。
