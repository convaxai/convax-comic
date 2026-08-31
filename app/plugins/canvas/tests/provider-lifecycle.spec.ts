import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as Canvas from '../src/index.ts'
import * as CanvasBuiltins from '@convax/canvas-builtins'
import * as CanvasStoreSqlite from '@convax/canvas-store-sqlite'
import * as SqliteRuntime from '@convax/sqlite-runtime'

const FIBER_PENDING = 0
const FIBER_ACTIVE = 2
const SCOPE = { workspaceId: 'workspace:bound', projectId: 'project:root', canvasId: 'canvas:main' }

describe('Canvas V2 provider lifecycle', () => {
  it('reactivates sqliteRuntime -> canvasStore -> canvasHost -> builtins and retains V2 data', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'convax-canvas-provider-'))
    const ctx = new Context()
    const tools = new Map<string, { execute(args: unknown, execution: unknown): Promise<unknown> }>()
    ctx.provide('tools', {
      register: (definition: { name: string; execute(args: unknown, execution: unknown): Promise<unknown> }) => {
        tools.set(definition.name, definition)
        return () => { tools.delete(definition.name) }
      },
    } as never)
    const registerTypert = vi.fn((_contribution: unknown) => () => {})
    ctx.provide('typert', { register: registerTypert } as never)
    const resolveByPath = vi.fn(async (path: string) => path === dataDir ? { id: 'workspace:bound' } : undefined)
    ctx.provide('workspaceRegistry', { resolveByPath } as never)

    try {
      const canvasFiber = ctx.plugin(Canvas)
      const builtinsFiber = ctx.plugin(CanvasBuiltins)
      const storeFiber = ctx.plugin(CanvasStoreSqlite)
      expect(canvasFiber.state).toBe(FIBER_PENDING)
      expect(builtinsFiber.state).toBe(FIBER_PENDING)
      expect(storeFiber.state).toBe(FIBER_PENDING)

      const runtime = await ctx.plugin(SqliteRuntime, { dataDir })
      await storeFiber
      await canvasFiber
      await builtinsFiber
      expect(storeFiber.state).toBe(FIBER_ACTIVE)
      expect(canvasFiber.state).toBe(FIBER_ACTIVE)
      expect(builtinsFiber.state).toBe(FIBER_ACTIVE)
      expect(registerTypert).toHaveBeenCalledTimes(1)
      expect(registerTypert.mock.calls[0]?.[0]).toBe(Canvas.CANVAS_HOST_TYPERT_V2_CONTRIBUTION)

      const listTool = tools.get('canvas_list')
      if (listTool === undefined) throw new Error('canvas_list was not registered')
      await expect(listTool.execute({}, {
        signal: new AbortController().signal,
      })).rejects.toThrow('require an Agent session')
      await expect(listTool.execute({}, {
        agent: { session: { header: { cwd: dataDir } } },
        signal: new AbortController().signal,
      })).resolves.toMatchObject({ activeCanvasId: 'canvas:main' })
      expect(resolveByPath).toHaveBeenCalledWith(dataDir)
      await expect(ctx.canvasHost.projects.get({
        workspaceId: 'workspace:bound',
        projectId: 'project:root',
      })).resolves.toMatchObject({ activeCanvasId: 'canvas:main' })

      await ctx.canvasHost.nodes.create({
        ...SCOPE,
        expectedRevision: 0,
        mutationId: 'lifecycle:create',
        source: 'test',
        node: {
          id: 'node:retained',
          type: 'comic.note',
          kindVersion: 1,
          position: { x: 10, y: 20 },
          zIndex: 0,
          style: { width: 280, height: 180 },
          data: { title: 'Persisted through provider restart', text: '' },
        },
      })
      expect((await ctx.canvasHost.documents.get(SCOPE)).revision).toBe(1)

      await runtime.dispose()
      await vi.waitFor(() => {
        expect(storeFiber.state).toBe(FIBER_PENDING)
        expect(canvasFiber.state).toBe(FIBER_PENDING)
        expect(builtinsFiber.state).toBe(FIBER_PENDING)
      })
      expect(ctx.get('canvasStore')).toBeUndefined()
      expect(ctx.get('canvasHost')).toBeUndefined()
      expect(ctx.get('canvasRemoteV2')).toBeUndefined()

      const restored = await ctx.plugin(SqliteRuntime, { dataDir })
      await storeFiber
      await canvasFiber
      await builtinsFiber
      expect(registerTypert).toHaveBeenCalledTimes(2)
      const restoredListTool = tools.get('canvas_list')
      if (restoredListTool === undefined) throw new Error('canvas_list was not restored')
      await expect(restoredListTool.execute({}, {
        agent: { session: { header: { cwd: dataDir } } },
        signal: new AbortController().signal,
      })).resolves.toMatchObject({ activeCanvasId: 'canvas:main' })
      expect(await ctx.canvasHost.documents.get(SCOPE)).toMatchObject({
        revision: 1,
        nodes: {
          'node:retained': {
            type: 'comic.note',
            data: { title: 'Persisted through provider restart', text: '' },
          },
        },
      })

      await restored.dispose()
      await builtinsFiber.dispose()
      await canvasFiber.dispose()
      await storeFiber.dispose()
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
