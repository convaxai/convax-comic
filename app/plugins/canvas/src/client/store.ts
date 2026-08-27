import {
  CANVAS_DOCUMENT_VERSION,
  parseCanvasDocument,
  serializeCanvasDocument,
  type CanvasDocumentV1,
  type CanvasEdgeV1,
  type CanvasMediaSourceV1,
  type CanvasNodeV1,
  type CanvasPointV1,
  type CanvasSizeV1,
  type CanvasViewportV1,
} from '../schema.ts'

const DEFAULT_IMAGE_BYTES = 25 * 1024 * 1024
const IMAGE_TYPES = ['image/gif', 'image/jpeg', 'image/png', 'image/webp'] as const

export type CanvasIdKind = 'asset' | 'document' | 'edge' | 'node'
export type CanvasPersistentNodeKind = CanvasNodeV1['kind']
export type CanvasCreateNodeKind = 'image' | 'note' | 'text'

export interface CanvasSelection {
  readonly nodeIds: readonly string[]
  readonly edgeIds: readonly string[]
}

export interface CanvasWorkspaceSnapshot {
  readonly document: CanvasDocumentV1
  readonly open: boolean
  readonly selectedNodeId: string | null
  readonly selection: CanvasSelection
}

export interface CanvasObjectUrlApi {
  createObjectURL(file: Blob): string
  revokeObjectURL(url: string): void
}

export interface CanvasMediaPolicy {
  readonly image: {
    readonly mimeTypes: readonly string[]
    readonly maxBytes: number
  }
}

export interface CanvasWorkspaceOptions {
  readonly initialDocument?: unknown
  readonly initiallyOpen?: boolean
  readonly createId?: (kind: CanvasIdKind) => string
  readonly objectUrl?: CanvasObjectUrlApi
  readonly resolveAssetUrl?: (assetId: string) => string | undefined
  readonly mediaPolicy?: Partial<{
    readonly image: Partial<CanvasMediaPolicy['image']>
  }>
}

export interface CanvasMediaInput {
  readonly src: string
  readonly name?: string
  readonly mimeType?: string
}

export interface CanvasCreateNodeInput {
  readonly kind: CanvasCreateNodeKind
  readonly position: CanvasPointV1
  readonly size?: CanvasSizeV1
  readonly title?: string
  readonly text?: string
  readonly alt?: string
  readonly source?: CanvasMediaSourceV1
  readonly media?: CanvasMediaInput
}

export interface CanvasUpdateNodePatch {
  readonly title?: string
  readonly text?: string
  readonly alt?: string
  readonly position?: CanvasPointV1
  readonly size?: CanvasSizeV1
  readonly source?: CanvasMediaSourceV1
  readonly media?: CanvasMediaInput
}

export interface CanvasMoveNodeInput {
  readonly id: string
  readonly position: CanvasPointV1
}

export interface CanvasConnectInput {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

export type CanvasFileCollection = ArrayLike<File> | Iterable<File>

export type CanvasFileErrorCode = 'empty' | 'too-large' | 'unsupported-type' | 'wrong-kind'

export class CanvasFileError extends Error {
  readonly code: CanvasFileErrorCode
  readonly fileName: string

