import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import type {
  SqliteAcquireOptions,
  SqliteBindings,
  SqliteLease,
  SqliteMigration,
  SqliteRunResult,
  SqliteRuntime,
  SqliteRuntimeConfig,
  SqliteSession,
  SqliteValue,
} from './contract.js'
import { SqliteRuntimeError } from './errors.js'
import { resolveSqliteRoot, sqliteDatabasePath } from './paths.js'

interface ChangeResult {
  changes: number | bigint
  lastInsertRowid: number | bigint
}

interface StatementCalls {
  run(...values: SqliteValue[]): ChangeResult
  run(values: Readonly<Record<string, SqliteValue>>): ChangeResult
  get(...values: SqliteValue[]): unknown
  get(values: Readonly<Record<string, SqliteValue>>): unknown
  all(...values: SqliteValue[]): unknown[]
  all(values: Readonly<Record<string, SqliteValue>>): unknown[]
}

export class DefaultSqliteRuntime implements SqliteRuntime {
  readonly #root: string
  readonly #leases = new Map<string, ManagedSqliteLease>()
  #closing = false

  constructor(config: SqliteRuntimeConfig = {}) {
    this.#root = resolveSqliteRoot(config)
  }

  acquire(ownerContext: Context, options: SqliteAcquireOptions): SqliteLease {
    if (this.#closing) throw new SqliteRuntimeError('RUNTIME_CLOSED', 'sqliteRuntime is closing')
    validateOptions(options)
    const filePath = sqliteDatabasePath(this.#root, options)
    if (this.#leases.has(filePath)) {
      throw new SqliteRuntimeError(
        'OWNER_ALREADY_ACQUIRED',
        `SQLite database is already acquired by ${options.owner}: ${options.name}`,
      )
    }

    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
    let database: DatabaseSync | undefined
    let lease: ManagedSqliteLease | undefined
    try {
      database = new DatabaseSync(filePath, { timeout: 5_000 })
      chmodSync(filePath, 0o600)
      database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
      const schemaVersion = migrate(database, options.applicationId, options.migrations)
      lease = new ManagedSqliteLease(
        options.owner,
        options.name,
        filePath,
        schemaVersion,
        database,
        () => this.#leases.delete(filePath),
      )
      this.#leases.set(filePath, lease)
      ownerContext.effect(
        () => () => lease?.close(),
        `sqliteRuntime: ${options.owner}/${options.name} lease`,
      )
      return lease
    } catch (error) {
      if (lease !== undefined) this.#leases.delete(filePath)
      try { database?.close() } catch {}
      throw error
    }
  }

  closeAll(): void {
    this.#closing = true
    const failures: unknown[] = []
    for (const lease of [...this.#leases.values()]) {
      try { lease.close() } catch (error) { failures.push(error) }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'failed to close every sqliteRuntime lease')
  }
}

class ManagedSqliteLease implements SqliteLease {
  readonly #session: DatabaseSession
  #closed = false

  constructor(
    readonly owner: string,
    readonly name: string,
    readonly filePath: string,
    readonly schemaVersion: number,
    private readonly database: DatabaseSync,
    private readonly release: () => void,
  ) {
    this.#session = new DatabaseSession(database, () => this.#assertOpen())
  }

  read<T>(callback: (session: SqliteSession) => T): T {
    this.#assertOpen()
    return synchronous(callback(this.#session), 'read')
  }

  write<T>(callback: (session: SqliteSession) => T): T {
    this.#assertOpen()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = synchronous(callback(this.#session), 'write')
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      try { this.database.exec('ROLLBACK') } catch {}
      if (error instanceof SqliteRuntimeError) throw error
      throw new SqliteRuntimeError(
        'TRANSACTION_FAILED',
        error instanceof Error ? error.message : String(error),
        { cause: error },
      )
    }
  }

  checkpoint(): void {
    this.#assertOpen()
    this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  close(): void {
    if (this.#closed) return
    this.database.close()
    this.#closed = true
    this.release()
  }

  #assertOpen(): void {
    if (this.#closed) throw new SqliteRuntimeError('LEASE_CLOSED', 'SQLite lease is closed')
  }
}

class DatabaseSession implements SqliteSession {
  constructor(
    private readonly database: DatabaseSync,
    private readonly assertOpen: () => void,
  ) {}

  exec(sql: string): void {
    this.assertOpen()
    rejectTransactionControl(sql)
    this.database.exec(sql)
  }

  run(sql: string, bindings?: SqliteBindings): SqliteRunResult {
    this.assertOpen()
    rejectTransactionControl(sql)
    const result = invoke<ChangeResult>(this.database.prepare(sql), 'run', bindings)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }

  get<T extends Readonly<Record<string, unknown>>>(sql: string, bindings?: SqliteBindings): T | undefined {
    this.assertOpen()
    return invoke<unknown>(this.database.prepare(sql), 'get', bindings) as T | undefined
  }

  all<T extends Readonly<Record<string, unknown>>>(sql: string, bindings?: SqliteBindings): readonly T[] {
    this.assertOpen()
    return invoke<unknown[]>(this.database.prepare(sql), 'all', bindings) as T[]
  }
}

function invoke<T>(statement: StatementSync, method: 'run' | 'get' | 'all', bindings?: SqliteBindings): T {
  const callable = statement as unknown as StatementCalls
  if (bindings === undefined) return callable[method]() as T
  if (Array.isArray(bindings)) return callable[method](...bindings) as T
  return callable[method](bindings as Readonly<Record<string, SqliteValue>>) as T
}

function migrate(database: DatabaseSync, applicationId: number, migrations: readonly SqliteMigration[]): number {
  const session = new DatabaseSession(database, () => {})
  const application = database.prepare('PRAGMA application_id').get() as { application_id: number }
  const version = database.prepare('PRAGMA user_version').get() as { user_version: number }
  if (application.application_id === 0) {
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
    if (version.user_version !== 0 || tables.length > 0) {
      throw new SqliteRuntimeError('APPLICATION_ID_MISMATCH', 'unowned SQLite database is not empty')
    }
    database.exec(`PRAGMA application_id = ${applicationId}`)
  } else if (application.application_id !== applicationId) {
    throw new SqliteRuntimeError(
      'APPLICATION_ID_MISMATCH',
      `expected SQLite application_id ${applicationId}, received ${application.application_id}`,
    )
  }

  if (version.user_version > migrations.length) {
    throw new SqliteRuntimeError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `SQLite schema version ${version.user_version} is newer than supported version ${migrations.length}`,
    )
  }

  for (const migration of migrations.slice(version.user_version)) {
    database.exec('BEGIN EXCLUSIVE')
    try {
      synchronous(migration.up(session), `migration ${migration.version}`)
      database.exec(`PRAGMA user_version = ${migration.version}`)
      database.exec('COMMIT')
    } catch (error) {
      try { database.exec('ROLLBACK') } catch {}
      throw new SqliteRuntimeError(
        'MIGRATION_FAILED',
        `SQLite migration ${migration.version} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }
  return migrations.length
}

function validateOptions(options: SqliteAcquireOptions): void {
  if (!Number.isSafeInteger(options.applicationId) || options.applicationId < 1 || options.applicationId > 0x7fffffff) {
    throw new SqliteRuntimeError('INVALID_CONFIG', 'SQLite applicationId must be an integer between 1 and 2147483647')
  }
  for (let index = 0; index < options.migrations.length; index += 1) {
    const migration = options.migrations[index]!
    if (migration.version !== index + 1) {
      throw new SqliteRuntimeError('INVALID_CONFIG', 'SQLite migrations must be ordered, contiguous, and start at version 1')
    }
    if (migration.name.trim().length === 0) {
      throw new SqliteRuntimeError('INVALID_CONFIG', `SQLite migration ${migration.version} requires a name`)
    }
  }
}

function synchronous<T>(value: T, operation: string): T {
  if (typeof value === 'object' && value !== null && 'then' in value) {
    throw new SqliteRuntimeError('INVALID_CONFIG', `SQLite ${operation} callback must be synchronous`)
  }
  return value
}

function rejectTransactionControl(sql: string): void {
  if (/\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/iu.test(sql)) {
    throw new SqliteRuntimeError('INVALID_CONFIG', 'transaction control is owned by sqliteRuntime')
  }
}
