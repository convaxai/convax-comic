# 控制面鉴权替换 WebServer provider

## 背景

上游 `@deepseek-ai/dsh-host-webserver` 只提供 route registry，没有全局
middleware。browser-trust 只处理 Host/Origin 信任，不是身份认证；未知
路径和 WebSocket upgrade 也不能通过新增一条普通 route 完整覆盖。同时，
浏览器 WebSocket API 不能设置任意 Authorization header，初始 HTML 导航
发生在 preload 代码运行之前。

## 决策

- 每个产品 profile 禁用上游 `webserver` 行，并挂载
  `@convax/auth-fence` 提供同名 `webServer` 服务契约。
- provider 固定绑定 `127.0.0.1:0`，在任何 HTTP route/fallback 和任何
  WebSocket upgrade 分发前校验 `x-convax-control-token`；失败统一 403。
- token 每次 child 启动由 Electron bootstrap 生成 256 bit 随机值，经
  子进程环境传入。唯一 renderer 可见的 token 面是受限 preload 的只读
  launch context；Electron main 同时通过 `session.webRequest` 为当次精确
  origin 注入 header，以覆盖初始导航与原生 WebSocket upgrade。
- readiness IPC 只携带 origin，不携带 token。崩溃重启同时轮换 token、
  随机端口和精确 origin 白名单。
- 桌面入口只接受两个命名 profile，显式拒绝外部 `--patch`。上游还会在
  profile 之后加载可写的 `$DSH_HOME/cordis.patch.yml`，因此桌面只追加一份
  随应用资源发布的 `security.patch.yml` 作为最终 overlay；上游每次热重组
  仍将它放在两个可写层之后，重新断言 webserver 禁用、auth-fence 启用和
  保守权限姿势。
- `commands/execute` 不做例外：它处于同一 fence 后；产品权限表也删除
  `danger-full-access` 静默切换目标。

## 被否方案

- **仅保护 `/api`，静态资源匿名**：不满足“每个 HTTP 请求”门禁，且给
  后续新增控制面路径留下默认开放。
- **覆盖浏览器 transport**：会修改 compatibility Client 行为并复制上游
  fetch/WebSocket carrier，升级耦合过高。
- **query token 或持久 cookie**：会进入 URL、历史或磁盘，扩大泄露面。
- **修改 submodule / 上游 patch**：当前 provider 替换即可完成，不应引入
  补丁债务。

## 可证伪的验收证据

- 真实 server 对缺失/错误 token 的已知、未知 HTTP 路径都返回 403。
- 缺失 token 的 upgrade 在 handler 前收到 HTTP 403；正确 token 才进入
  upgrade handler。
- 日志、URL、profile、产品数据目录均搜索不到启动 token。
- compatibility 的 dump 不含任何产品 Client UI 行或上游 UI row 覆盖。
- 桌面参数单测证明外部 `--patch` fail-closed；监督器固定且仅固定追加一个
  绝对路径的产品安全 overlay。
- dump 与真实 npm DSH smoke 都预置会重新开启 webserver、禁用 fence 并将
  权限降为 `danger-full-access/never` 的 home patch，最终组合仍保持产品
  安全行，403/200 行为不变。
- `kill -9` 后旧 token 无效，新 origin 自动成为唯一导航白名单。

## 遗留风险

Electron `webRequest` 对 WebSocket header 的行为属于 Electron 升级回归
项；每次 Electron pin 更新必须以真实 upgrade smoke 重验，不能只跑单测。
M1 目录产物尚未签名；最终 overlay 的资源完整性在 M4 由签名/公证闭合。
