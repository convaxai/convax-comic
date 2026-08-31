import type {
  CanvasClientApi,
  CanvasEdgeRendererRegistration,
  CanvasEdgeRendererProps,
  CanvasNodeRendererRegistration,
  CanvasNodeRendererProps,
  CanvasRendererRegistry,
  JsonObject,
} from '@convax/canvas-api'
import { Context } from '@deepseek-ai/cordis'
import type { ChangeEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import * as Client from '../src/client/index.ts'
import type { ComicImageData, ComicNoteData, ComicSequenceData } from '../src/contracts.ts'

const FIBER_ACTIVE = 2

class FakeRendererRegistry implements CanvasRendererRegistry {
  readonly nodes = new Map<string, CanvasNodeRendererRegistration>()
  readonly edges = new Map<string, CanvasEdgeRendererRegistration>()
  readonly disposals: string[] = []

  registerNode<TData extends JsonObject>(registration: CanvasNodeRendererRegistration<TData>): () => void {
    return this.register(this.nodes, `${registration.type}@${registration.kindVersion}`, registration as CanvasNodeRendererRegistration)
  }

  registerEdge<TData extends JsonObject>(registration: CanvasEdgeRendererRegistration<TData>): () => void {
    return this.register(this.edges, `${registration.type}@${registration.kindVersion}`, registration as CanvasEdgeRendererRegistration)
  }

  hasNode(type: string, kindVersion?: number): boolean {
    return kindVersion === undefined
      ? [...this.nodes.keys()].some((key) => key.startsWith(`${type}@`))
      : this.nodes.has(`${type}@${kindVersion}`)
  }

  hasEdge(type: string, kindVersion?: number): boolean {
    return kindVersion === undefined
      ? [...this.edges.keys()].some((key) => key.startsWith(`${type}@`))
      : this.edges.has(`${type}@${kindVersion}`)
  }

  subscribe(): () => void { return () => undefined }

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

function provider(registry: FakeRendererRegistry) {
  const service = { renderers: registry } as unknown as CanvasClientApi
  return {
    name: 'fake-canvas-client-provider',
    apply(ctx: Context) {
      ctx.provide('canvasClient', service)
    },
  }
}

function nodeProps<TData extends JsonObject>(type: string, data: TData): CanvasNodeRendererProps<TData> {
  return {
    sessionId: 'session-test',
    node: {
      id: 'node-1',
      type,
      kindVersion: 1,
      position: { x: 0, y: 0 },
      zIndex: 0,
      style: {},
      data: data as CanvasNodeRendererProps<TData>['node']['data'],
    },
    selected: false,
    actions: {
      update: vi.fn().mockResolvedValue({ document: {}, revision: 1, applied: 1 }),
      remove: vi.fn(),
      select: vi.fn(),
      focus: vi.fn(),
    },
  }
}

function edgeProps(data: ComicSequenceData): CanvasEdgeRendererProps<ComicSequenceData> {
  return {
    sessionId: 'session-test',
    edge: {
      id: 'edge-1',
      type: 'comic.sequence',
      kindVersion: 1,
      source: 'node-1',
      target: 'node-2',
      data,
    },
    selected: false,
    actions: { update: vi.fn(), remove: vi.fn(), select: vi.fn() },
  }
}

describe('canvas builtin Client renderers', () => {
  it('renders an editable note textarea wired to data updates', () => {
    const props = nodeProps<ComicNoteData>('comic.note', { title: 'Caption', text: 'Before' })
    const element = Client.ComicNoteRenderer(props)
    expect(element.type).toBe('textarea')
    expect(element.props).toMatchObject({
      'aria-label': 'Caption',
      'data-canvas-node-input': 'note',
      className: 'cvxCanvasNodeTextInput nodrag nowheel',
      placeholder: '写下分镜、对白或提示词…',
      value: 'Before',
    })

    const onFocus = (element.props as { onFocus: () => void }).onFocus
    onFocus()
    expect(props.actions.focus).toHaveBeenCalledOnce()

    const onChange = (element.props as { onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void }).onChange
    onChange({ currentTarget: { value: 'After' } } as ChangeEvent<HTMLTextAreaElement>)
    expect(props.actions.update).toHaveBeenCalledWith({ data: { text: 'After' } })
  })

  it('renders direct URLs, resolved assets, and safe unavailable fallbacks', () => {
    const urlProps = nodeProps<ComicImageData>('comic.image', {
      title: 'URL', source: { type: 'url', url: 'https://example.test/a.png' }, alt: 'A',
    })
    expect(Client.createComicImageRenderer()(urlProps)).toMatchObject({ type: 'img', props: { src: 'https://example.test/a.png', alt: 'A' } })

    const assetProps = nodeProps<ComicImageData>('comic.image', {
      title: 'Asset', source: { type: 'asset', assetId: 'asset:1' }, alt: 'B',
    })
    expect(Client.createComicImageRenderer((id) => `blob:${id}`)(assetProps)).toMatchObject({ type: 'img', props: { src: 'blob:asset:1' } })
    expect(Client.createComicImageRenderer()(assetProps)).toMatchObject({
      type: 'div',
      props: { role: 'img', 'data-canvas-image-unavailable': 'asset', children: 'Image unavailable' },
    })
    expect(Client.createComicImageRenderer(() => { throw new Error('unavailable') })(assetProps).type).toBe('div')
  })

  it('uses only SVG-safe group/title elements for sequence edges', () => {
    const element = Client.ComicSequenceRenderer(edgeProps({ label: 'Then' }))
    expect(element.type).toBe('g')
    expect(element.props['data-canvas-sequence-edge']).toBe('edge-1')
    expect(element.props.children).toMatchObject({ type: 'title', props: { children: 'Then' } })
  })
})

describe('canvas builtins Client lifecycle', () => {
  it('waits for canvasClient, registers exact renderers, disposes, and reactivates without remnants', async () => {
    const ctx = new Context()
    const registry = new FakeRendererRegistry()
    const builtins = ctx.plugin(Client)
    await builtins
    expect(builtins.state).toBe(FIBER_ACTIVE)
    expect(Client.inject).toEqual([])
    expect(registry.nodes.size).toBe(0)

    const firstProvider = await ctx.plugin(provider(registry))
    await vi.waitFor(() => expect(registry.nodes.size).toBe(2))
    expect(builtins.state).toBe(FIBER_ACTIVE)
    expect([...registry.nodes.keys()].sort()).toEqual(['comic.image@1', 'comic.note@1'])
    expect([...registry.edges.keys()]).toEqual(['comic.sequence@1'])
    expect(registry.nodes.get('comic.note@1')?.renderer).toBe(Client.ComicNoteRenderer)
    expect(registry.edges.get('comic.sequence@1')?.renderer).toBe(Client.ComicSequenceRenderer)

    await firstProvider.dispose()
    await vi.waitFor(() => expect(registry.nodes.size).toBe(0))
    expect(builtins.state).toBe(FIBER_ACTIVE)
    expect(registry.edges.size).toBe(0)
    expect(registry.disposals).toEqual(['comic.sequence@1', 'comic.image@1', 'comic.note@1'])

    const restoredProvider = await ctx.plugin(provider(registry))
    await vi.waitFor(() => expect(registry.nodes.size).toBe(2))
    expect(registry.edges.size).toBe(1)

    await builtins.dispose()
    expect(registry.nodes.size).toBe(0)
    expect(registry.edges.size).toBe(0)
    expect(registry.disposals).toHaveLength(6)
    await restoredProvider.dispose()
    await ctx.fiber.dispose()
  })

  it('rolls back node renderers if edge registration fails', () => {
    const registry = new FakeRendererRegistry()
    registry.registerEdge = () => { throw new Error('edge renderer failed') }
    expect(() => Client.registerComicBuiltinRenderers(registry)).toThrow('edge renderer failed')
    expect(registry.nodes.size).toBe(0)
    expect(registry.edges.size).toBe(0)
  })
})
