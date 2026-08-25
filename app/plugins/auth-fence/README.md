# `@convax/auth-fence`

`@convax/auth-fence` is the sole `webServer` provider in Convax product
profiles. It replaces `@deepseek-ai/dsh-host-webserver` so authentication runs
before every HTTP route, static fallback, unknown pathname, and WebSocket
upgrade.

The launcher supplies `CONVAX_CONTROL_TOKEN` for one process launch. The value
must be a hex or base64url encoding of at least 32 bytes. Requests present the
exact value in `x-convax-control-token`. The plugin stores only a SHA-256 digest
for comparisons, never writes the token, never logs it, and never accepts it in
a URL.

The service binds `127.0.0.1` only; `port: 0` asks the OS for a random port.
After listening **and** the Cordis Loader tree settles, an IPC child sends only:

```json
{"type":"convax:ready","origin":"http://127.0.0.1:<port>"}
```

The provided `webServer` API remains compatible with upstream route,
fallback, upgrade, and index-injection consumers. Disposing its Cordis fiber
closes the listener, ordinary HTTP connections, and upgraded sockets.
A failed sibling row never emits misleading readiness.

Cordis, the upstream webserver contract, and Schemastery are exact peer
dependencies. The enclosing DSH workspace must provide them so this plugin
uses the same runtime identities instead of installing private copies.
