import type { Context } from '@deepseek-ai/cordis'
import type { SqliteRuntimeConfig } from './contract.js'
import { DefaultSqliteRuntime } from './runtime.js'

export * from './contract.js'
export * from './errors.js'
export { sqliteDatabasePath } from './paths.js'
export { DefaultSqliteRuntime } from './runtime.js'

export const name = 'app-sqlite-runtime'

export function apply(ctx: Context, config: SqliteRuntimeConfig = {}): void {
  const runtime = new DefaultSqliteRuntime(config)
  ctx.effect(() => () => runtime.closeAll(), 'sqliteRuntime: close all database leases')
  ctx.provide('sqliteRuntime', runtime)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sqliteRuntime: import('./contract.js').SqliteRuntime
  }
}