  constructor(code: CanvasFileErrorCode, fileName: string, message: string) {
    super(message)
    this.name = 'CanvasFileError'
    this.code = code
    this.fileName = fileName
  }
}

interface TemporaryAsset {
  readonly file: File
  readonly url: string
}

function defaultId(kind: CanvasIdKind): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${kind}:${suffix}`
}

function defaultObjectUrlApi(): CanvasObjectUrlApi {
  return {
    createObjectURL(file): string {
      return URL.createObjectURL(file)
    },
    revokeObjectURL(url): void {
      URL.revokeObjectURL(url)
    },
  }
}

function mergeMediaPolicy(input: CanvasWorkspaceOptions['mediaPolicy']): CanvasMediaPolicy {
  return {
    image: {
      mimeTypes: input?.image?.mimeTypes ?? IMAGE_TYPES,
      maxBytes: input?.image?.maxBytes ?? DEFAULT_IMAGE_BYTES,
    },
  }
}

function freezeDocument(document: CanvasDocumentV1): CanvasDocumentV1 {
  for (const node of document.nodes) {
    Object.freeze(node.position)
    Object.freeze(node.size)
    if (node.kind !== 'note') Object.freeze(node.source)
    Object.freeze(node)
  }
  for (const edge of document.edges) Object.freeze(edge)
  Object.freeze(document.nodes)
  Object.freeze(document.edges)
  Object.freeze(document.viewport)
  return Object.freeze(document)
}

function selection(nodeIds: readonly string[] = [], edgeIds: readonly string[] = []): CanvasSelection {
  return Object.freeze({ nodeIds: Object.freeze([...nodeIds]), edgeIds: Object.freeze([...edgeIds]) })
}

function mediaSourceFromInput(source: CanvasMediaSourceV1 | undefined, media: CanvasMediaInput | undefined): CanvasMediaSourceV1 {
  if (source !== undefined && media !== undefined) throw new TypeError('provide either source or media, not both')
  if (source !== undefined) return source
  if (media !== undefined) return { type: 'url', url: media.src }
  throw new TypeError('image nodes require a media source')
}

function inputFiles(input: CanvasFileCollection): File[] {
  if (Symbol.iterator in Object(input)) return [...input as Iterable<File>]
  const arrayLike = input as ArrayLike<File>
  const result: File[] = []
  for (let index = 0; index < arrayLike.length; index += 1) {
    const file = arrayLike[index]
    if (file !== undefined) result.push(file)
  }
  return result
}

function defaultSize(kind: 'image' | 'note'): CanvasSizeV1 {
  if (kind === 'note') return { width: 280, height: 180 }
  return { width: 320, height: 240 }
}

function exactInputKeys(value: object, keys: readonly string[], name: string): void {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${name}.${key}: unknown field`)
  }
}

export class CanvasWorkspace {
  readonly #createId: (kind: CanvasIdKind) => string
  readonly #objectUrl: CanvasObjectUrlApi
  readonly #resolveAssetUrl: ((assetId: string) => string | undefined) | undefined
  readonly #mediaPolicy: CanvasMediaPolicy
  readonly #listeners = new Set<() => void>()
  readonly #temporaryAssets = new Map<string, TemporaryAsset>()
  readonly #undoStack: CanvasDocumentV1[] = []
  readonly #redoStack: CanvasDocumentV1[] = []
  #gestureBaseline: CanvasDocumentV1 | undefined
  #snapshot: CanvasWorkspaceSnapshot
  #disposed = false

  constructor(options: CanvasWorkspaceOptions = {}) {
    this.#createId = options.createId ?? defaultId
    this.#objectUrl = options.objectUrl ?? defaultObjectUrlApi()
    this.#resolveAssetUrl = options.resolveAssetUrl
    this.#mediaPolicy = mergeMediaPolicy(options.mediaPolicy)
    this.#validatePolicy()
    const document = options.initialDocument === undefined
      ? parseCanvasDocument({
          version: CANVAS_DOCUMENT_VERSION,
          id: this.#freshId('document', new Set()),
          title: 'Untitled canvas',
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes: [],
          edges: [],
        })
      : parseCanvasDocument(options.initialDocument)
    this.#snapshot = this.#makeSnapshot(freezeDocument(document), options.initiallyOpen ?? false, selection())
  }

  getSnapshot = (): CanvasWorkspaceSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#assertActive()
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  openCanvas(input?: unknown): void {
    this.#assertActive()
    if (input !== undefined) {
      const next = freezeDocument(parseCanvasDocument(input))
      this.#undoStack.length = 0
      this.#redoStack.length = 0
      this.#gestureBaseline = undefined
      this.#releaseAllTemporaryAssets()
      this.#snapshot = this.#makeSnapshot(next, true, selection())
    } else if (!this.#snapshot.open) {
      this.#snapshot = this.#makeSnapshot(this.#snapshot.document, true, this.#snapshot.selection)
    } else {
      return
    }
    this.#emit()
  }

  open(input?: unknown): void {
    this.openCanvas(input)
  }

