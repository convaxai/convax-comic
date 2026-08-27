# `@convax/agent-presets`

M1 Agent preset roster. It exposes only upstream `standard` and `code`, both of
which consume the Host sandbox and approval services. The upstream `minimal`
and `cordis` presets and the writable user preset root are intentionally absent
because they can bypass the product permission posture.

At Host startup the wrapper resolves the upstream service through
`$DSH_HOME/profiles/node_modules`, the same materialized module fallback used
by the DSH Host. This keeps `dsh-scope` process identity shared with Agent Loop
even when the product repository uses workspace-local dependency isolation.
