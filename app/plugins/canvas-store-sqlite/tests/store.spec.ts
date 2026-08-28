import { CANVAS_SCHEMA_VERSION } from '@convax/canvas-api'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as SqliteRuntime from '@convax/sqlite-runtime'
import * as CanvasStoreSqlite from '../src/index.ts'
import type { CanvasStore } from '@convax/canvas-store-api'

const FIBER_PENDING = 0
const FIBER_ACTIVE = 2
const WORKSPACE_A = 'workspace:a'
const WORKSPACE_B = 'workspace:b'
const PROJECT = 'project:shared'
const roots: string[] = []

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'convax-canvas-store-'))
  roots.push(value)
  return value
}

function projectJson(workspaceId: string, projectId: string, revision: number, title = projectId): string {
  const canvasId = `canvas:${projectId}`
  const timestamp = '2026-08-27T00:00:00.000Z'
  return JSON.stringify({
    schemaVersion: CANVAS_SCHEMA_VERSION,
    revision,
    id: projectId,
    workspaceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: { title },
    activeCanvasId: canvasId,
    canvases: {
      [canvasId]: {
        schemaVersion: CANVAS_SCHEMA_VERSION,
        revision: 0,
        id: canvasId,
        workspaceId,
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: { title },
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: {},
        edges: {},
      },
    },
  })
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true })
})

