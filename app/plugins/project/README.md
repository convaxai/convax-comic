# `@convax/project`

Dual Host/Client Cordis plugin for the Convax Comic project shell. The Host exposes a strict, lease-scoped `projectFiles` Typert namespace backed by the canonical DSH workspace registry and `ctx.fs`. The Client owns the root workbench, dynamically publishes `comicProject`, and renders a lazy live project tree without browser filesystem access.
