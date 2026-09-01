import {
  encodeJsonPointer,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasEdgeUpdate,
  type CanvasNode,
  type ApplyCanvasPatchResult,
  type CanvasNodeUpdate,
  type CanvasPatchOperation,
  type JsonObject,
  type JsonValue,
} from '@convax/canvas-api'
import {
  CanvasFileError,
  type CanvasConnectInput,
  type CanvasCreateNodeInput,
  type CanvasFileCollection,
  type CanvasIdKind,
  type CanvasMediaPolicy,
  type CanvasMoveNodeInput,
  type CanvasObjectUrlApi,
  type CanvasProjectFileReader,
  type CanvasSelection,
  type CanvasUpdateNodePatch,
  type ComicCanvasDocumentProjection as ComicCanvasDocumentBaseProjection,
  type ComicCanvasEdgeProjection,
  type ComicCanvasImageNodeProjection,
  type ComicCanvasMediaSource,
  type ComicCanvasNode,
  type ComicCanvasNoteNodeProjection,
  type ComicCanvasPoint,
  type ComicCanvasSize,
  type ComicCanvasViewport,
} from './comic-ui-contract.js'
import { CanvasClientService } from './canvas-client-service.js'
import type { CanvasRendererRegistry } from './renderer-registry.js'
import { edgeUpdatePatch, invertCanvasPatch, nodeUpdatePatch } from './v2-patch.js'

const COMIC_NOTE_NODE_TYPE = 'comic.note'
const COMIC_IMAGE_NODE_TYPE = 'comic.image'
const COMIC_SEQUENCE_EDGE_TYPE = 'comic.sequence'
const COMIC_KIND_VERSION = 1
const DEFAULT_IMAGE_BYTES = 25 * 1024 * 1024
const IMAGE_TYPES = ['image/gif', 'image/jpeg', 'image/png', 'image/webp'] as const
const UNKNOWN_TITLE_PREFIX = 'Unsupported: '
const MAX_COMIC_TITLE_LENGTH = 256
const MAX_COMIC_NOTE_TEXT_LENGTH = 100_000
const MAX_COMIC_ALT_LENGTH = 2_000
const MAX_COMIC_ASSET_ID_LENGTH = 512
const MAX_COMIC_URL_LENGTH = 8_192

interface ComicNoteData extends JsonObject {
  title: string
  text: string
}

interface ComicMediaSourceAsset extends JsonObject {
  type: 'asset'
  assetId: string
}

interface ComicMediaSourceUrl extends JsonObject {
  type: 'url'
  url: string
}

type ComicMediaSource = ComicMediaSourceAsset | ComicMediaSourceUrl

interface ComicImageData extends JsonObject {
  title: string
  source: ComicMediaSource
  alt: string
}

interface TemporaryAsset {
  readonly file: File
  readonly url: string
}

export interface ComicUnknownNodeProjection extends ComicCanvasNoteNodeProjection {
  readonly v2Type: string
  readonly v2KindVersion: number
  readonly readOnlyData: true
}

export type ComicCanvasNodeProjection = ComicCanvasNode | ComicUnknownNodeProjection

export interface ComicCanvasDocumentProjection extends Omit<ComicCanvasDocumentBaseProjection, 'nodes'> {
  readonly nodes: readonly ComicCanvasNodeProjection[]
}

export interface ComicCanvasWorkspaceSnapshot {
  readonly document: ComicCanvasDocumentProjection
  readonly open: boolean
  readonly selectedNodeId: string | null
  readonly selection: CanvasSelection
}

export interface ComicCanvasWorkspaceOptions {
  readonly initiallyOpen?: boolean
  /** Coordinator-owned services disable facade disposal. */
  readonly disposeService?: boolean
  readonly createId?: (kind: CanvasIdKind) => string
  readonly objectUrl?: CanvasObjectUrlApi
  readonly resolveAssetUrl?: (assetId: string) => string | undefined
  readonly readProjectFile?: CanvasProjectFileReader
  readonly mediaPolicy?: Partial<{
    readonly image: Partial<CanvasMediaPolicy['image']>
  }>
}

let generatedId = 0

function defaultId(kind: CanvasIdKind): string {
  generatedId += 1
  return `${kind}:v2-${generatedId}`
}

function defaultObjectUrl(): CanvasObjectUrlApi {
  return {
    createObjectURL: file => URL.createObjectURL(file),
    revokeObjectURL: url => { URL.revokeObjectURL(url) },
  }
}

function selection(nodeIds: readonly string[], edgeIds: readonly string[]): CanvasSelection {
  return Object.freeze({
    nodeIds: Object.freeze([...nodeIds]),
    edgeIds: Object.freeze([...edgeIds]),
  })
}

