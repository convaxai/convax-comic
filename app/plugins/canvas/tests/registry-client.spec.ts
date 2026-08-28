import type {
  CanvasEdgeRenderer,
  CanvasEdgeRendererProps,
  CanvasNodeRenderer,
  CanvasNodeRendererProps,
} from '@convax/canvas-api'
import { describe, expect, it, vi } from 'vitest'
import {
  CanvasRendererRegistry,
  UnknownCanvasEdge,
  UnknownCanvasNode,
} from '../src/client/renderer-registry.ts'

const NoteRenderer: CanvasNodeRenderer = () => null
const NodeFallback: CanvasNodeRenderer = () => null
const SequenceRenderer: CanvasEdgeRenderer = () => null
const EdgeFallback: CanvasEdgeRenderer = () => null

describe('CanvasRendererRegistry', () => {
  it('resolves node and edge renderers only for exact type and kindVersion', () => {
    const registry = new CanvasRendererRegistry(NodeFallback, EdgeFallback)
    registry.registerNode({ type: 'comic.note', kindVersion: 2, renderer: NoteRenderer })
    registry.registerEdge({ type: 'comic.sequence', kindVersion: 1, renderer: SequenceRenderer })

    expect(registry.hasNode('comic.note')).toBe(true)
    expect(registry.hasNode('comic.note', 2)).toBe(true)
    expect(registry.hasNode('comic.note', 1)).toBe(false)
    expect(registry.resolveNode('comic.note', 2)).toBe(NoteRenderer)
    expect(registry.resolveNode('comic.note', 1)).toBe(NodeFallback)
    expect(registry.hasEdge('comic.sequence', 1)).toBe(true)
    expect(registry.resolveEdge('comic.sequence', 1)).toBe(SequenceRenderer)
    expect(registry.resolveEdge('comic.sequence', 2)).toBe(EdgeFallback)
  })

  it('publishes stable frozen snapshots and notifies on node and edge changes', () => {
    const registry = new CanvasRendererRegistry()
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)
    const empty = registry.getSnapshot()
    expect(registry.getSnapshot()).toBe(empty)
    expect(Object.isFrozen(empty)).toBe(true)

    const unregisterNode = registry.registerNode({
      type: 'comic.note',
      kindVersion: 2,
      renderer: NoteRenderer,
    })
    const registered = registry.getSnapshot()
    expect(registered).not.toBe(empty)
    expect(registered.nodes['comic.note@2']).toMatchObject({ type: 'comic.note', kindVersion: 2 })
    expect(Object.isFrozen(registered.nodes)).toBe(true)
    expect(Object.isFrozen(registered.nodes['comic.note@2'])).toBe(true)

    const unregisterEdge = registry.registerEdge({
      type: 'comic.sequence',
      kindVersion: 1,
      renderer: SequenceRenderer,
    })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(registry.getSnapshot().edges['comic.sequence@1']).toMatchObject({ kindVersion: 1 })

    unregisterNode()
    unregisterNode()
    unregisterEdge()
    unregisterEdge()
    expect(listener).toHaveBeenCalledTimes(4)
    expect(registry.getSnapshot()).toEqual({ nodes: {}, edges: {} })

    unsubscribe()
    registry.registerNode({ type: 'comic.note', kindVersion: 2, renderer: NoteRenderer })
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('coexists across kind versions, rejects exact duplicates, and rejects after disposal', () => {
    const registry = new CanvasRendererRegistry()
    const unregister = registry.registerNode({
      type: ' comic.note ',
      kindVersion: 2,
      renderer: NoteRenderer,
    })
    registry.registerNode({ type: 'comic.note', kindVersion: 3, renderer: NodeFallback })
    expect(registry.resolveNode('comic.note', 2)).toBe(NoteRenderer)
    expect(registry.resolveNode('comic.note', 3)).toBe(NodeFallback)
    expect(() => registry.registerNode({
      type: 'comic.note',
      kindVersion: 2,
      renderer: NoteRenderer,
    })).toThrowError(/already registered/u)

    registry.registerEdge({ type: 'comic.sequence', kindVersion: 1, renderer: SequenceRenderer })
    registry.registerEdge({ type: 'comic.sequence', kindVersion: 2, renderer: EdgeFallback })
    expect(() => registry.registerEdge({
      type: 'comic.sequence',
      kindVersion: 1,
      renderer: SequenceRenderer,
    })).toThrowError(/already registered/u)

    registry.dispose()
    registry.dispose()
    unregister()
    expect(registry.getSnapshot()).toEqual({ nodes: {}, edges: {} })
    expect(() => registry.registerNode({
      type: 'comic.image',
      kindVersion: 1,
      renderer: NoteRenderer,
    })).toThrowError(/disposed/u)
  })

  it('renders accessible unknown node and SVG-safe edge fallbacks', () => {
    const node = UnknownCanvasNode({
      node: { type: 'comic.missing', kindVersion: 3 },
    } as unknown as CanvasNodeRendererProps)
    expect(node.type).toBe('article')
    expect(node.props).toMatchObject({
      role: 'group',
      'aria-label': 'Unknown Canvas node comic.missing',
      'data-canvas-unknown-node': 'comic.missing',
    })

    const edge = UnknownCanvasEdge({
      edge: { type: 'comic.missing-edge', kindVersion: 2 },
    } as unknown as CanvasEdgeRendererProps)
    expect(edge.type).toBe('g')
    expect(edge.props).toMatchObject({
      role: 'group',
      'aria-label': 'Unknown Canvas edge comic.missing-edge',
      'data-canvas-unknown-edge': 'comic.missing-edge',
    })
  })
})
