# Canvas V2 Remote 协议收缩

## 背景

Canvas Browser 已统一通过 `CanvasClientService` 的 `getDocument`、`applyPatch` 与 `waitForRevision` 完成乐观写入和同步，但 `canvasV2` Typert namespace 仍镜像了 Host 的 node/edge 便利 CRUD。六个端点没有产品调用方，却持续扩大浏览器 wire/type/schema 表面。

## 决策

- 从 `canvasV2` Remote 删除 `createNode/updateNode/removeNode/createEdge/updateEdge/removeEdge`，descriptor 集合收敛为 12 个 project/document/Patch/waiter 方法。
- 这是 private package 上一次有意的破坏式 wire/type contract 收缩，不把它描述成无兼容意义的局部死代码。
- Host `canvasHost.nodes/edges`、`@convax/canvas-api` 扩展契约、类型 registry、Agent tools 与级联删边语义全部保留；Host 插件仍可使用便利 CRUD。
- Remote 对 node/edge add 的严格边界改由 `applyPatch` schema 正例覆盖，危险 key、Patch 数量/大小、结果 revision 与真实 Connection envelope 覆盖不降级。

## 被否方案

- **连 Host CRUD 一并删除**：会破坏外部 Host 插件的正式扩展 seam，并把便利原子语义迫回各调用方。
- **给六个 Remote 端点保留 deprecated wrapper**：仓库没有消费者或稳定发布承诺，兼容层只会延续双写协议面。
- **让 Agent 逐个调用浏览器 CRUD**：会丢失 active project/canvas 双重 CAS，且错误地把 Host 权威改成浏览器路由。

## 可证伪的验收证据

- Typert descriptor 精确为 12 个，六个 wire name 在生产 Remote、生成类型与 Gateway descriptor 中归零。
- `applyPatch` 继续验证 node/edge add，Renderer 同步、八个 Agent tools 和外部 Host/Client 扩展生命周期测试全绿。
- profile、auth-fence、preload、产品数据目录与 dump-config 不变。

## 遗留风险

仓库外若存在未记录的浏览器调用者会收到破坏性 API 变化；当前包为 private，正式扩展 seam 已明确为 `canvasHost`/`canvasClient`。未来若需要独立于 Patch 的浏览器原子语义，应带真实消费者重新设计，而不是恢复镜像。