function own(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function boundedString(value: unknown, maximum: number, minimum = 0): value is string {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum
}

function isMediaSource(value: unknown): value is ComicMediaSource {
  if (!exactObject(value, value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'asset'
    ? ['type', 'assetId']
    : ['type', 'url'])) return false
  if (value.type === 'asset') return boundedString(value.assetId, MAX_COMIC_ASSET_ID_LENGTH, 1)
  if (value.type !== 'url' || !boundedString(value.url, MAX_COMIC_URL_LENGTH, 1)) return false
  try {
    const parsed = new URL(value.url)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.username === ''
      && parsed.password === ''
  } catch {
    return false
  }
}

function isNoteData(value: JsonObject): value is ComicNoteData {
  return exactObject(value, ['title', 'text'])
    && boundedString(value.title, MAX_COMIC_TITLE_LENGTH)
    && boundedString(value.text, MAX_COMIC_NOTE_TEXT_LENGTH)
}

function isImageData(value: JsonObject): value is ComicImageData {
  return exactObject(value, ['title', 'source', 'alt'])
    && boundedString(value.title, MAX_COMIC_TITLE_LENGTH)
    && boundedString(value.alt, MAX_COMIC_ALT_LENGTH)
    && isMediaSource(value.source)
}

function isNoteNode(node: CanvasNode): node is CanvasNode<ComicNoteData> {
  return node.type === COMIC_NOTE_NODE_TYPE
    && node.kindVersion === COMIC_KIND_VERSION
    && isNoteData(node.data)
}

function isImageNode(node: CanvasNode): node is CanvasNode<ComicImageData> {
  return node.type === COMIC_IMAGE_NODE_TYPE
    && node.kindVersion === COMIC_KIND_VERSION
    && isImageData(node.data)
}

function sizeOf(node: CanvasNode): ComicCanvasSize {
  const width = typeof node.style.width === 'number' && Number.isFinite(node.style.width) && node.style.width > 0
    ? node.style.width
    : 280
  const height = typeof node.style.height === 'number' && Number.isFinite(node.style.height) && node.style.height > 0
    ? node.style.height
    : 180
  return Object.freeze({ width, height })
}

function projectNode(node: CanvasNode): ComicCanvasNodeProjection {
  const common = {
    id: node.id,
    position: Object.freeze({ ...node.position }),
    size: sizeOf(node),
  }
  if (isNoteNode(node)) {
    return Object.freeze({ ...common, kind: 'note' as const, title: node.data.title, text: node.data.text })
  }
  if (isImageNode(node)) {
    const source = Object.freeze({ ...node.data.source }) as ComicCanvasMediaSource
    return Object.freeze({
      ...common,
      kind: 'image' as const,
      title: node.data.title,
      source,
      alt: node.data.alt,
    })
  }
  return Object.freeze({
    ...common,
    kind: 'note' as const,
    title: `${UNKNOWN_TITLE_PREFIX}${node.type}@${node.kindVersion}`,
    text: 'This Canvas node is available as a read-only card.',
    v2Type: node.type,
    v2KindVersion: node.kindVersion,
    readOnlyData: true as const,
  })
}

function projectEdge(edge: CanvasEdge): ComicCanvasEdgeProjection {
  return Object.freeze({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle === undefined ? {} : { sourceHandle: edge.sourceHandle }),
    ...(edge.targetHandle === undefined ? {} : { targetHandle: edge.targetHandle }),
  })
}

function projectDocument(document: CanvasDocument): ComicCanvasDocumentProjection {
  return Object.freeze({
    id: document.id,
    title: document.metadata.title,
    viewport: Object.freeze({ ...document.viewport }),
    nodes: Object.freeze(Object.keys(document.nodes).sort().map(id => projectNode(document.nodes[id]!))),
    edges: Object.freeze(Object.keys(document.edges).sort().map(id => projectEdge(document.edges[id]!))),
  })
}

function inputFiles(input: CanvasFileCollection): File[] {
  if (Symbol.iterator in Object(input)) return [...input as Iterable<File>]
  const result: File[] = []
  const arrayLike = input as ArrayLike<File>
  for (let index = 0; index < arrayLike.length; index += 1) {
    const file = arrayLike[index]
    if (file !== undefined) result.push(file)
  }
  return result
}

function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new TypeError('Project image content is not valid base64')
  }
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function defaultSize(kind: 'note' | 'image'): ComicCanvasSize {
  return kind === 'note' ? { width: 280, height: 180 } : { width: 320, height: 240 }
}

function pointer(...segments: string[]): string {
  return encodeJsonPointer(segments)
}

