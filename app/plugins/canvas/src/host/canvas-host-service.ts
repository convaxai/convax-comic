import type { Context } from '@deepseek-ai/cordis'
import {
  CANVAS_COMMITTED_EVENT,
  CANVAS_ERROR_CODES,
  CANVAS_HOST_SERVICE,
  CanvasContractError,
  applyCanvasPatch,
  assertCanvasId,
  assertCanvasProject,
  assertEdgeId,
  assertNodeId,
  assertProjectId,
  assertWorkspaceId,
  createDeterministicLeafReplaceOperations,
  encodeJsonPointer,
  parseCanvasProject,
  type ApplyCanvasPatchRequest,
  type ApplyCanvasPatchResult,
  type CanvasCommittedEvent,
  type CanvasDocument,
  type CanvasDocumentSummary,
  type CanvasEdge,
  type CanvasEdgeTypeDefinition,
  type CanvasHostApi,
  type CanvasMutationMetadata,
  type CanvasNode,
  type CanvasNodeTypeDefinition,
  type CanvasPatchOperation,
  type CanvasProject,
  type CanvasProjectSummary,
  type CanvasRevisionDeletedResult,
  type CanvasRevisionTimeoutResult,
  type DeleteCanvasDocumentResult,
  type DeleteCanvasProjectResult,
  type JsonObject,
  type WaitForCanvasRevisionRequest,
  type WaitForCanvasRevisionResult,
} from '@convax/canvas-api'
import {
  CanvasStoreRevisionConflict,
  type CanvasStore,
  type StoredCanvasProject,
} from '@convax/canvas-store-api'
import { EdgeTypeRegistry, NodeTypeRegistry } from './node-type-registry.js'

export const MAX_CANVAS_REVISION_WAIT_MS = 30_000

export type CanvasHostErrorCode =
  | 'CANVAS_NOT_FOUND'
  | 'CLOSED'
  | 'LAST_CANVAS'
  | 'PROJECT_ALREADY_EXISTS'
  | 'PROJECT_NOT_FOUND'
  | 'STORE_INTEGRITY'

export class CanvasHostError extends Error {
  readonly code: CanvasHostErrorCode

  constructor(code: CanvasHostErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CanvasHostError'
    this.code = code
  }
}

type CanvasLifecycleEvent =
  | { readonly kind: 'committed'; readonly event: CanvasCommittedEvent }
  | { readonly kind: 'deleted'; readonly workspaceId: string; readonly projectId: string; readonly canvasId: string }

type CanvasLifecycleListener = (event: CanvasLifecycleEvent) => void

interface CanvasMutationResult {
  readonly document: CanvasDocument
  readonly applied: number
}

function now(): string {
  return new Date().toISOString()
}

function assertSafeRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CanvasContractError(CANVAS_ERROR_CODES.REVISION_CONFLICT, `${label} must be a non-negative safe integer`)
  }
}

function assertMetadata(metadata: CanvasMutationMetadata): void {
  if (typeof metadata.mutationId !== 'string' || metadata.mutationId.trim() === '') {
    throw new TypeError('Canvas mutationId must be non-empty')
  }
  if (typeof metadata.source !== 'string' || metadata.source.trim() === '') {
    throw new TypeError('Canvas mutation source must be non-empty')
  }
  if (metadata.originClientId !== undefined
    && (typeof metadata.originClientId !== 'string' || metadata.originClientId.trim() === '')) {
    throw new TypeError('Canvas originClientId must be non-empty when provided')
  }
}

function revisionConflict(expected: number, actual: number, domain: 'document' | 'project'): CanvasContractError {
  return new CanvasContractError(
    CANVAS_ERROR_CODES.REVISION_CONFLICT,
    `Canvas ${domain} revision conflict: expected ${String(expected)}, current ${String(actual)}`,
  )
}

