import type { Context } from '@deepseek-ai/cordis'

export type SqliteValue = null | number | bigint | string | Uint8Array
export type SqliteBindings = readonly SqliteValue[] | Readonly<Record<string, SqliteValue>>

export interface SqliteRunResult {
  readonly changes: number | bigint
  readonly lastInsertRowid: number | bigint
}

export interface SqliteSession {
  exec(sql: string): void
  run(sql: string, bindings?: SqliteBindings): SqliteRunResult
  get<T extends Readonly<Record<string, unknown>>>(sql: string, bindings?: SqliteBindings): T | undefined
  all<T extends Readonly<Record<string, unknown>>>(sql: string, bindings?: SqliteBindings): readonly T[]
}

export interface SqliteMigration {
  readonly version: number
  readonly name: string
  up(session: SqliteSession): void
}

export type SqliteScope =
  | { readonly kind: 'project'; readonly projectId: string }
  | { readonly kind: 'product' }

export interface SqliteAcquireOptions {
  readonly owner: string
  readonly name: string
  readonly scope: SqliteScope
  readonly applicationId: number
  readonly migrations: readonly SqliteMigration[]
}

export interface SqliteLease {
  readonly owner: string
  readonly name: string
  readonly filePath: string
  readonly schemaVersion: number
  read<T>(callback: (session: SqliteSession) => T): T
  write<T>(callback: (session: SqliteSession) => T): T
  checkpoint(): void
  close(): void
}

export interface SqliteRuntime {
  acquire(ownerContext: Context, options: SqliteAcquireOptions): SqliteLease
  closeAll(): void
}

export interface SqliteRuntimeConfig {
  /** Product-owned root; defaults to CONVAX_PROJECTS_HOME. */
  readonly dataDir?: string
}
