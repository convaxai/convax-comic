export const name = '@convax/desktop'
export const inject: readonly string[] = []

interface CordisContext {
  effect(callback: () => void | (() => void)): void
}

export function apply(ctx: CordisContext): void {
  ctx.effect(() => {
    const onDisconnect = () => {
      // The Electron parent owns this runtime. Losing its IPC channel must
      // enter DSH's existing SIGTERM disposal path so PTYs and agents cannot
      // survive an abruptly terminated shell.
      process.kill(process.pid, 'SIGTERM')
    }
    process.once('disconnect', onDisconnect)
    return () => {
      process.off('disconnect', onDisconnect)
    }
  })
}
