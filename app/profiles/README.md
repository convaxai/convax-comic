# Product profiles

- `compatibility` keeps the upstream client roster and UI slots untouched. It
  still replaces the unauthenticated Host web server, asks before high-confidence
  destructive shell commands, and mounts the private desktop Host service
  because those are mandatory product boundaries.
- `default` adds `appRuntime`, its lifecycle consumer, the Convax Comic browser
  brand plugin, and project/Canvas Host+Client plugins. `@convax/project` owns the
  documented `root` and `sidebar.workspaces` seats, exposes the active Workspace
  as a project-scoped Cordis service, and hosts the top project switcher plus live
  file tree. Canvas consumes that service and contributes only the center surface
  and the nested canvas navigator. The official DSH `ui-sidebar` shell stays
  enabled; the right `workbench.agent` occupant still declares the official
  `conversation` and `details` children plus an additive header-action seat.
  `compatibility` remains untouched.
- `default` also mounts the exactly pinned `dsh-codex-connect` provider under
  its canonical `llm-openai-codex` row. It does not replace the DeepSeek default
  model or global search route. Standalone Codex search, image viewing, and image
  generation are enabled, while proxy remains disabled. `compatibility` does not
  mount this provider.

All patch files are pure data. Config fields replace complete upstream config
rows; they are not deep merges. `security.patch.yml` is a shared, product-owned
final overlay applied after DSH's writable profile and home layers. It only
reasserts the mandatory web fence, command guard, conservative permission rows,
and the product Agent preset provider. M1 exposes only upstream `standard` and
`code`; the desktop does not accept external patch paths.

The desktop materializer derives package links from `insert[].name`. Installing
a plugin in `@convax/desktop` and adding its profile row is sufficient; there is
no shell-owned plugin allowlist.