/** UI-boundary facade over one already-started V2 CanvasClientService. */
export class ComicCanvasWorkspace {
  #service: CanvasClientService
  readonly #createId: (kind: CanvasIdKind) => string
  readonly #objectUrl: CanvasObjectUrlApi
  readonly #resolveAssetUrl: ((assetId: string) => string | undefined) | undefined
  readonly #readProjectFile: CanvasProjectFileReader | undefined
  readonly #mediaPolicy: CanvasMediaPolicy
  readonly #disposeService: boolean
  readonly #lifecycle = new AbortController()
  readonly #temporaryAssets = new Map<string, TemporaryAsset>()
  readonly #listeners = new Set<() => void>()
  readonly #pending = new Set<Promise<void>>()
  readonly #errors: unknown[] = []
  #unsubscribeState: () => void
  #snapshot: ComicCanvasWorkspaceSnapshot
  #open: boolean
  #disposed = false
  #gesture: { forward: CanvasPatchOperation[]; backward: CanvasPatchOperation[] } | undefined

  constructor(service: CanvasClientService, options: ComicCanvasWorkspaceOptions = {}) {
    this.#service = service
    service.getSnapshot()
    this.#createId = options.createId ?? defaultId
    this.#objectUrl = options.objectUrl ?? defaultObjectUrl()
    this.#resolveAssetUrl = options.resolveAssetUrl
    this.#readProjectFile = options.readProjectFile
    this.#disposeService = options.disposeService ?? true
    this.#mediaPolicy = {
      image: {
        mimeTypes: options.mediaPolicy?.image?.mimeTypes ?? IMAGE_TYPES,
        maxBytes: options.mediaPolicy?.image?.maxBytes ?? DEFAULT_IMAGE_BYTES,
      },
    }
    this.#validatePolicy()
    this.#open = options.initiallyOpen ?? false
    this.#snapshot = this.#project()
    this.#unsubscribeState = this.#subscribeService(service)
  }

  /** Switch the active Canvas while retaining one stable workbench facade. */
  switchService(service: CanvasClientService): CanvasClientService {
    this.#assertActive()
    service.getSnapshot()
    if (service === this.#service) return service
    const previous = this.#service
    this.#unsubscribeState()
    this.#service = service
    this.#unsubscribeState = this.#subscribeService(service)
    this.#gesture = undefined
    this.#snapshot = this.#project()
    this.#releaseOrphanedTemporaryAssets()
    this.#emit()
    return previous
  }

  get errors(): readonly unknown[] {
    return Object.freeze([...this.#errors])
  }

  get renderers(): CanvasRendererRegistry {
    return this.#service.renderers
  }

  get sessionId(): string {
    return this.#service.clientId
  }

  get workspaceId(): string {
    return this.#service.workspaceId
  }

  getV2Node(id: string): CanvasNode | undefined {
    this.#assertActive()
    const node = this.#service.getSnapshot().nodes[id]
    return node === undefined ? undefined : structuredClone(node)
  }

  getV2Edge(id: string): CanvasEdge | undefined {
    this.#assertActive()
    const edge = this.#service.getSnapshot().edges[id]
    return edge === undefined ? undefined : structuredClone(edge)
  }

  updateV2Edge(id: string, changes: CanvasEdgeUpdate): Promise<ApplyCanvasPatchResult> {
    this.#assertActive()
    const edge = this.#service.getSnapshot().edges[id]
    if (edge === undefined) return Promise.reject(new Error(`canvas edge not found: ${id}`))
    if (!this.renderers.hasEdge(edge.type, edge.kindVersion) && changes.data !== undefined) {
      return Promise.reject(new TypeError(`unknown Canvas edge data is read-only: ${id}`))
    }
    const operations = edgeUpdatePatch(id, edge, changes)
    if (operations.length === 0) return Promise.reject(new TypeError('Canvas edge update requires a changed leaf'))
    return this.#service.applyOperations(operations)
  }

  removeV2Edge(id: string): Promise<ApplyCanvasPatchResult> {
    this.#assertActive()
    if (this.#service.getSnapshot().edges[id] === undefined) {
      return Promise.reject(new Error(`canvas edge not found: ${id}`))
    }
    return this.#service.applyOperations([{ op: 'remove', path: pointer('edges', id) }])
  }

  updateV2Node(id: string, changes: CanvasNodeUpdate): Promise<ApplyCanvasPatchResult> {
    this.#assertActive()
    const node = this.#service.getSnapshot().nodes[id]
    if (node === undefined) return Promise.reject(new Error(`canvas node not found: ${id}`))
    if (!this.renderers.hasNode(node.type, node.kindVersion) && changes.data !== undefined) {
      return Promise.reject(new TypeError(`unknown Canvas node data is read-only: ${id}`))
    }
    const operations = nodeUpdatePatch(id, node, changes)
    if (operations.length === 0) return Promise.reject(new TypeError('Canvas node update requires a changed leaf'))
    return this.#service.applyOperations(operations)
  }

  removeV2Node(id: string): Promise<ApplyCanvasPatchResult> {
    this.#assertActive()
    const document = this.#service.getSnapshot()
    if (document.nodes[id] === undefined) return Promise.reject(new Error(`canvas node not found: ${id}`))
    const operations: CanvasPatchOperation[] = Object.values(document.edges)
      .filter(edge => edge.source === id || edge.target === id)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(edge => ({ op: 'remove', path: pointer('edges', edge.id) }))
    operations.push({ op: 'remove', path: pointer('nodes', id) })
    return this.#service.applyOperations(operations)
  }

  getSnapshot = (): ComicCanvasWorkspaceSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#assertActive()
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  openCanvas(input?: unknown): void {
    this.#assertActive()
    if (input !== undefined) throw new TypeError('ComicCanvasWorkspace accepts only its started V2 CanvasClientService document')
    if (this.#open) return
    this.#open = true
    this.#snapshot = this.#project()
    this.#emit()
  }

  open(input?: unknown): void {
    this.openCanvas(input)
  }

  createNode(input: CanvasCreateNodeInput): string {
    this.#assertActive()
    this.#assertExactKeys(input, ['kind', 'position', 'size', 'title', 'text', 'alt', 'source', 'media'], 'node')
    const kind = input.kind === 'text' ? 'note' : input.kind
    if (kind !== 'note' && kind !== 'image') throw new TypeError('Convax Comic supports only note and image nodes')
    const document = this.#service.getSnapshot()
    const id = this.#freshId('node', new Set(Object.keys(document.nodes)))
    const size = input.size ?? defaultSize(kind)
    const title = input.title ?? input.media?.name ?? (kind === 'note' ? 'Note' : 'Image')
    let node: CanvasNode
    if (kind === 'note') {
      if (input.source !== undefined || input.media !== undefined || input.alt !== undefined) throw new TypeError('note nodes do not accept media fields')
      const data: ComicNoteData = { title, text: input.text ?? '' }
      if (!isNoteData(data)) throw new TypeError('note data does not match comic.note@1')
      node = {
        id,
        type: COMIC_NOTE_NODE_TYPE,
        kindVersion: COMIC_KIND_VERSION,
        position: { ...input.position },
        zIndex: 0,
        style: { width: size.width, height: size.height },
        data,
      }
    } else {
      if (input.text !== undefined) throw new TypeError('image nodes do not accept text')
      const source = this.#mediaSource(input.source, input.media, document)
      const data: ComicImageData = { title, source, alt: input.alt ?? title }
      if (!isImageData(data)) throw new TypeError('image data does not match comic.image@1')
      node = {
        id,
        type: COMIC_IMAGE_NODE_TYPE,
        kindVersion: COMIC_KIND_VERSION,
        position: { ...input.position },
        zIndex: 0,
        style: { width: size.width, height: size.height },
        data,
      }
    }
    this.#submit([{ op: 'add', path: pointer('nodes', id), value: node }])
    return id
  }

  updateNode(id: string, patch: CanvasUpdateNodePatch): void {
    this.#assertActive()
    this.#assertExactKeys(patch, ['title', 'text', 'alt', 'position', 'size', 'source', 'media'], 'patch')
    if (patch.source !== undefined && patch.media !== undefined) throw new TypeError('provide either source or media, not both')
    const node = this.#node(id)
    const operations: CanvasPatchOperation[] = []
    if (!isNoteNode(node) && !isImageNode(node)) {
      if (patch.title !== undefined || patch.text !== undefined || patch.alt !== undefined || patch.source !== undefined || patch.media !== undefined) {
        throw new TypeError(`unknown Canvas node data is read-only: ${id}`)
      }
      this.#geometryOperations(node, patch, operations)
    } else if (isNoteNode(node)) {
      if (patch.source !== undefined || patch.media !== undefined || patch.alt !== undefined) throw new TypeError('note nodes do not accept media fields')
      if (patch.title !== undefined && !boundedString(patch.title, MAX_COMIC_TITLE_LENGTH)) throw new TypeError('note title does not match comic.note@1')
      if (patch.text !== undefined && !boundedString(patch.text, MAX_COMIC_NOTE_TEXT_LENGTH)) throw new TypeError('note text does not match comic.note@1')
      this.#geometryOperations(node, patch, operations)
      if (patch.title !== undefined && patch.title !== node.data.title) operations.push({ op: 'replace', path: pointer('nodes', id, 'data', 'title'), value: patch.title })
      if (patch.text !== undefined && patch.text !== node.data.text) operations.push({ op: 'replace', path: pointer('nodes', id, 'data', 'text'), value: patch.text })
    } else {
      if (patch.text !== undefined) throw new TypeError('image nodes do not accept text')
      if (patch.title !== undefined && !boundedString(patch.title, MAX_COMIC_TITLE_LENGTH)) throw new TypeError('image title does not match comic.image@1')
      if (patch.alt !== undefined && !boundedString(patch.alt, MAX_COMIC_ALT_LENGTH)) throw new TypeError('image alt does not match comic.image@1')
      this.#geometryOperations(node, patch, operations)
      if (patch.title !== undefined && patch.title !== node.data.title) operations.push({ op: 'replace', path: pointer('nodes', id, 'data', 'title'), value: patch.title })
      if (patch.alt !== undefined && patch.alt !== node.data.alt) operations.push({ op: 'replace', path: pointer('nodes', id, 'data', 'alt'), value: patch.alt })
      if (patch.source !== undefined || patch.media !== undefined) {
        const source = this.#mediaSource(patch.source, patch.media, this.#service.getSnapshot())
        for (const key of Object.keys(source).sort()) {
          const previous = node.data.source[key]
          const next = source[key]
          if (previous !== undefined && next !== undefined && !Object.is(previous, next)) {
            operations.push({ op: 'replace', path: pointer('nodes', id, 'data', 'source', key), value: next })
          }
        }
        if (node.data.source.type !== source.type || Object.keys(node.data.source).some(key => !(key in source))) {
          throw new TypeError('changing image source kind requires creating a new image node')
        }
      }
    }
    this.#submit(operations)
  }

  moveNode(id: string, position: ComicCanvasPoint): void {
    this.updateNode(id, { position })
  }

  moveNodes(inputs: readonly CanvasMoveNodeInput[]): void {
    this.#assertActive()
    const seen = new Set<string>()
    const operations: CanvasPatchOperation[] = []
    for (const input of inputs) {
      this.#assertExactKeys(input, ['id', 'position'], 'move')
      if (seen.has(input.id)) throw new TypeError(`duplicate move for node: ${input.id}`)
      seen.add(input.id)
      const node = this.#node(input.id)
      if (node.position.x !== input.position.x) operations.push({ op: 'replace', path: pointer('nodes', input.id, 'position', 'x'), value: input.position.x })
      if (node.position.y !== input.position.y) operations.push({ op: 'replace', path: pointer('nodes', input.id, 'position', 'y'), value: input.position.y })
    }
    this.#submit(operations)
  }

  duplicateNodes(ids: readonly string[], offset: ComicCanvasPoint = { x: 32, y: 32 }): string[] {
    this.#assertActive()
    const document = this.#service.getSnapshot()
    const requested = new Set(ids)
    const used = new Set(Object.keys(document.nodes))
    const operations: CanvasPatchOperation[] = []
    const created: string[] = []
    for (const oldId of Object.keys(document.nodes).sort()) {
      if (!requested.has(oldId)) continue
      const current = document.nodes[oldId]!
      if (!isNoteNode(current) && !isImageNode(current)) {
        throw new TypeError(`unknown Canvas nodes cannot be duplicated: ${oldId}`)
      }
      const id = this.#freshId('node', used)
      used.add(id)
      created.push(id)
      operations.push({
        op: 'add',
        path: pointer('nodes', id),
        value: {
          ...structuredClone(current),
          id,
          position: { x: current.position.x + offset.x, y: current.position.y + offset.y },
        },
      })
    }
    this.#submit(operations)
    return created
  }

  removeNodes(ids: readonly string[]): void {
    this.removeElements(ids, [])
  }

  removeEdges(ids: readonly string[]): void {
    this.removeElements([], ids)
  }

  removeElements(nodeIds: readonly string[], edgeIds: readonly string[]): void {
    this.#assertActive()
    const document = this.#service.getSnapshot()
    const removeNodes = new Set(nodeIds.filter(id => own(document.nodes, id)))
    const removeEdges = new Set(edgeIds.filter(id => own(document.edges, id)))
    for (const edge of Object.values(document.edges)) {
      if (removeNodes.has(edge.source) || removeNodes.has(edge.target)) removeEdges.add(edge.id)
    }
    const operations: CanvasPatchOperation[] = [
      ...[...removeEdges].sort().map(id => ({ op: 'remove' as const, path: pointer('edges', id) })),
      ...[...removeNodes].sort().map(id => ({ op: 'remove' as const, path: pointer('nodes', id) })),
    ]
    this.#submit(operations)
  }

  connect(input: CanvasConnectInput): string {
    this.#assertActive()
    this.#assertExactKeys(input, ['source', 'target', 'sourceHandle', 'targetHandle'], 'edge')
    const document = this.#service.getSnapshot()
    if (!own(document.nodes, input.source)) throw new Error(`source node not found: ${input.source}`)
    if (!own(document.nodes, input.target)) throw new Error(`target node not found: ${input.target}`)
    const duplicate = Object.values(document.edges).find(edge =>
      edge.type === COMIC_SEQUENCE_EDGE_TYPE
      && edge.kindVersion === COMIC_KIND_VERSION
      && edge.source === input.source
      && edge.target === input.target
      && (edge.sourceHandle ?? null) === (input.sourceHandle ?? null)
      && (edge.targetHandle ?? null) === (input.targetHandle ?? null))
    if (duplicate !== undefined) return duplicate.id
    const id = this.#freshId('edge', new Set(Object.keys(document.edges)))
    const edge: CanvasEdge = {
      id,
      type: COMIC_SEQUENCE_EDGE_TYPE,
      kindVersion: COMIC_KIND_VERSION,
      source: input.source,
      target: input.target,
      ...(input.sourceHandle === undefined || input.sourceHandle === null ? {} : { sourceHandle: input.sourceHandle }),
      ...(input.targetHandle === undefined || input.targetHandle === null ? {} : { targetHandle: input.targetHandle }),
      data: { label: '' },
    }
    this.#submit([{ op: 'add', path: pointer('edges', id), value: edge }])
    return id
  }

  setViewport(viewport: ComicCanvasViewport): void {
    this.#assertActive()
    const current = this.#service.getSnapshot().viewport
    const operations: CanvasPatchOperation[] = []
    for (const key of ['x', 'y', 'zoom'] as const) {
      if (!Object.is(current[key], viewport[key])) operations.push({ op: 'replace', path: pointer('viewport', key), value: viewport[key] })
    }
    this.#submit(operations, false)
  }

  setSelection(next: { readonly nodeIds?: readonly string[]; readonly edgeIds?: readonly string[] }): void {
    this.#assertActive()
    this.#assertExactKeys(next, ['nodeIds', 'edgeIds'], 'selection', true)
    const document = this.#service.getSnapshot()
    const nodeIds = [...new Set(next.nodeIds ?? [])]
    const edgeIds = [...new Set(next.edgeIds ?? [])]
    for (const id of nodeIds) if (!own(document.nodes, id)) throw new Error(`node not found: ${id}`)
    for (const id of edgeIds) if (!own(document.edges, id)) throw new Error(`edge not found: ${id}`)
    this.#service.selectNodes(nodeIds)
    this.#service.selectEdges(edgeIds)
  }

  selectNode(id: string | null): void {
    this.setSelection({ nodeIds: id === null ? [] : [id], edgeIds: [] })
  }

  beginGesture(): void {
    this.#assertActive()
    this.#gesture ??= { forward: [], backward: [] }
  }

  endGesture(): void {
    this.#assertActive()
    const gesture = this.#gesture
    this.#gesture = undefined
    if (gesture === undefined || gesture.forward.length === 0) return
    this.#service.history.record({ forward: gesture.forward, backward: gesture.backward })
  }

  undo(): boolean {
    this.#assertActive()
    if (!this.#service.history.canUndo) return false
    this.#track(this.#service.undo())
    return true
  }

  redo(): boolean {
    this.#assertActive()
    if (!this.#service.history.canRedo) return false
    this.#track(this.#service.redo())
    return true
  }

  getMediaPreviewUrl(id: string): string | undefined {
    const node = this.#service.getSnapshot().nodes[id]
    if (node === undefined || !isImageNode(node)) return undefined
    const source = node.data.source
    if (source.type === 'url') return source.url
    return this.#temporaryAssets.get(source.assetId)?.url ?? this.#resolveAssetUrl?.(source.assetId)
  }

  async addProjectFile(path: string, position: ComicCanvasPoint): Promise<string[]> {
    this.#assertActive()
    const reader = this.#readProjectFile
    if (reader === undefined) throw new Error('Project file import is unavailable')
    const service = this.#service
    const content = await reader(path, this.#lifecycle.signal)
    this.#assertActive()
    if (service !== this.#service) throw new Error('Canvas changed before the project file could be added')
    this.#lifecycle.signal.throwIfAborted()
    if (content.path !== path) throw new TypeError('Project file response path does not match the requested path')
    if (content.kind === 'text') {
      const id = this.createNode({ kind: 'note', position, title: content.name, text: content.text })
      return [id]
    }
    const bytes = decodeBase64(content.dataBase64)
    if (bytes.byteLength !== content.size) throw new TypeError('Project image response size does not match its content')
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    const file = new File([buffer], content.name, { type: content.mimeType })
    return this.addDroppedFiles([file], position)
  }

  async addDroppedFiles(files: CanvasFileCollection, position: ComicCanvasPoint): Promise<string[]> {
    this.#assertActive()
    const batch = inputFiles(files)
    if (batch.length === 0) return []
    for (const file of batch) this.#validateFile(file)
    const document = this.#service.getSnapshot()
    const usedAssets = new Set(this.#temporaryAssets.keys())
    for (const node of Object.values(document.nodes)) {
      if (isImageNode(node) && node.data.source.type === 'asset') usedAssets.add(node.data.source.assetId)
    }
    const usedNodes = new Set(Object.keys(document.nodes))
    const entries = batch.map((file, index) => {
      const assetId = this.#freshId('asset', usedAssets)
      usedAssets.add(assetId)
      const id = this.#freshId('node', usedNodes)
      usedNodes.add(id)
      const title = file.name || 'Image'
      const node: CanvasNode = {
        id,
        type: COMIC_IMAGE_NODE_TYPE,
        kindVersion: COMIC_KIND_VERSION,
        position: { x: position.x + index * 28, y: position.y + index * 28 },
        zIndex: 0,
        style: { width: 320, height: 240 },
        data: { title, source: { type: 'asset', assetId }, alt: title },
      }
      return { assetId, file, id, node }
    })
    const allocated: Array<{ assetId: string; file: File; url: string }> = []
    try {
      for (const entry of entries) allocated.push({ ...entry, url: this.#objectUrl.createObjectURL(entry.file) })
    } catch (error) {
      for (const entry of allocated) this.#objectUrl.revokeObjectURL(entry.url)
      throw error
    }
    for (const entry of allocated) this.#temporaryAssets.set(entry.assetId, { file: entry.file, url: entry.url })
    this.#submit(entries.map(entry => ({ op: 'add', path: pointer('nodes', entry.id), value: entry.node })))
    return entries.map(entry => entry.id)
  }

  async flush(): Promise<void> {
    this.#assertActive()
    await this.#service.flush()
    await Promise.all([...this.#pending])
    if (this.#errors.length > 0) throw new AggregateError(this.#errors, 'Comic Canvas workspace mutations failed')
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#lifecycle.abort(new Error('Comic Canvas workspace disposed'))
    this.#unsubscribeState()
    for (const asset of this.#temporaryAssets.values()) this.#objectUrl.revokeObjectURL(asset.url)
    this.#temporaryAssets.clear()
    this.#listeners.clear()
    this.#gesture = undefined
    if (this.#disposeService) this.#track(this.#service.dispose())
  }

  #subscribeService(service: CanvasClientService): () => void {
    return service.subscribeState(() => {
      if (this.#disposed || service !== this.#service) return
      this.#snapshot = this.#project()
      this.#releaseOrphanedTemporaryAssets()
      this.#emit()
    })
  }

  #project(): ComicCanvasWorkspaceSnapshot {
    const state = this.#service.getStateSnapshot()
    const document = projectDocument(this.#service.getSnapshot())
    const currentSelection = selection(state.selectedNodeIds, state.selectedEdgeIds)
    return Object.freeze({
      document,
      open: this.#open,
      selectedNodeId: currentSelection.nodeIds[0] ?? null,
      selection: currentSelection,
    })
  }

  #submit(operations: readonly CanvasPatchOperation[], recordHistory = true): void {
    if (operations.length === 0) return
    const current = this.#service.getSnapshot()
    const gesture = this.#gesture
    if (gesture !== undefined && recordHistory) {
      const backward = invertCanvasPatch(current, operations)
      gesture.forward.push(...operations)
      gesture.backward.unshift(...backward)
      this.#track(this.#service.applyPatch({ operations }, false))
    } else {
      this.#track(this.#service.applyPatch({ operations }, recordHistory))
    }
  }

  #geometryOperations(node: CanvasNode, patch: CanvasUpdateNodePatch, operations: CanvasPatchOperation[]): void {
    if (patch.position !== undefined) {
      if (patch.position.x !== node.position.x) operations.push({ op: 'replace', path: pointer('nodes', node.id, 'position', 'x'), value: patch.position.x })
      if (patch.position.y !== node.position.y) operations.push({ op: 'replace', path: pointer('nodes', node.id, 'position', 'y'), value: patch.position.y })
    }
    if (patch.size === undefined) return
    const widthExists = typeof node.style.width === 'number'
    const heightExists = typeof node.style.height === 'number'
    if (widthExists && heightExists) {
      if (patch.size.width !== node.style.width) operations.push({ op: 'replace', path: pointer('nodes', node.id, 'style', 'width'), value: patch.size.width })
      if (patch.size.height !== node.style.height) operations.push({ op: 'replace', path: pointer('nodes', node.id, 'style', 'height'), value: patch.size.height })
      return
    }
    const document = this.#service.getSnapshot()
    const incidentEdges = Object.values(document.edges)
      .filter(edge => edge.source === node.id || edge.target === node.id)
      .sort((left, right) => left.id.localeCompare(right.id))
    const replacement: CanvasNode = structuredClone(node)
    replacement.style = { ...replacement.style, width: patch.size.width, height: patch.size.height }
    operations.push(
      ...incidentEdges.map(edge => ({ op: 'remove' as const, path: pointer('edges', edge.id) })),
      { op: 'remove', path: pointer('nodes', node.id) },
      { op: 'add', path: pointer('nodes', node.id), value: replacement },
      ...incidentEdges.map(edge => ({ op: 'add' as const, path: pointer('edges', edge.id), value: structuredClone(edge) })),
    )
  }

  #mediaSource(source: ComicCanvasMediaSource | undefined, media: CanvasCreateNodeInput['media'], document: CanvasDocument): ComicMediaSource {
    if (source !== undefined && media !== undefined) throw new TypeError('provide either source or media, not both')
    const candidate: unknown = source ?? (media === undefined ? undefined : { type: 'url', url: media.src })
    if (candidate !== undefined) {
      if (!isMediaSource(candidate)) throw new TypeError('image source must be a non-empty asset or safe HTTP(S) URL')
      return structuredClone(candidate)
    }
    const used = new Set(this.#temporaryAssets.keys())
    for (const node of Object.values(document.nodes)) {
      if (isImageNode(node) && node.data.source.type === 'asset') used.add(node.data.source.assetId)
    }
    return { type: 'asset', assetId: this.#freshId('asset', used) }
  }

  #node(id: string): CanvasNode {
    const node = this.#service.getSnapshot().nodes[id]
    if (node === undefined) throw new Error(`node not found: ${id}`)
    return node
  }

  #freshId(kind: CanvasIdKind, used: ReadonlySet<string>): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = this.#createId(kind)
      if (!used.has(id)) return id
    }
    throw new Error(`could not create a unique ${kind} id`)
  }

  #validateFile(file: File): void {
    const type = file.type.toLowerCase()
    if (!this.#mediaPolicy.image.mimeTypes.includes(type)) throw new CanvasFileError('unsupported-type', file.name, `unsupported media type: ${file.type || '(empty)'}`)
    if (file.size <= 0) throw new CanvasFileError('empty', file.name, 'empty files are not supported')
    if (file.size > this.#mediaPolicy.image.maxBytes) throw new CanvasFileError('too-large', file.name, 'image file exceeds the size limit')
  }

  #validatePolicy(): void {
    const policy = this.#mediaPolicy.image
    if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes <= 0) throw new TypeError('image maxBytes must be a positive safe integer')
    if (policy.mimeTypes.length === 0 || policy.mimeTypes.some(item => typeof item !== 'string' || item === '')) throw new TypeError('image mimeTypes must be a non-empty string list')
  }

  #releaseOrphanedTemporaryAssets(): void {
    const referenced = new Set<string>()
    for (const node of Object.values(this.#service.getSnapshot().nodes)) {
      if (isImageNode(node) && node.data.source.type === 'asset') referenced.add(node.data.source.assetId)
    }
    for (const [assetId, asset] of this.#temporaryAssets) {
      if (referenced.has(assetId)) continue
      this.#objectUrl.revokeObjectURL(asset.url)
      this.#temporaryAssets.delete(assetId)
    }
  }

  #track(task: Promise<unknown>): void {
    const tracked = task.then(
      () => undefined,
      error => {
        this.#errors.push(error)
        if (!this.#disposed) this.#emit()
      },
    ).finally(() => { this.#pending.delete(tracked) })
    this.#pending.add(tracked)
  }

  #assertExactKeys(value: object, keys: readonly string[], name: string, optional = false): void {
    const allowed = new Set(keys)
    for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${name}.${key}: unknown field`)
    if (!optional) return
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener()
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('ComicCanvasWorkspace has been disposed')
  }
}
