import { createElement } from 'react'
import type {
  CanvasEdgeRenderer,
  CanvasEdgeRendererProps,
  CanvasEdgeRendererRegistration,
  CanvasNodeRenderer,
  CanvasNodeRendererProps,
  CanvasNodeRendererRegistration,
  CanvasRendererRegistry as CanvasRendererRegistryContract,
  JsonObject,
} from '@convax/canvas-api'

export interface CanvasRendererSnapshot {
  readonly nodes: Readonly<Record<string, Readonly<CanvasNodeRendererRegistration>>>
  readonly edges: Readonly<Record<string, Readonly<CanvasEdgeRendererRegistration>>>
}

/** Lossless fallback used while a node plugin is absent or version-incompatible. */
export function UnknownCanvasNode(props: CanvasNodeRendererProps): ReturnType<typeof createElement> {
  return createElement(
    'article',
    {
      role: 'group',
      'aria-label': `Unknown Canvas node ${props.node.type}`,
      'data-canvas-unknown-node': props.node.type,
      style: {
        boxSizing: 'border-box',
        minWidth: 160,
        minHeight: 72,
        padding: 12,
        border: '1px dashed var(--dsw-border-strong, currentColor)',
        borderRadius: 8,
        background: 'var(--dsw-surface-raised, Canvas)',
        color: 'var(--dsw-text-muted, CanvasText)',
      },
    },
    createElement('strong', undefined, 'Plugin unavailable'),
    createElement('div', undefined, `${props.node.type}@${props.node.kindVersion}`),
  )
}

/** SVG-safe marker used when an edge renderer is unavailable. */
export function UnknownCanvasEdge(props: CanvasEdgeRendererProps): ReturnType<typeof createElement> {
  return createElement(
    'g',
    {
      role: 'group',
      'aria-label': `Unknown Canvas edge ${props.edge.type}`,
      'data-canvas-unknown-edge': props.edge.type,
    },
    createElement('title', undefined, `Plugin unavailable: ${props.edge.type}@${props.edge.kindVersion}`),
  )
}

/** Fiber-safe renderer contribution registry with stable observable snapshots. */
export class CanvasRendererRegistry implements CanvasRendererRegistryContract {
  readonly #nodes = new Map<string, CanvasNodeRendererRegistration>()
  readonly #edges = new Map<string, CanvasEdgeRendererRegistration>()
  readonly #listeners = new Set<() => void>()
  readonly #nodeFallback: CanvasNodeRenderer
  readonly #edgeFallback: CanvasEdgeRenderer
  #snapshot: CanvasRendererSnapshot = emptySnapshot()
  #disposed = false

  constructor(
    nodeFallback: CanvasNodeRenderer = UnknownCanvasNode,
    edgeFallback: CanvasEdgeRenderer = UnknownCanvasEdge,
  ) {
    this.#nodeFallback = nodeFallback
    this.#edgeFallback = edgeFallback
  }

  registerNode<TData extends JsonObject>(registration: CanvasNodeRendererRegistration<TData>): () => void {
    const owned = ownNodeRegistration(registration)
    return this.#register(this.#nodes, registrationKey(owned.type, owned.kindVersion), owned, 'node')
  }

  registerEdge<TData extends JsonObject>(registration: CanvasEdgeRendererRegistration<TData>): () => void {
    const owned = ownEdgeRegistration(registration)
    return this.#register(this.#edges, registrationKey(owned.type, owned.kindVersion), owned, 'edge')
  }

  hasNode(type: string, kindVersion?: number): boolean {
    if (kindVersion !== undefined) return this.#nodes.has(registrationKey(type, kindVersion))
    return [...this.#nodes.values()].some(registration => registration.type === type)
  }

  hasEdge(type: string, kindVersion?: number): boolean {
    if (kindVersion !== undefined) return this.#edges.has(registrationKey(type, kindVersion))
    return [...this.#edges.values()].some(registration => registration.type === type)
  }

  resolveNode(type: string, kindVersion: number): CanvasNodeRenderer {
    return this.#nodes.get(registrationKey(type, kindVersion))?.renderer ?? this.#nodeFallback
  }

  resolveEdge(type: string, kindVersion: number): CanvasEdgeRenderer {
    return this.#edges.get(registrationKey(type, kindVersion))?.renderer ?? this.#edgeFallback
  }

  getSnapshot = (): CanvasRendererSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => {}
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#nodes.clear()
    this.#edges.clear()
    this.#snapshot = emptySnapshot()
    this.#listeners.clear()
  }

  #register<T>(entries: Map<string, T>, type: string, owned: T, domain: 'node' | 'edge'): () => void {
    if (this.#disposed) throw new Error('Canvas renderer registry is disposed')
    if (entries.has(type)) throw new Error(`Canvas ${domain} renderer already registered: ${type}`)
    entries.set(type, owned)
    this.#publish()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (entries.get(type) !== owned) return
      entries.delete(type)
      this.#publish()
    }
  }

  #publish(): void {
    if (this.#disposed) return
    this.#snapshot = Object.freeze({
      nodes: freezeEntries(this.#nodes),
      edges: freezeEntries(this.#edges),
    })
    for (const listener of [...this.#listeners]) listener()
  }
}

function registrationKey(type: string, kindVersion: number): string {
  return `${type}@${String(kindVersion)}`
}

function validateRegistration(typeValue: string, kindVersion: number, domain: 'node' | 'edge'): string {
  const type = typeValue.trim()
  if (type.length === 0) throw new TypeError(`Canvas ${domain} renderer type must be non-empty`)
  if (!Number.isSafeInteger(kindVersion) || kindVersion < 1) {
    throw new TypeError(`Canvas ${domain} renderer kindVersion must be a positive safe integer`)
  }
  return type
}

function ownNodeRegistration<TData extends JsonObject>(
  registration: CanvasNodeRendererRegistration<TData>,
): CanvasNodeRendererRegistration {
  return Object.freeze({
    type: validateRegistration(registration.type, registration.kindVersion, 'node'),
    kindVersion: registration.kindVersion,
    renderer: registration.renderer as CanvasNodeRenderer,
  })
}

function ownEdgeRegistration<TData extends JsonObject>(
  registration: CanvasEdgeRendererRegistration<TData>,
): CanvasEdgeRendererRegistration {
  return Object.freeze({
    type: validateRegistration(registration.type, registration.kindVersion, 'edge'),
    kindVersion: registration.kindVersion,
    renderer: registration.renderer as CanvasEdgeRenderer,
  })
}

function freezeEntries<T>(entries: ReadonlyMap<string, T>): Readonly<Record<string, Readonly<T>>> {
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<string, Readonly<T>>>
}

function emptySnapshot(): CanvasRendererSnapshot {
  return Object.freeze({ nodes: Object.freeze({}), edges: Object.freeze({}) })
}
