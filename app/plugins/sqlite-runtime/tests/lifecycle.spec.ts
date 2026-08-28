import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as SqliteRuntimePlugin from '../src/index.ts'
import type { SqliteLease } from '../src/index.ts'

const FIBER_PENDING = 0
const FIBER_ACTIVE = 2
const roots: string[] = []

let activations = 0
let disposals = 0
let currentLease: SqliteLease | undefined

const Consumer = {
  name: 'sqlite-runtime-test-consumer',
  inject: ['sqliteRuntime'],
  apply(ctx: Context) {
    activations += 1
    currentLease = ctx.sqliteRuntime.acquire(ctx, {
      owner: 'test-consumer',
      name: 'state',
      scope: { kind: 'project', projectId: 'default' },
      applicationId: 0x53514c54,
      migrations: [{
        version: 1,
        name: 'create-state',
        up(db) {
          db.exec('CREATE TABLE state (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT')
        },
      }],
    })
    return () => { disposals += 1 }
  },
}

afterEach(() => {
  activations = 0
  disposals = 0
  currentLease = undefined
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('sqliteRuntime Cordis lifecycle', () => {
  it('unloads the consumer, closes its lease, and restores it with the provider', async () => {
    const root = mkdtempSync(join(tmpdir(), 'convax-sqlite-lifecycle-'))
    roots.push(root)
    const ctx = new Context()
    const consumer = ctx.plugin(Consumer)
    expect(consumer.state).toBe(FIBER_PENDING)

    const provider = await ctx.plugin(SqliteRuntimePlugin, { dataDir: root })
    await consumer
    expect(consumer.state).toBe(FIBER_ACTIVE)
    expect(activations).toBe(1)
    const firstLease = currentLease!
    firstLease.write(db => db.run('INSERT INTO state (id, value) VALUES (?, ?)', [1, 'persisted']))

    await provider.dispose()
    await vi.waitFor(() => expect(consumer.state).toBe(FIBER_PENDING))
    expect(disposals).toBe(1)
    expect(() => firstLease.read(db => db.get('SELECT 1'))).toThrow(expect.objectContaining({ code: 'LEASE_CLOSED' }))

    const restored = await ctx.plugin(SqliteRuntimePlugin, { dataDir: root })
    await consumer
    expect(consumer.state).toBe(FIBER_ACTIVE)
    expect(activations).toBe(2)
    expect(currentLease?.read(db => db.get<{ value: string }>('SELECT value FROM state WHERE id = 1'))).toEqual({ value: 'persisted' })

    await restored.dispose()
    await consumer.dispose()
    await ctx.fiber.dispose()
  })

  it('closes leases acquired by the root context when the runtime fiber disposes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'convax-sqlite-runtime-dispose-'))
    roots.push(root)
    const ctx = new Context()
    const provider = await ctx.plugin(SqliteRuntimePlugin, { dataDir: root })
    const runtime = ctx.get('sqliteRuntime') as SqliteRuntimePlugin.SqliteRuntime
    const lease = runtime.acquire(ctx, {
      owner: 'root-owner',
      name: 'main',
      scope: { kind: 'product' },
      applicationId: 0x524f4f54,
      migrations: [],
    })

    expect(lease.read(db => db.get<{ value: number }>('SELECT 1 AS value'))).toEqual({ value: 1 })
    await provider.dispose()
    expect(() => lease.read(db => db.get('SELECT 1'))).toThrow(expect.objectContaining({ code: 'LEASE_CLOSED' }))
    await ctx.fiber.dispose()
  })
})