  closeCanvas(): void {
    this.#assertActive()
    if (!this.#snapshot.open) return
    this.#snapshot = this.#makeSnapshot(this.#snapshot.document, false, selection())
    this.#emit()
  }

  importDocument(input: unknown): void {
    this.openCanvas(input)
  }

  /** Apply an authoritative Host snapshot without dropping browser-only asset URLs. */
  syncDocument(input: unknown): void {
    this.#assertActive()
    const document = freezeDocument(parseCanvasDocument(input))
    if (serializeCanvasDocument(document) === serializeCanvasDocument(this.#snapshot.document)) return
    this.#undoStack.length = 0
    this.#redoStack.length = 0
    this.#gestureBaseline = undefined
    this.#setDocument(document)
  }

  serialize(): string {
    return serializeCanvasDocument(this.#snapshot.document)
  }

  createNode(input: CanvasCreateNodeInput): string {
    this.#assertActive()
    exactInputKeys(input, ['kind', 'position', 'size', 'title', 'text', 'alt', 'source', 'media'], 'node')
    const requestedKind: unknown = input.kind
    if (requestedKind !== 'text' && requestedKind !== 'note' && requestedKind !== 'image') {
      throw new TypeError('Convax Comic supports only note and image nodes')
    }
    const kind = requestedKind === 'text' ? 'note' : requestedKind
    const id = this.#freshId('node', new Set(this.#snapshot.document.nodes.map((node) => node.id)))
    const title = input.title ?? input.media?.name ?? (kind === 'note' ? 'Note' : 'Image')
    const usedAssets = new Set(this.#temporaryAssets.keys())
    for (const current of this.#snapshot.document.nodes) {
      if (current.kind !== 'note' && current.source.type === 'asset') usedAssets.add(current.source.assetId)
    }
    const newMediaSource = (): CanvasMediaSourceV1 => input.source === undefined && input.media === undefined
      ? { type: 'asset', assetId: this.#freshId('asset', usedAssets) }
      : mediaSourceFromInput(input.source, input.media)
    let node: CanvasNodeV1
    if (kind === 'note') {
      if (input.source !== undefined || input.media !== undefined || input.alt !== undefined) {
        throw new TypeError('note nodes do not accept media fields')
      }
      node = { id, kind, position: input.position, size: input.size ?? defaultSize(kind), title, text: input.text ?? '' }
    } else {
      if (input.text !== undefined) throw new TypeError('image nodes do not accept text')
      node = {
        id,
        kind,
        position: input.position,
        size: input.size ?? defaultSize(kind),
        title,
        source: newMediaSource(),
        alt: input.alt ?? title,
      }
    }
    this.#commit({ ...this.#snapshot.document, nodes: [...this.#snapshot.document.nodes, node] })
    return id
  }

  addNode(input: CanvasCreateNodeInput): string {
    return this.createNode(input)
  }

  updateNode(id: string, patch: CanvasUpdateNodePatch): void {
    this.#assertActive()
    exactInputKeys(patch, ['title', 'text', 'alt', 'position', 'size', 'source', 'media'], 'patch')
    if (patch.source !== undefined && patch.media !== undefined) throw new TypeError('provide either source or media, not both')
    const index = this.#nodeIndex(id)
    const previous = this.#snapshot.document.nodes[index]
    if (previous === undefined) throw new Error(`node not found: ${id}`)
    let next: CanvasNodeV1
    if (previous.kind === 'note') {
      if (patch.source !== undefined || patch.media !== undefined || patch.alt !== undefined) {
        throw new TypeError('note nodes do not accept media fields')
      }
      next = {
        ...previous,
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.text === undefined ? {} : { text: patch.text }),
        ...(patch.position === undefined ? {} : { position: patch.position }),
        ...(patch.size === undefined ? {} : { size: patch.size }),
      }
    } else if (previous.kind === 'image') {
      if (patch.text !== undefined) throw new TypeError('image nodes do not accept text')
      next = {
        ...previous,
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.alt === undefined ? {} : { alt: patch.alt }),
        ...(patch.position === undefined ? {} : { position: patch.position }),
        ...(patch.size === undefined ? {} : { size: patch.size }),
        ...(patch.source === undefined && patch.media === undefined
          ? {}
          : { source: mediaSourceFromInput(patch.source, patch.media) }),
      }
    } else {
      if (patch.text !== undefined || patch.alt !== undefined) throw new TypeError('video nodes do not accept text or alt')
      next = {
        ...previous,
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.position === undefined ? {} : { position: patch.position }),
        ...(patch.size === undefined ? {} : { size: patch.size }),
        ...(patch.source === undefined && patch.media === undefined
          ? {}
          : { source: mediaSourceFromInput(patch.source, patch.media) }),
      }
    }
    const nodes = [...this.#snapshot.document.nodes]
    nodes[index] = next
    this.#commit({ ...this.#snapshot.document, nodes })
  }

  moveNode(id: string, position: CanvasPointV1): void {
    this.updateNode(id, { position })
  }

  moveNodes(inputs: readonly CanvasMoveNodeInput[]): void {
    this.#assertActive()
    const positions = new Map<string, CanvasPointV1>()
    for (const input of inputs) {
      exactInputKeys(input, ['id', 'position'], 'move')
      if (positions.has(input.id)) throw new TypeError(`duplicate move for node: ${input.id}`)
      if (this.#snapshot.document.nodes.every(node => node.id !== input.id)) throw new Error(`node not found: ${input.id}`)
      positions.set(input.id, input.position)
    }
    if (positions.size === 0) return
    let changed = false
    const nodes = this.#snapshot.document.nodes.map(node => {
      const position = positions.get(node.id)
      if (position === undefined || (position.x === node.position.x && position.y === node.position.y)) return node
      changed = true
      return { ...node, position } as CanvasNodeV1
    })
    if (changed) this.#commit({ ...this.#snapshot.document, nodes })
  }

  resizeNode(id: string, size: CanvasSizeV1): void {
    this.updateNode(id, { size })
  }

  duplicateNode(ids: readonly string[], offset: CanvasPointV1 = { x: 32, y: 32 }): string[] {
    this.#assertActive()
    const requested = new Set(ids)
    const used = new Set(this.#snapshot.document.nodes.map((node) => node.id))
    const copies: CanvasNodeV1[] = []
    for (const current of this.#snapshot.document.nodes) {
      if (!requested.has(current.id)) continue
      const id = this.#freshId('node', used)
      used.add(id)
      copies.push({
        ...current,
        id,
        position: { x: current.position.x + offset.x, y: current.position.y + offset.y },
        size: { ...current.size },
        ...(current.kind === 'note' ? {} : { source: { ...current.source } }),
      } as CanvasNodeV1)
    }
    if (copies.length === 0) return []
    this.#commit({ ...this.#snapshot.document, nodes: [...this.#snapshot.document.nodes, ...copies] })
    return copies.map((node) => node.id)
  }

  duplicateNodes(ids: readonly string[], offset?: CanvasPointV1): string[] {
    return offset === undefined ? this.duplicateNode(ids) : this.duplicateNode(ids, offset)
  }

  removeNodes(ids: readonly string[]): void {
    this.removeElements(ids, [])
  }

  removeElements(nodeIds: readonly string[], edgeIds: readonly string[]): void {
    this.#assertActive()
    const removed = new Set(nodeIds)
    const removedEdges = new Set(edgeIds)
    const nodes = this.#snapshot.document.nodes.filter((node) => !removed.has(node.id))
    const edges = this.#snapshot.document.edges.filter((edge) =>
      !removedEdges.has(edge.id) && !removed.has(edge.source) && !removed.has(edge.target))
    if (nodes.length === this.#snapshot.document.nodes.length && edges.length === this.#snapshot.document.edges.length) return
    this.#commit({ ...this.#snapshot.document, nodes, edges })
  }

  removeNode(id: string): void {
    this.removeNodes([id])
  }

  connect(input: CanvasConnectInput): string {
    this.#assertActive()
    exactInputKeys(input, ['source', 'target', 'sourceHandle', 'targetHandle'], 'edge')
    const nodeIds = new Set(this.#snapshot.document.nodes.map((node) => node.id))
    if (!nodeIds.has(input.source)) throw new Error(`source node not found: ${input.source}`)
    if (!nodeIds.has(input.target)) throw new Error(`target node not found: ${input.target}`)
    const duplicate = this.#snapshot.document.edges.find((edge) =>
      edge.source === input.source
      && edge.target === input.target
      && (edge.sourceHandle ?? null) === (input.sourceHandle ?? null)
      && (edge.targetHandle ?? null) === (input.targetHandle ?? null))
    if (duplicate !== undefined) return duplicate.id
    const id = this.#freshId('edge', new Set(this.#snapshot.document.edges.map((edge) => edge.id)))
    const edge: CanvasEdgeV1 = {
      id,
      source: input.source,
      target: input.target,
      ...(input.sourceHandle === undefined || input.sourceHandle === null ? {} : { sourceHandle: input.sourceHandle }),
      ...(input.targetHandle === undefined || input.targetHandle === null ? {} : { targetHandle: input.targetHandle }),
    }
    this.#commit({ ...this.#snapshot.document, edges: [...this.#snapshot.document.edges, edge] })
    return id
  }

  addEdge(input: CanvasConnectInput): string {
    return this.connect(input)
  }

  removeEdges(ids: readonly string[]): void {
    this.removeElements([], ids)
  }

  removeEdge(id: string): void {
    this.removeEdges([id])
  }

  setViewport(viewport: CanvasViewportV1): void {
    this.#assertActive()
    const current = this.#snapshot.document.viewport
    if (current.x === viewport.x && current.y === viewport.y && current.zoom === viewport.zoom) return
    const validated = parseCanvasDocument({ ...this.#snapshot.document, viewport }).viewport
    // A viewport move must not recreate every node/edge. React Flow observes
    // those arrays by identity; rebuilding them while it reports a camera move
    // creates a controlled-prop feedback loop during node measurement.
    this.#setDocument(Object.freeze({
      ...this.#snapshot.document,
      viewport: Object.freeze(validated),
    }))
  }

  setSelection(next: { readonly nodeIds?: readonly string[]; readonly edgeIds?: readonly string[] }): void {
    this.#assertActive()
    exactInputKeys(next, ['nodeIds', 'edgeIds'], 'selection')
    const nodeIds = [...new Set(next.nodeIds ?? [])]
    const edgeIds = [...new Set(next.edgeIds ?? [])]
    const knownNodes = new Set(this.#snapshot.document.nodes.map((node) => node.id))
    const knownEdges = new Set(this.#snapshot.document.edges.map((edge) => edge.id))
    for (const id of nodeIds) if (!knownNodes.has(id)) throw new Error(`node not found: ${id}`)
    for (const id of edgeIds) if (!knownEdges.has(id)) throw new Error(`edge not found: ${id}`)
    if (
      nodeIds.length === this.#snapshot.selection.nodeIds.length
      && edgeIds.length === this.#snapshot.selection.edgeIds.length
      && nodeIds.every((id, index) => id === this.#snapshot.selection.nodeIds[index])
      && edgeIds.every((id, index) => id === this.#snapshot.selection.edgeIds[index])
    ) return
    this.#snapshot = this.#makeSnapshot(this.#snapshot.document, this.#snapshot.open, selection(nodeIds, edgeIds))
    this.#emit()
  }

  canUndo(): boolean {
    this.#assertActive()
    return this.#undoStack.length > 0
  }

  beginGesture(): void {
    this.#assertActive()
    this.#gestureBaseline ??= this.#snapshot.document
  }

  endGesture(): void {
    this.#assertActive()
    const baseline = this.#gestureBaseline
    this.#gestureBaseline = undefined
    if (baseline === undefined || serializeCanvasDocument(baseline) === serializeCanvasDocument(this.#snapshot.document)) return
    this.#undoStack.push(baseline)
    if (this.#undoStack.length > 100) this.#undoStack.shift()
    this.#redoStack.length = 0
  }

  canRedo(): boolean {
    this.#assertActive()
    return this.#redoStack.length > 0
  }

  undo(): boolean {
    this.#assertActive()
    const document = this.#undoStack.pop()
    if (document === undefined) return false
    this.#redoStack.push(this.#snapshot.document)
    this.#setDocument(document)
    return true
  }

  redo(): boolean {
    this.#assertActive()
    const document = this.#redoStack.pop()
    if (document === undefined) return false
    this.#undoStack.push(this.#snapshot.document)
    this.#setDocument(document)
    return true
  }

  select(ids: readonly string[]): void {
    this.setSelection({ nodeIds: ids })
  }

  selectNode(id: string | null): void {
    this.setSelection({ nodeIds: id === null ? [] : [id] })
  }

  async addFiles(files: CanvasFileCollection, position: CanvasPointV1): Promise<string[]> {
    this.#assertActive()
    const batch = inputFiles(files)
    if (batch.length === 0) return []
    const validated = batch.map((file) => ({ file, kind: this.#validateFile(file) }))
    const usedAssets = new Set(this.#temporaryAssets.keys())
    for (const node of this.#snapshot.document.nodes) {
      if (node.kind !== 'note' && node.source.type === 'asset') usedAssets.add(node.source.assetId)
    }
    const usedNodes = new Set(this.#snapshot.document.nodes.map((node) => node.id))
    const entries = validated.map(({ file, kind }, index) => {
      const assetId = this.#freshId('asset', usedAssets)
      usedAssets.add(assetId)
      const id = this.#freshId('node', usedNodes)
      usedNodes.add(id)
      const title = file.name || 'Image'
      const common = {
        id,
        position: { x: position.x + index * 28, y: position.y + index * 28 },
        size: defaultSize(kind),
        title,
        source: { type: 'asset' as const, assetId },
      }
      const node: CanvasNodeV1 = { ...common, kind, alt: title }
      return { assetId, file, node }
    })
    const next = freezeDocument(parseCanvasDocument({
      ...this.#snapshot.document,
      nodes: [...this.#snapshot.document.nodes, ...entries.map((entry) => entry.node)],
    }))

    const created: { assetId: string; file: File; url: string }[] = []
    try {
      for (const entry of entries) {
        created.push({ ...entry, url: this.#objectUrl.createObjectURL(entry.file) })
      }
    } catch (error) {
      for (const entry of created) this.#objectUrl.revokeObjectURL(entry.url)
      throw error
    }
    for (const entry of created) this.#temporaryAssets.set(entry.assetId, { file: entry.file, url: entry.url })
    this.#setDocument(next)
    return entries.map((entry) => entry.node.id)
  }

  addDroppedFiles(files: CanvasFileCollection, position: CanvasPointV1): Promise<string[]> {
    return this.addFiles(files, position)
  }

  async replaceMediaSource(id: string, file: File): Promise<void> {
    this.#assertActive()
    const index = this.#nodeIndex(id)
    const node = this.#snapshot.document.nodes[index]
    if (node === undefined) throw new Error(`node not found: ${id}`)
    if (node.kind !== 'image') throw new CanvasFileError('wrong-kind', file.name, 'only image nodes can contain files')
    this.#validateFile(file)
    const used = new Set(this.#temporaryAssets.keys())
    const assetId = this.#freshId('asset', used)
    const nodes = [...this.#snapshot.document.nodes]
    nodes[index] = { ...node, source: { type: 'asset', assetId } }
    const next = freezeDocument(parseCanvasDocument({ ...this.#snapshot.document, nodes }))
    const url = this.#objectUrl.createObjectURL(file)
    this.#temporaryAssets.set(assetId, { file, url })
    this.#setDocument(next)
  }

  attachFile(id: string, file: File): Promise<void> {
    return this.replaceMediaSource(id, file)
  }

  getMediaPreviewUrl(id: string): string | undefined {
    const node = this.#snapshot.document.nodes.find((candidate) => candidate.id === id)
    if (node === undefined || node.kind === 'note') return undefined
    if (node.source.type === 'url') return node.source.url
    return this.#temporaryAssets.get(node.source.assetId)?.url ?? this.#resolveAssetUrl?.(node.source.assetId)
  }

  resolveMediaUrl(id: string): string | undefined {
    return this.getMediaPreviewUrl(id)
  }

  getTemporaryFile(assetId: string): File | undefined {
    return this.#temporaryAssets.get(assetId)?.file
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#releaseAllTemporaryAssets()
    this.#listeners.clear()
    this.#undoStack.length = 0
    this.#redoStack.length = 0
    this.#gestureBaseline = undefined
  }

  #validatePolicy(): void {
    const policies = [['image', this.#mediaPolicy.image]] as const
    for (const [kind, policy] of policies) {
      if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes <= 0) {
        throw new TypeError(`${kind} maxBytes must be a positive safe integer`)
      }
      if (policy.mimeTypes.length === 0 || policy.mimeTypes.some((item) => typeof item !== 'string' || item === '')) {
        throw new TypeError(`${kind} mimeTypes must be a non-empty string list`)
      }
    }
  }

  #validateFile(file: File): 'image' {
    const type = file.type.toLowerCase()
    const kind = this.#mediaPolicy.image.mimeTypes.includes(type) ? 'image' : undefined
    if (kind === undefined) {
      throw new CanvasFileError('unsupported-type', file.name, `unsupported media type: ${file.type || '(empty)'}`)
    }
    if (file.size <= 0) throw new CanvasFileError('empty', file.name, 'empty files are not supported')
    if (file.size > this.#mediaPolicy[kind].maxBytes) {
      throw new CanvasFileError('too-large', file.name, `${kind} file exceeds the size limit`)
    }
    return kind
  }

  #freshId(kind: CanvasIdKind, used: ReadonlySet<string>): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = this.#createId(kind)
      if (!used.has(id)) return id
    }
    throw new Error(`could not create a unique ${kind} id`)
  }

  #nodeIndex(id: string): number {
    const index = this.#snapshot.document.nodes.findIndex((node) => node.id === id)
    if (index < 0) throw new Error(`node not found: ${id}`)
    return index
  }

  #commit(input: CanvasDocumentV1): void {
    const current = this.#snapshot.document
    const keepNodes = input.nodes === current.nodes
    const keepEdges = input.edges === current.edges
    const parsed = parseCanvasDocument(input)
    if (this.#gestureBaseline === undefined) {
      this.#undoStack.push(current)
      if (this.#undoStack.length > 100) this.#undoStack.shift()
      this.#redoStack.length = 0
    }
    this.#setDocument(freezeDocument({
      ...parsed,
      nodes: keepNodes ? current.nodes : parsed.nodes,
      edges: keepEdges ? current.edges : parsed.edges,
    }))
  }

  #setDocument(document: CanvasDocumentV1): void {
    const nodeIds = new Set(document.nodes.map((node) => node.id))
    const edgeIds = new Set(document.edges.map((edge) => edge.id))
    const nextSelection = selection(
      this.#snapshot.selection.nodeIds.filter((id) => nodeIds.has(id)),
      this.#snapshot.selection.edgeIds.filter((id) => edgeIds.has(id)),
    )
    this.#snapshot = this.#makeSnapshot(document, this.#snapshot.open, nextSelection)
    this.#releaseOrphanedTemporaryAssets(document)
    this.#emit()
  }

  #makeSnapshot(document: CanvasDocumentV1, open: boolean, selected: CanvasSelection): CanvasWorkspaceSnapshot {
    return Object.freeze({
      document,
      open,
      selectedNodeId: selected.nodeIds[0] ?? null,
      selection: selected,
    })
  }

  #releaseOrphanedTemporaryAssets(document: CanvasDocumentV1): void {
    const referenced = new Set<string>()
    for (const node of document.nodes) {
      if (node.kind !== 'note' && node.source.type === 'asset') referenced.add(node.source.assetId)
    }
    for (const [assetId, entry] of this.#temporaryAssets) {
      if (referenced.has(assetId)) continue
      this.#objectUrl.revokeObjectURL(entry.url)
      this.#temporaryAssets.delete(assetId)
    }
  }

  #releaseAllTemporaryAssets(): void {
    for (const entry of this.#temporaryAssets.values()) this.#objectUrl.revokeObjectURL(entry.url)
    this.#temporaryAssets.clear()
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener()
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('CanvasWorkspace has been disposed')
  }
}
