import type {
  CanvasEdgeTypeDefinition,
  CanvasHostApi,
  CanvasNodeTypeDefinition,
} from '@convax/canvas-api'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import * as Builtins from '../src/index.ts'

const FIBER_PENDING = 0
const FIBER_ACTIVE = 2

class FakeHostRegistry {
  readonly nodes = new Map<string, CanvasNodeTypeDefinition>()
  readonly edges = new Map<string, CanvasEdgeTypeDefinition>()
  readonly disposals: string[] = []

  registerNodeType = (definition: CanvasNodeTypeDefinition): (() => void) =>
    this.register(this.nodes, `${definition.type}@${definition.kindVersion}`, definition)

  registerEdgeType = (definition: CanvasEdgeTypeDefinition): (() => void) =>
    this.register(this.edges, `${definition.type}@${definition.kindVersion}`, definition)

  private register<T>(map: Map<string, T>, key: string, value: T): () => void {
    if (map.has(key)) throw new Error(`duplicate ${key}`)
    map.set(key, value)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.disposals.push(key)
      map.delete(key)
    }
  }
}

function provider(registry: FakeHostRegistry) {
  return {
    name: 'fake-canvas-host-provider',
    apply(ctx: Context) {
      ctx.provide('canvasHost', registry as unknown as CanvasHostApi)
    },
  }
}

describe('canvas builtins Host lifecycle', () => {
  it('waits for canvasHost, registers exactly once, disposes, and reactivates cleanly', async () => {
    const ctx = new Context()
    const registry = new FakeHostRegistry()
    const builtins = ctx.plugin(Builtins)
    expect(builtins.state).toBe(FIBER_PENDING)
    expect(registry.nodes.size).toBe(0)

    const firstProvider = await ctx.plugin(provider(registry))
    await builtins
    expect(builtins.state).toBe(FIBER_ACTIVE)
    expect([...registry.nodes.keys()].sort()).toEqual(['comic.image@1', 'comic.note@1'])
    expect([...registry.edges.keys()]).toEqual(['comic.sequence@1'])
    expect(registry.nodes.get('comic.note@1')).toBe(Builtins.comicNoteNodeType)
    expect(registry.nodes.get('comic.image@1')).toBe(Builtins.comicImageNodeType)
    expect(registry.edges.get('comic.sequence@1')).toBe(Builtins.comicSequenceEdgeType)

    await firstProvider.dispose()
    await vi.waitFor(() => expect(builtins.state).toBe(FIBER_PENDING))
    expect(registry.nodes.size).toBe(0)
    expect(registry.edges.size).toBe(0)
    expect(registry.disposals).toEqual(['comic.sequence@1', 'comic.image@1', 'comic.note@1'])

    const restoredProvider = await ctx.plugin(provider(registry))
    await builtins
    expect(builtins.state).toBe(FIBER_ACTIVE)
    expect(registry.nodes.size).toBe(2)
    expect(registry.edges.size).toBe(1)

    await builtins.dispose()
    expect(registry.nodes.size).toBe(0)
    expect(registry.edges.size).toBe(0)
    expect(registry.disposals).toHaveLength(6)
    await restoredProvider.dispose()
    await ctx.fiber.dispose()
  })

  it('rolls back earlier registrations if a later registration fails', () => {
    const registry = new FakeHostRegistry()
    registry.registerEdgeType = () => { throw new Error('edge registration failed') }
    expect(() => Builtins.registerComicBuiltinTypes(registry as unknown as CanvasHostApi)).toThrow('edge registration failed')
    expect(registry.nodes.size).toBe(0)
    expect(registry.edges.size).toBe(0)
  })
})
