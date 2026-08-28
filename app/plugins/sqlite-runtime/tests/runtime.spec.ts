import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DefaultSqliteRuntime,
  SqliteRuntimeError,
  type SqliteAcquireOptions,
  type SqliteMigration,
} from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'convax-sqlite-runtime-'))
  roots.push(root)
  return root
}

function context(): Context {
  const ctx = new Context()
  contexts.push(ctx)
  return ctx
}

const migrationV1: SqliteMigration = {
  version: 1,
  name: 'create-items',
  up(db) {
    db.exec('CREATE TABLE items (id TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT')
  },
}

function options(overrides: Partial<SqliteAcquireOptions> = {}): SqliteAcquireOptions {
  return {
    owner: 'app-canvas',
    name: 'main',
    scope: { kind: 'project', projectId: 'default' },
    applicationId: 0x434e5658,
    migrations: [migrationV1],
    ...overrides,
  }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('sqliteRuntime storage contract', () => {
  it('requires an explicit absolute product data root', () => {
    const previous = process.env.CONVAX_PROJECTS_HOME
    delete process.env.CONVAX_PROJECTS_HOME
    try {
      expect(() => new DefaultSqliteRuntime()).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }))
      expect(() => new DefaultSqliteRuntime({ dataDir: 'relative' })).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }))
    } finally {
      if (previous === undefined) delete process.env.CONVAX_PROJECTS_HOME
      else process.env.CONVAX_PROJECTS_HOME = previous
    }
  })

  it.each([
    { owner: '../canvas' },
    { owner: 'App-Canvas' },
    { name: '../main' },
    { name: 'main/db' },
    { scope: { kind: 'project', projectId: '..' } as const },
    { scope: { kind: 'project', projectId: '/tmp/escape' } as const },
  ])('rejects path traversal and non-canonical segments: %o', (override) => {
    const runtime = new DefaultSqliteRuntime({ dataDir: temporaryRoot() })
    expect(() => runtime.acquire(context(), options(override))).toThrow(expect.objectContaining({ code: 'INVALID_PATH' }))
  })

  it('gives different owners independent database files and schemas', () => {
    const runtime = new DefaultSqliteRuntime({ dataDir: temporaryRoot() })
    const ctx = context()
    const canvas = runtime.acquire(ctx, options())
    const assets = runtime.acquire(ctx, options({ owner: 'app-assets', applicationId: 0x41535354 }))

    canvas.write(db => db.run('INSERT INTO items (id, value) VALUES (?, ?)', ['canvas', 1]))
    expect(canvas.read(db => db.get<{ value: number }>('SELECT value FROM items WHERE id = ?', ['canvas']))).toEqual({ value: 1 })
    expect(assets.read(db => db.get<{ count: number }>('SELECT count(*) AS count FROM items'))).toEqual({ count: 0 })
    expect(canvas.filePath).not.toBe(assets.filePath)
    expect(canvas.filePath).toContain('/app-canvas/main.sqlite3')
    expect(assets.filePath).toContain('/app-assets/main.sqlite3')
  })

  it('rolls back an entire write transaction on failure', () => {
    const runtime = new DefaultSqliteRuntime({ dataDir: temporaryRoot() })
    const lease = runtime.acquire(context(), options())

    expect(() => lease.write(db => {
      db.run('INSERT INTO items (id, value) VALUES (?, ?)', ['rolled-back', 1])
      throw new Error('injected write failure')
    })).toThrow(expect.objectContaining({ code: 'TRANSACTION_FAILED' }))

    expect(lease.read(db => db.get<{ count: number }>('SELECT count(*) AS count FROM items'))).toEqual({ count: 0 })
  })

  it('rolls back a failed ordered migration without advancing user_version', () => {
    const root = temporaryRoot()
    const ctx = context()
    const firstRuntime = new DefaultSqliteRuntime({ dataDir: root })
    firstRuntime.acquire(ctx, options()).close()

    const failingV2: SqliteMigration = {
      version: 2,
      name: 'failing-change',
      up(db) {
        db.exec('CREATE TABLE migration_marker (value TEXT NOT NULL) STRICT')
        db.run('INSERT INTO migration_marker (value) VALUES (?)', ['partial'])
        throw new Error('injected migration failure')
      },
    }
    const secondRuntime = new DefaultSqliteRuntime({ dataDir: root })
    expect(() => secondRuntime.acquire(ctx, options({ migrations: [migrationV1, failingV2] }))).toThrow(
      expect.objectContaining({ code: 'MIGRATION_FAILED' }),
    )

    const recoveredRuntime = new DefaultSqliteRuntime({ dataDir: root })
    const recovered = recoveredRuntime.acquire(ctx, options())
    expect(recovered.schemaVersion).toBe(1)
    expect(recovered.read(db => db.get<{ count: number }>(
      "SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'migration_marker'",
    ))).toEqual({ count: 0 })
  })

  it('rejects a duplicate active acquisition for the same owner database', () => {
    const runtime = new DefaultSqliteRuntime({ dataDir: temporaryRoot() })
    const ctx = context()
    const first = runtime.acquire(ctx, options())
    expect(() => runtime.acquire(ctx, options())).toThrow(expect.objectContaining({ code: 'OWNER_ALREADY_ACQUIRED' }))
    first.close()
    expect(runtime.acquire(ctx, options()).schemaVersion).toBe(1)
  })

  it('binds leases to the owner fiber and closes every lease on runtime disposal', async () => {
    const runtime = new DefaultSqliteRuntime({ dataDir: temporaryRoot() })
    const root = context()
    let ownedLease: ReturnType<typeof runtime.acquire> | undefined
    const owner = await root.plugin({
      name: 'sqlite-owner',
      apply(ownerContext) {
        ownedLease = runtime.acquire(ownerContext, options())
      },
    })

    expect(ownedLease?.read(db => db.get<{ value: number }>('SELECT 1 AS value'))).toEqual({ value: 1 })
    await owner.dispose()
    expect(() => ownedLease?.read(db => db.get('SELECT 1'))).toThrow(expect.objectContaining({ code: 'LEASE_CLOSED' }))

    const rootLease = runtime.acquire(root, options())
    runtime.closeAll()
    expect(() => rootLease.read(db => db.get('SELECT 1'))).toThrow(expect.objectContaining({ code: 'LEASE_CLOSED' }))
    expect(() => runtime.acquire(root, options())).toThrow(expect.objectContaining({ code: 'RUNTIME_CLOSED' }))
  })

  it('validates contiguous migrations and application identity before publishing a lease', () => {
    const runtime = new DefaultSqliteRuntime({ dataDir: temporaryRoot() })
    const ctx = context()
    expect(() => runtime.acquire(ctx, options({ migrations: [{ ...migrationV1, version: 2 }] }))).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' }),
    )

    const first = runtime.acquire(ctx, options())
    first.close()
    expect(() => runtime.acquire(ctx, options({ applicationId: 123 }))).toThrow(
      expect.objectContaining({ code: 'APPLICATION_ID_MISMATCH' }),
    )
    expect(() => runtime.acquire(ctx, options()).close()).not.toThrow()
  })
})
