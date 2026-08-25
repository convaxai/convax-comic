# `@convax/command-guard`

This Host-only Cordis plugin asks the existing DSH approval service before
high-confidence destructive `bash` and `pwsh` calls. It is mounted by every
product profile and contributes through `tools/pre-execute`; it does not wrap
tools, execute commands, or create another permission service.

Covered families include recursive/forced deletion, destructive Git cleanup,
filesystem formatting/raw output writes, disk erase/repartition, recursive
ownership/mode changes, forced process termination, and their common
PowerShell forms. Multiple shell segments and a bounded nested `sh -c` form are
examined without evaluating the shell.

This is a prompt gate, not a complete shell security parser. Dynamic command
construction, command substitution, aliases/functions, `eval`, scripts, and
general-purpose interpreters can hide destructive behavior. The filesystem
sandbox remains the enforcement boundary; this plugin adds a human decision
for directly visible high-confidence commands and intentionally avoids
claiming malicious-code isolation.