describe('SQLite CanvasStore provider', () => {
  it('isolates identical project IDs by workspace across CAS, list, delete, and restart', async () => {
    const dataDir = root()
    const ctx = new Context()
    const runtime = await ctx.plugin(SqliteRuntime, { dataDir })
    const provider = await ctx.plugin(CanvasStoreSqlite)
    const store = ctx.get('canvasStore') as CanvasStore
    const a0 = projectJson(WORKSPACE_A, PROJECT, 0, 'A')
    const b0 = projectJson(WORKSPACE_B, PROJECT, 0, 'B')
    const a1 = projectJson(WORKSPACE_A, PROJECT, 1, 'A1')
    const b1 = projectJson(WORKSPACE_B, PROJECT, 1, 'B1')

    expect(await store.read(WORKSPACE_A, PROJECT)).toBeUndefined()
    expect(await store.read(WORKSPACE_B, PROJECT)).toBeUndefined()
    expect(await store.initialize(WORKSPACE_A, PROJECT, a0)).toEqual({
      workspaceId: WORKSPACE_A,
      projectId: PROJECT,
      revision: 0,
      projectJson: a0,
    })
    expect(await store.initialize(WORKSPACE_B, PROJECT, b0)).toEqual({
      workspaceId: WORKSPACE_B,
      projectId: PROJECT,
      revision: 0,
      projectJson: b0,
    })
    await store.initialize(WORKSPACE_A, 'project:z', projectJson(WORKSPACE_A, 'project:z', 0))
    expect((await store.list(WORKSPACE_A)).map(project => project.projectId)).toEqual([PROJECT, 'project:z'])
    expect((await store.list(WORKSPACE_B)).map(project => project.projectId)).toEqual([PROJECT])

    expect(await store.commit({
      workspaceId: WORKSPACE_A,
      projectId: PROJECT,
      expectedRevision: 0,
      projectJson: a1,
    })).toMatchObject({ workspaceId: WORKSPACE_A, revision: 1 })
    await expect(store.commit({
      workspaceId: WORKSPACE_A,
      projectId: PROJECT,
      expectedRevision: 0,
      projectJson: projectJson(WORKSPACE_A, PROJECT, 1, 'stale'),
    })).rejects.toMatchObject({ code: 'CONFLICT', expected: 0, actual: 1 })
    expect(await store.read(WORKSPACE_B, PROJECT)).toMatchObject({
      workspaceId: WORKSPACE_B,
      revision: 0,
      projectJson: b0,
    })
    expect(await store.commit({
      workspaceId: WORKSPACE_B,
      projectId: PROJECT,
      expectedRevision: 0,
      projectJson: b1,
    })).toMatchObject({ workspaceId: WORKSPACE_B, revision: 1 })

    await provider.dispose()
    await runtime.dispose()
    await ctx.fiber.dispose()

    const restarted = new Context()
    const restartedRuntime = await restarted.plugin(SqliteRuntime, { dataDir })
    const restartedProvider = await restarted.plugin(CanvasStoreSqlite)
    const restartedStore = restarted.get('canvasStore') as CanvasStore
    expect(await restartedStore.read(WORKSPACE_A, PROJECT)).toMatchObject({ revision: 1 })
    expect(await restartedStore.read(WORKSPACE_B, PROJECT)).toMatchObject({ revision: 1 })

    await expect(restartedStore.delete({
      workspaceId: WORKSPACE_A,
      projectId: PROJECT,
      expectedRevision: 0,
    })).rejects.toMatchObject({ code: 'CONFLICT', expected: 0, actual: 1 })
    expect(await restartedStore.delete({
      workspaceId: WORKSPACE_A,
      projectId: PROJECT,
      expectedRevision: 1,
    })).toBe(true)
    expect(await restartedStore.read(WORKSPACE_A, PROJECT)).toBeUndefined()
    expect(await restartedStore.read(WORKSPACE_B, PROJECT)).toMatchObject({ revision: 1 })
    expect((await restartedStore.list(WORKSPACE_A)).map(project => project.projectId)).toEqual(['project:z'])
    expect((await restartedStore.list(WORKSPACE_B)).map(project => project.projectId)).toEqual([PROJECT])

    await restartedProvider.dispose()
    await restartedRuntime.dispose()
    await restarted.fiber.dispose()
  })

  it('drops the old development-only v1 table in contiguous migration v2', async () => {
    const dataDir = root()
    const ctx = new Context()
    const runtime = await ctx.plugin(SqliteRuntime, { dataDir })
    const sqlite = ctx.get('sqliteRuntime') as SqliteRuntime.SqliteRuntime
    const legacy = sqlite.acquire(ctx, {
      owner: 'canvas',
      name: 'canvas',
      scope: { kind: 'project', projectId: 'default' },
      applicationId: 0x43565354,
      migrations: [{
        version: 1,
        name: 'create-development-project-id-only-canvas-projects',
        up(db) {
          db.exec(`CREATE TABLE canvas_projects (
            project_id TEXT PRIMARY KEY,
            revision INTEGER NOT NULL CHECK (revision >= 0),
            project_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT`)
        },
      }],
    })
    legacy.write(db => db.run(
      `INSERT INTO canvas_projects
        (project_id, revision, project_json, created_at, updated_at) VALUES (?, 0, ?, ?, ?)`,
      ['project:discarded-development-data', '{}', new Date().toISOString(), new Date().toISOString()],
    ))
    legacy.close()

    const provider = await ctx.plugin(CanvasStoreSqlite)
    const store = ctx.get('canvasStore') as CanvasStore
    expect(await store.list(WORKSPACE_A)).toEqual([])
    await store.initialize(WORKSPACE_A, PROJECT, projectJson(WORKSPACE_A, PROJECT, 0))
    await store.initialize(WORKSPACE_B, PROJECT, projectJson(WORKSPACE_B, PROJECT, 0))
    expect(await store.read(WORKSPACE_A, PROJECT)).toMatchObject({ workspaceId: WORKSPACE_A })
    expect(await store.read(WORKSPACE_B, PROJECT)).toMatchObject({ workspaceId: WORKSPACE_B })

    await provider.dispose()
    await runtime.dispose()
    await ctx.fiber.dispose()
  })

  it('validates workspace IDs and unloads/restores with sqliteRuntime', async () => {
    const dataDir = root()
    const ctx = new Context()
    const storeFiber = ctx.plugin(CanvasStoreSqlite)
    expect(storeFiber.state).toBe(FIBER_PENDING)

    const runtime = await ctx.plugin(SqliteRuntime, { dataDir })
    await storeFiber
    expect(storeFiber.state).toBe(FIBER_ACTIVE)
    const first = ctx.get('canvasStore') as CanvasStore
    await expect(first.list('')).rejects.toMatchObject({ code: 'CORRUPT' })
    await expect(first.read('x'.repeat(129), PROJECT)).rejects.toMatchObject({ code: 'CORRUPT' })
    await expect(first.initialize(WORKSPACE_A, PROJECT, '{}')).rejects.toMatchObject({ code: 'CORRUPT' })
    await expect(first.initialize(
      WORKSPACE_A,
      PROJECT,
      projectJson(WORKSPACE_B, PROJECT, 0),
    )).rejects.toMatchObject({ code: 'CORRUPT' })
    await expect(first.initialize(
      WORKSPACE_A,
      PROJECT,
      projectJson(WORKSPACE_A, PROJECT, 1),
    )).rejects.toMatchObject({ code: 'CORRUPT' })
    const persistedJson = projectJson(WORKSPACE_A, PROJECT, 0)
    await first.initialize(WORKSPACE_A, PROJECT, persistedJson)

    await runtime.dispose()
    await vi.waitFor(() => expect(storeFiber.state).toBe(FIBER_PENDING))
    expect(ctx.get('canvasStore')).toBeUndefined()
    await expect(first.read(WORKSPACE_A, PROJECT)).rejects.toMatchObject({ code: 'CLOSED' })

    const restored = await ctx.plugin(SqliteRuntime, { dataDir })
    await storeFiber
    expect((await (ctx.get('canvasStore') as CanvasStore).read(WORKSPACE_A, PROJECT))?.projectJson).toBe(persistedJson)

    await restored.dispose()
    await storeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('fails a duplicate CanvasStore provider instead of selecting one', async () => {
    const ctx = new Context()
    ctx.logger.error = vi.fn()
    const runtime = await ctx.plugin(SqliteRuntime, { dataDir: root() })
    const first = await ctx.plugin(CanvasStoreSqlite)
    const duplicate = ctx.plugin(CanvasStoreSqlite, { databaseName: 'duplicate' })
    await expect(duplicate).rejects.toThrow(/service "canvasStore" has been registered/)

    expect(ctx.get('canvasStore')).toBeDefined()
    await duplicate.dispose()
    await first.dispose()
    await runtime.dispose()
    await ctx.fiber.dispose()
  })
})
