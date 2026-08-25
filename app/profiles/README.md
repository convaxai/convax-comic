# Product profiles

- `compatibility` keeps the upstream client roster and UI slots untouched. It
  still replaces the unauthenticated Host web server, asks before high-confidence
  destructive shell commands, and mounts the private desktop Host service
  because those are mandatory product boundaries.
- `default` adds `appRuntime`, its lifecycle consumer, and the Convax browser
  brand plugin. It disables the one upstream row occupying those documented
  brand slots.

All patch files are pure data. Config fields replace complete upstream config
rows; they are not deep merges. `security.patch.yml` is a shared, product-owned
final overlay applied after DSH's writable profile and home layers. It only
reasserts the mandatory web fence, command guard, conservative permission rows,
and the product Agent preset provider. M1 exposes only upstream `standard` and
`code`; the desktop does not accept external patch paths.

The desktop materializer derives package links from `insert[].name`. Installing
a plugin in `@convax/desktop` and adding its profile row is sufficient; there is
no shell-owned plugin allowlist.