function projectSummary(project: CanvasProject): CanvasProjectSummary {
  return {
    workspaceId: project.workspaceId,
    projectId: project.id,
    title: project.metadata.title,
    activeCanvasId: project.activeCanvasId,
    revision: project.revision,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

function documentSummary(projectId: string, document: CanvasDocument): CanvasDocumentSummary {
  return {
    workspaceId: document.workspaceId,
    projectId,
    canvasId: document.id,
    title: document.metadata.title,
    revision: document.revision,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

function emptyDocument(workspaceId: string, canvasId: string, title: string, timestamp: string): CanvasDocument {
  return {
    schemaVersion: 2,
    revision: 0,
    id: canvasId,
    workspaceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: { title },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: {},
    edges: {},
  }
}

function initialProject(workspaceId: string, projectId: string, canvasId: string, title: string): CanvasProject {
  const timestamp = now()
  const document = emptyDocument(workspaceId, canvasId, title, timestamp)
  return {
    schemaVersion: 2,
    revision: 0,
    id: projectId,
    workspaceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: { title },
    activeCanvasId: document.id,
    canvases: { [document.id]: document },
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function abortError(message: string): Error {
  return new DOMException(message, 'AbortError')
}

export interface CanvasHostServiceOptions {
  readonly onListenerError?: (error: unknown) => void
}

export class CanvasHostService implements CanvasHostApi {
  readonly nodeTypes: NodeTypeRegistry
  readonly edgeTypes: EdgeTypeRegistry

  readonly #store: CanvasStore
  readonly #onListenerError: (error: unknown) => void
  readonly #committedListeners = new Set<(event: CanvasCommittedEvent) => void>()
  readonly #lifecycleListeners = new Set<CanvasLifecycleListener>()
  readonly #lifecycle = new AbortController()
  #mutationTail: Promise<void> = Promise.resolve()
  #closing = false
  #closeTask: Promise<void> | undefined

  constructor(
    store: CanvasStore,
    nodeTypes = new NodeTypeRegistry(),
    edgeTypes = new EdgeTypeRegistry(),
    options: CanvasHostServiceOptions = {},
  ) {
    this.#store = store
    this.nodeTypes = nodeTypes
    this.edgeTypes = edgeTypes
    this.#onListenerError = options.onListenerError ?? (() => {})
  }

  readonly projects: CanvasHostApi['projects'] = {
    list: async (request) => {
      this.#assertOpen()
      assertWorkspaceId(request.workspaceId)
      const projects = await Promise.all(
        (await this.#store.list(request.workspaceId)).map(row => this.#parseStored(row)),
      )
      return projects.map(projectSummary)
    },

    create: request => this.#enqueueMutation(async () => {
      assertWorkspaceId(request.workspaceId)
      assertProjectId(request.projectId)
      assertCanvasId(request.canvasId)
      assertMetadata(request)
      if (await this.#store.read(request.workspaceId, request.projectId) !== undefined) {
        throw new CanvasHostError('PROJECT_ALREADY_EXISTS', `Canvas project already exists: ${request.projectId}`)
      }
      const candidate = initialProject(request.workspaceId, request.projectId, request.canvasId, request.title)
      assertCanvasProject(candidate)
      const stored = await this.#store.initialize(
        request.workspaceId,
        candidate.id,
        JSON.stringify(candidate),
      )
      const persisted = this.#parseStored(stored)
      if (stored.revision !== 0 || !sameJson(persisted, candidate)) {
        throw new CanvasHostError('PROJECT_ALREADY_EXISTS', `Canvas project was initialized concurrently: ${request.projectId}`)
      }
      this.#publishCommitted({
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        canvasId: persisted.activeCanvasId,
        mutationId: request.mutationId,
        source: request.source,
        ...(request.originClientId === undefined ? {} : { originClientId: request.originClientId }),
        revision: persisted.canvases[persisted.activeCanvasId]!.revision,
        operations: [],
      })
      return clone(persisted)
    }),

    get: async (request) => {
      this.#assertOpen()
      return clone(await this.#readProject(request.workspaceId, request.projectId))
    },

    setActiveCanvas: request => this.#enqueueMutation(async () => {
      assertMetadata(request)
      assertCanvasId(request.canvasId)
      assertSafeRevision(request.expectedRevision, 'expected project revision')
      const current = await this.#readProject(request.workspaceId, request.projectId)
      if (current.revision !== request.expectedRevision) {
        throw revisionConflict(request.expectedRevision, current.revision, 'project')
      }
      if (current.canvases[request.canvasId] === undefined) {
        throw new CanvasHostError('CANVAS_NOT_FOUND', `Canvas not found: ${request.canvasId}`)
      }
      if (current.activeCanvasId === request.canvasId) return clone(current)
      const candidate = clone(current)
      candidate.activeCanvasId = request.canvasId
      candidate.updatedAt = now()
      candidate.revision = current.revision + 1
      return clone(await this.#commitProject(current, candidate))
    }),

    delete: request => this.#enqueueMutation(async () => {
      assertWorkspaceId(request.workspaceId)
      assertProjectId(request.projectId)
      assertMetadata(request)
      assertSafeRevision(request.expectedRevision, 'expected project revision')
      const row = await this.#store.read(request.workspaceId, request.projectId)
      if (row === undefined) {
        return { workspaceId: request.workspaceId, projectId: request.projectId, deleted: false }
      }
      const current = this.#parseStored(row)
      this.#assertProjectIdentity(current, request.workspaceId, request.projectId)
      if (current.revision !== request.expectedRevision) {
        throw revisionConflict(request.expectedRevision, current.revision, 'project')
      }
      let deleted: boolean
      try {
        deleted = await this.#store.delete({
          workspaceId: current.workspaceId,
          projectId: current.id,
          expectedRevision: current.revision,
        })
      } catch (error) {
        if (error instanceof CanvasStoreRevisionConflict) {
          throw revisionConflict(error.expected, error.actual, 'project')
        }
        throw error
      }
      if (deleted) {
        for (const canvasId of Object.keys(current.canvases)) {
          this.#publishDeleted(current.workspaceId, current.id, canvasId)
        }
      }
      return { workspaceId: current.workspaceId, projectId: current.id, deleted } satisfies DeleteCanvasProjectResult
    }),
  }

  readonly documents: CanvasHostApi['documents'] = {
    list: async (request) => {
      this.#assertOpen()
      const project = await this.#readProject(request.workspaceId, request.projectId)
      return Object.values(project.canvases)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
        .map(document => documentSummary(project.id, document))
    },

    create: request => this.#enqueueMutation(() => this.#createDocument(request, false)),

    createAndActivate: request => this.#enqueueMutation(() => this.#createDocument(request, true)),

    get: async (request) => {
      this.#assertOpen()
      const project = await this.#readProject(request.workspaceId, request.projectId)
      return clone(this.#requireDocument(project, request.canvasId))
    },

    rename: request => this.#enqueueMutation(async () => {
      const operation: CanvasPatchOperation = { op: 'replace', path: '/metadata/title', value: request.title }
      return (await this.#commitDocumentMutation(request, [operation])).document
    }),

    delete: request => this.#enqueueMutation(async () => {
      assertMetadata(request)
      assertCanvasId(request.canvasId)
      assertSafeRevision(request.expectedRevision, 'expected document revision')
      const current = await this.#readProject(request.workspaceId, request.projectId)
      const document = this.#requireDocument(current, request.canvasId)
      if (document.revision !== request.expectedRevision) {
        throw revisionConflict(request.expectedRevision, document.revision, 'document')
      }
      const ids = Object.keys(current.canvases)
      if (ids.length === 1) throw new CanvasHostError('LAST_CANVAS', 'Cannot delete the last Canvas in a project')
      const candidate = clone(current)
      delete candidate.canvases[request.canvasId]
      if (candidate.activeCanvasId === request.canvasId) {
        candidate.activeCanvasId = Object.keys(candidate.canvases).sort()[0]!
      }
      candidate.updatedAt = now()
      candidate.revision = current.revision + 1
      await this.#commitProject(current, candidate)
      this.#publishDeleted(current.workspaceId, current.id, request.canvasId)
      return {
        workspaceId: current.workspaceId,
        projectId: current.id,
        canvasId: request.canvasId,
        deleted: true,
      } satisfies DeleteCanvasDocumentResult
    }),

    applyPatch: request => this.#enqueueMutation(() => this.#commitDocumentMutation(request, request.operations)),

    applyActivePatch: request => this.#enqueueMutation(async () => {
      assertSafeRevision(request.expectedProjectRevision, 'expected project revision')
      assertCanvasId(request.expectedActiveCanvasId)
      const project = await this.#readProject(request.workspaceId, request.projectId)
      if (project.revision !== request.expectedProjectRevision) {
        throw revisionConflict(request.expectedProjectRevision, project.revision, 'project')
      }
      if (project.activeCanvasId !== request.expectedActiveCanvasId) {
        throw new CanvasContractError(
          CANVAS_ERROR_CODES.REVISION_CONFLICT,
          `Active Canvas conflict: expected ${request.expectedActiveCanvasId}, current ${project.activeCanvasId}`,
        )
      }
      return await this.#commitDocumentMutation({
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        canvasId: request.expectedActiveCanvasId,
        expectedRevision: request.expectedRevision,
        mutationId: request.mutationId,
        source: request.source,
        ...(request.originClientId === undefined ? {} : { originClientId: request.originClientId }),
      }, request.operations, project)
    }),

    waitForRevision: (request, signal) => this.waitForRevision(request, signal),
  }

  readonly nodes: CanvasHostApi['nodes'] = {
    create: request => this.#enqueueMutation(async () => {
      this.nodeTypes.validateNew(request.node)
      return await this.#commitDocumentMutation(request, [{
        op: 'add',
        path: `/nodes/${encodeJsonPointer([request.node.id]).slice(1)}`,
        value: request.node,
      }])
    }),

    update: request => this.#enqueueMutation(async () => {
      assertNodeId(request.nodeId)
      const project = await this.#readProject(request.workspaceId, request.projectId)
      const document = this.#requireDocument(project, request.canvasId)
      this.#assertExpectedDocumentRevision(document, request.expectedRevision)
      const node = document.nodes[request.nodeId]
      if (node === undefined) throw new CanvasHostError('CANVAS_NOT_FOUND', `Canvas node not found: ${request.nodeId}`)
      return await this.#commitDocumentMutation(request, createDeterministicLeafReplaceOperations(
        `/nodes/${encodeJsonPointer([request.nodeId]).slice(1)}`,
        request.changes as JsonObject,
      ), project)
    }),

    remove: request => this.#enqueueMutation(async () => {
      assertNodeId(request.nodeId)
      const project = await this.#readProject(request.workspaceId, request.projectId)
      const document = this.#requireDocument(project, request.canvasId)
      this.#assertExpectedDocumentRevision(document, request.expectedRevision)
      if (document.nodes[request.nodeId] === undefined) {
        throw new CanvasHostError('CANVAS_NOT_FOUND', `Canvas node not found: ${request.nodeId}`)
      }
      const operations: CanvasPatchOperation[] = Object.values(document.edges)
        .filter(edge => edge.source === request.nodeId || edge.target === request.nodeId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(edge => ({ op: 'remove', path: `/edges/${encodeJsonPointer([edge.id]).slice(1)}` }))
      operations.push({ op: 'remove', path: `/nodes/${encodeJsonPointer([request.nodeId]).slice(1)}` })
      return await this.#commitDocumentMutation(request, operations, project)
    }),
  }

  readonly edges: CanvasHostApi['edges'] = {
    create: request => this.#enqueueMutation(async () => {
      this.edgeTypes.validateNew(request.edge)
      return await this.#commitDocumentMutation(request, [{
        op: 'add',
        path: `/edges/${encodeJsonPointer([request.edge.id]).slice(1)}`,
        value: request.edge,
      }])
    }),

    update: request => this.#enqueueMutation(async () => {
      assertEdgeId(request.edgeId)
      const project = await this.#readProject(request.workspaceId, request.projectId)
      const document = this.#requireDocument(project, request.canvasId)
      this.#assertExpectedDocumentRevision(document, request.expectedRevision)
      if (document.edges[request.edgeId] === undefined) {
        throw new CanvasHostError('CANVAS_NOT_FOUND', `Canvas edge not found: ${request.edgeId}`)
      }
      return await this.#commitDocumentMutation(request, createDeterministicLeafReplaceOperations(
        `/edges/${encodeJsonPointer([request.edgeId]).slice(1)}`,
        request.changes as JsonObject,
      ), project)
    }),

    remove: request => this.#enqueueMutation(async () => {
      assertEdgeId(request.edgeId)
      const project = await this.#readProject(request.workspaceId, request.projectId)
      const document = this.#requireDocument(project, request.canvasId)
      this.#assertExpectedDocumentRevision(document, request.expectedRevision)
      if (document.edges[request.edgeId] === undefined) {
        throw new CanvasHostError('CANVAS_NOT_FOUND', `Canvas edge not found: ${request.edgeId}`)
      }
      return await this.#commitDocumentMutation(request, [{
        op: 'remove',
        path: `/edges/${encodeJsonPointer([request.edgeId]).slice(1)}`,
      }], project)
    }),
  }

  registerNodeType(definition: CanvasNodeTypeDefinition): () => void {
    return this.nodeTypes.register(definition)
  }

  registerEdgeType(definition: CanvasEdgeTypeDefinition): () => void {
    return this.edgeTypes.register(definition)
  }

  onCommitted(listener: (event: CanvasCommittedEvent) => void): () => void {
    this.#assertOpen()
    this.#committedListeners.add(listener)
    return () => { this.#committedListeners.delete(listener) }
  }

  async waitForRevision(request: WaitForCanvasRevisionRequest, signal: AbortSignal): Promise<WaitForCanvasRevisionResult> {
    this.#assertOpen()
    assertWorkspaceId(request.workspaceId)
    assertProjectId(request.projectId)
    assertCanvasId(request.canvasId)
    assertSafeRevision(request.afterRevision, 'afterRevision')
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 0 || request.timeoutMs > MAX_CANVAS_REVISION_WAIT_MS) {
      throw new RangeError(`Canvas revision timeout must be between 0 and ${String(MAX_CANVAS_REVISION_WAIT_MS)}ms`)
    }
    signal.throwIfAborted()
    this.#lifecycle.signal.throwIfAborted()

    const combined = AbortSignal.any([signal, this.#lifecycle.signal])
    let settleWake: ((event: CanvasLifecycleEvent) => void) | undefined
    const wake = new Promise<CanvasLifecycleEvent>((resolve) => { settleWake = resolve })
    let settleStop: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = new Promise<'timeout'>((resolve, reject) => {
      let settled = false
      const finishTimeout = (): void => {
        if (settled) return
        settled = true
        combined.removeEventListener('abort', aborted)
        resolve('timeout')
      }
      const aborted = (): void => {
        if (settled) return
        settled = true
        combined.removeEventListener('abort', aborted)
        try { combined.throwIfAborted() } catch (error) { reject(error) }
      }
      settleStop = finishTimeout
      combined.addEventListener('abort', aborted, { once: true })
      if (combined.aborted) aborted()
      else timer = setTimeout(finishTimeout, request.timeoutMs)
    })

    const listener: CanvasLifecycleListener = (event) => {
      if (event.kind === 'committed') {
        if (event.event.workspaceId === request.workspaceId
          && event.event.projectId === request.projectId
          && event.event.canvasId === request.canvasId
          && event.event.revision > request.afterRevision) settleWake?.(event)
        return
      }
      if (event.workspaceId === request.workspaceId
        && event.projectId === request.projectId
        && event.canvasId === request.canvasId) settleWake?.(event)
    }

    // Subscribe before the first read and race every Store read against the
    // absolute deadline/abort so a slow provider cannot strand a waiter.
    this.#lifecycleListeners.add(listener)
    try {
      const first = await Promise.race([
        this.#readDocumentOrDeleted(request).then(current => ({ kind: 'read' as const, current })),
        wake.then(event => ({ kind: 'event' as const, event })),
        stop.then(() => ({ kind: 'timeout' as const })),
      ])
      if (first.kind === 'timeout') {
        return { status: 'timeout', revision: request.afterRevision } satisfies CanvasRevisionTimeoutResult
      }
      if (first.kind === 'event') {
        if (first.event.kind === 'deleted') return { status: 'deleted' } satisfies CanvasRevisionDeletedResult
        const afterEvent = await Promise.race([
          this.#readDocumentOrDeleted(request).then(current => ({ kind: 'read' as const, current })),
          stop.then(() => ({ kind: 'timeout' as const })),
        ])
        if (afterEvent.kind === 'timeout') {
          return { status: 'timeout', revision: request.afterRevision } satisfies CanvasRevisionTimeoutResult
        }
        return afterEvent.current.status === 'deleted'
          ? afterEvent.current
          : { status: 'changed', document: clone(afterEvent.current.document) }
      }
      if (first.current.status === 'deleted') return first.current
      if (first.current.document.revision > request.afterRevision) {
        return { status: 'changed', document: clone(first.current.document) }
      }
      const next = await Promise.race([
        wake.then(event => ({ kind: 'event' as const, event })),
        stop.then(() => ({ kind: 'timeout' as const })),
      ])
      if (next.kind === 'timeout') {
        return { status: 'timeout', revision: first.current.document.revision } satisfies CanvasRevisionTimeoutResult
      }
      if (next.event.kind === 'deleted') return { status: 'deleted' } satisfies CanvasRevisionDeletedResult
      const current = await Promise.race([
        this.#readDocumentOrDeleted(request).then(value => ({ kind: 'read' as const, value })),
        stop.then(() => ({ kind: 'timeout' as const })),
      ])
      if (current.kind === 'timeout') {
        return { status: 'timeout', revision: first.current.document.revision } satisfies CanvasRevisionTimeoutResult
      }
      return current.value.status === 'deleted'
        ? current.value
        : { status: 'changed', document: clone(current.value.document) }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      this.#lifecycleListeners.delete(listener)
      settleStop?.()
    }
  }

  async close(): Promise<void> {
    if (this.#closeTask !== undefined) return await this.#closeTask
    this.#closing = true
    this.#lifecycle.abort(abortError('Canvas Host service is closing'))
    this.#closeTask = (async () => {
      await this.#mutationTail
      this.#committedListeners.clear()
      this.#lifecycleListeners.clear()
    })()
    return await this.#closeTask
  }

  async #createDocument(
    request: CanvasMutationMetadata & {
      workspaceId: string
      projectId: string
      canvasId: string
      title: string
      expectedProjectRevision: number
    },
    activate: boolean,
  ): Promise<CanvasDocument> {
    assertMetadata(request)
    assertCanvasId(request.canvasId)
    assertSafeRevision(request.expectedProjectRevision, 'expected project revision')
    const current = await this.#readProject(request.workspaceId, request.projectId)
    if (current.revision !== request.expectedProjectRevision) {
      throw revisionConflict(request.expectedProjectRevision, current.revision, 'project')
    }
    if (current.canvases[request.canvasId] !== undefined) {
      throw new CanvasHostError('STORE_INTEGRITY', `Canvas already exists: ${request.canvasId}`)
    }
    const candidate = clone(current)
    const timestamp = now()
    candidate.canvases[request.canvasId] = emptyDocument(current.workspaceId, request.canvasId, request.title, timestamp)
    if (activate) candidate.activeCanvasId = request.canvasId
    candidate.revision = current.revision + 1
    candidate.updatedAt = timestamp
    const persisted = await this.#commitProject(current, candidate)
    const document = persisted.canvases[request.canvasId]!
    this.#publishCommitted({
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      canvasId: request.canvasId,
      mutationId: request.mutationId,
      source: request.source,
      ...(request.originClientId === undefined ? {} : { originClientId: request.originClientId }),
      revision: document.revision,
      operations: [],
    })
    return clone(document)
  }

  async #commitDocumentMutation(
    request: ApplyCanvasPatchRequest | (CanvasMutationMetadata & {
      workspaceId: string
      projectId: string
      canvasId: string
      expectedRevision: number
    }),
    operations: readonly CanvasPatchOperation[],
    loadedProject?: CanvasProject,
  ): Promise<ApplyCanvasPatchResult> {
    assertMetadata(request)
    if (operations.length === 0) {
      throw new CanvasContractError(CANVAS_ERROR_CODES.PATCH_INVALID_OPERATION, 'Canvas mutation requires at least one Patch operation')
    }
    assertWorkspaceId(request.workspaceId)
    assertProjectId(request.projectId)
    assertCanvasId(request.canvasId)
    assertSafeRevision(request.expectedRevision, 'expected document revision')
    const current = loadedProject ?? await this.#readProject(request.workspaceId, request.projectId)
    const document = this.#requireDocument(current, request.canvasId)
    this.#assertExpectedDocumentRevision(document, request.expectedRevision)

    const preview = applyCanvasPatch({ document, operations })
    this.#validateDocumentTypes(document, preview.document)
    const candidate = clone(current)
    const timestamp = now()
    preview.document.revision = document.revision + 1
    preview.document.updatedAt = timestamp
    candidate.canvases[request.canvasId] = preview.document
    candidate.revision = current.revision + 1
    candidate.updatedAt = timestamp

    const persisted = await this.#commitProject(current, candidate)
    const persistedDocument = persisted.canvases[request.canvasId]!
    const event: CanvasCommittedEvent = {
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      canvasId: request.canvasId,
      mutationId: request.mutationId,
      source: request.source,
      ...(request.originClientId === undefined ? {} : { originClientId: request.originClientId }),
      revision: persistedDocument.revision,
      operations: clone(operations),
    }
    this.#publishCommitted(event)
    return {
      document: clone(persistedDocument),
      revision: persistedDocument.revision,
      applied: preview.applied,
    }
  }

  #validateDocumentTypes(previous: CanvasDocument, candidate: CanvasDocument): void {
    for (const [id, node] of Object.entries(candidate.nodes)) {
      const existing = previous.nodes[id]
      if (existing === undefined) {
        this.nodeTypes.validateNew(node)
        continue
      }
      if (this.nodeTypes.validateExisting(node)) continue
      if (node.type !== existing.type || node.kindVersion !== existing.kindVersion || !sameJson(node.data, existing.data)) {
        throw new CanvasContractError(CANVAS_ERROR_CODES.NODE_TYPE_NOT_REGISTERED, `Unknown node data is read-only: ${node.type}`)
      }
    }
    for (const [id, edge] of Object.entries(candidate.edges)) {
      const existing = previous.edges[id]
      if (existing === undefined) {
        this.edgeTypes.validateNew(edge)
        continue
      }
      if (this.edgeTypes.validateExisting(edge)) continue
      if (edge.type !== existing.type || edge.kindVersion !== existing.kindVersion || !sameJson(edge.data, existing.data)) {
        throw new CanvasContractError(CANVAS_ERROR_CODES.EDGE_TYPE_NOT_REGISTERED, `Unknown edge data is read-only: ${edge.type}`)
      }
    }
  }

  async #commitProject(current: CanvasProject, candidate: CanvasProject): Promise<CanvasProject> {
    if (candidate.id !== current.id || candidate.workspaceId !== current.workspaceId) {
      throw new CanvasHostError('STORE_INTEGRITY', 'Canvas project identity changed during mutation')
    }
    if (candidate.revision !== current.revision + 1) {
      throw new CanvasHostError('STORE_INTEGRITY', 'Canvas project mutation must advance revision exactly once')
    }
    assertCanvasProject(candidate)
    let stored: StoredCanvasProject
    try {
      stored = await this.#store.commit({
        workspaceId: current.workspaceId,
        projectId: current.id,
        expectedRevision: current.revision,
        projectJson: JSON.stringify(candidate),
      })
    } catch (error) {
      if (error instanceof CanvasStoreRevisionConflict) {
        throw revisionConflict(error.expected, error.actual, 'project')
      }
      throw error
    }
    const persisted = this.#parseStored(stored)
    if (persisted.revision !== candidate.revision || !sameJson(persisted, candidate)) {
      throw new CanvasHostError('STORE_INTEGRITY', 'CanvasStore did not persist the exact candidate project')
    }
    return persisted
  }

  async #readProject(workspaceId: string, projectId: string): Promise<CanvasProject> {
    assertWorkspaceId(workspaceId)
    assertProjectId(projectId)
    const row = await this.#store.read(workspaceId, projectId)
    if (row === undefined) throw new CanvasHostError('PROJECT_NOT_FOUND', `Canvas project not found: ${projectId}`)
    const project = this.#parseStored(row)
    this.#assertProjectIdentity(project, workspaceId, projectId)
    return project
  }

  #parseStored(row: StoredCanvasProject): CanvasProject {
    let value: unknown
    try {
      value = JSON.parse(row.projectJson)
    } catch (error) {
      throw new CanvasHostError('STORE_INTEGRITY', `CanvasStore project JSON is invalid: ${row.projectId}`, { cause: error })
    }
    const project = parseCanvasProject(value)
    if (project.workspaceId !== row.workspaceId
      || project.id !== row.projectId
      || project.revision !== row.revision) {
      throw new CanvasHostError(
        'STORE_INTEGRITY',
        `CanvasStore row revision or identity disagrees with project JSON: ${row.workspaceId}/${row.projectId}`,
      )
    }
    return project
  }

  #assertProjectIdentity(project: CanvasProject, workspaceId: string, projectId: string): void {
    if (project.id !== projectId || project.workspaceId !== workspaceId) {
      throw new CanvasHostError('PROJECT_NOT_FOUND', `Canvas project does not belong to workspace: ${projectId}`)
    }
  }

  #requireDocument(project: CanvasProject, canvasId: string): CanvasDocument {
    assertCanvasId(canvasId)
    const document = project.canvases[canvasId]
    if (document === undefined) throw new CanvasHostError('CANVAS_NOT_FOUND', `Canvas not found: ${canvasId}`)
    if (document.id !== canvasId || document.workspaceId !== project.workspaceId) {
      throw new CanvasHostError('STORE_INTEGRITY', `Canvas identity disagrees with its project: ${canvasId}`)
    }
    return document
  }

  #assertExpectedDocumentRevision(document: CanvasDocument, expectedRevision: number): void {
    assertSafeRevision(expectedRevision, 'expected document revision')
    if (document.revision !== expectedRevision) {
      throw revisionConflict(expectedRevision, document.revision, 'document')
    }
  }

  async #readDocumentOrDeleted(request: WaitForCanvasRevisionRequest): Promise<
    | { status: 'present'; document: CanvasDocument }
    | CanvasRevisionDeletedResult
  > {
    const row = await this.#store.read(request.workspaceId, request.projectId)
    if (row === undefined) return { status: 'deleted' }
    const project = this.#parseStored(row)
    this.#assertProjectIdentity(project, request.workspaceId, request.projectId)
    const document = project.canvases[request.canvasId]
    return document === undefined ? { status: 'deleted' } : { status: 'present', document }
  }

  #publishCommitted(event: CanvasCommittedEvent): void {
    for (const listener of [...this.#committedListeners]) {
      this.#notify(() => { listener(clone(event)) })
    }
    for (const listener of [...this.#lifecycleListeners]) {
      this.#notify(() => { listener({ kind: 'committed', event: clone(event) }) })
    }
  }

  #publishDeleted(workspaceId: string, projectId: string, canvasId: string): void {
    for (const listener of [...this.#lifecycleListeners]) {
      this.#notify(() => { listener({ kind: 'deleted', workspaceId, projectId, canvasId }) })
    }
  }

  #notify(notify: () => void): void {
    try {
      notify()
    } catch (error) {
      try { this.#onListenerError(error) } catch { /* notification diagnostics are non-authoritative */ }
    }
  }

  #enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
    this.#assertOpen()
    const result = this.#mutationTail.then(async () => {
      this.#assertOpen()
      return await task()
    })
    this.#mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  #assertOpen(): void {
    if (this.#closing) throw new CanvasHostError('CLOSED', 'Canvas Host service is closed')
  }
}

export function createCanvasHostService(ctx: Context, store: CanvasStore): CanvasHostService {
  return new CanvasHostService(
    store,
    new NodeTypeRegistry(),
    new EdgeTypeRegistry(),
    { onListenerError: error => { ctx.logger.warn(error instanceof Error ? error : new Error(String(error))) } },
  )
}

export function provideCanvasHostService(ctx: Context, service: CanvasHostService): void {
  // Register close first so reverse-order disposal unprovides the service and
  // deactivates dependants before closing its authority.
  ctx.effect(() => {
    const stopEvents = service.onCommitted(event => ctx.emit(CANVAS_COMMITTED_EVENT, event))
    return async () => {
      stopEvents()
      await service.close()
    }
  }, 'canvas-v2: Host authority lifecycle')
  ctx.provide(CANVAS_HOST_SERVICE, service)
}
