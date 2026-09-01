import {
  classifyCanvasCommittedEvent,
  type ApplyCanvasPatchRequest,
  type ApplyCanvasPatchResult,
  type CanvasClientActions,
  type CanvasClientApi,
  type CanvasClientPatchRequest,
  type CanvasCommittedEvent,
  type CanvasId,
  type CanvasCommittedEventDisposition,
  type CanvasDocument,
  type CanvasPatchOperation,
  type CanvasViewport,
  type EdgeId,
  type GetCanvasDocumentRequest,
  type NodeId,
  type ProjectId,
  type WaitForCanvasRevisionRequest,
  type WaitForCanvasRevisionResult,
  type WorkspaceId,
} from '@convax/canvas-api'
import { CanvasRendererRegistry } from './renderer-registry.js'
import { CanvasSessionHistory } from './v2-history.js'
import { applyClientPatch, invertCanvasPatch, viewportPatch } from './v2-patch.js'

export interface CanvasRemotePort {
  getDocument(request: GetCanvasDocumentRequest, signal?: AbortSignal): Promise<CanvasDocument>
  applyPatch(request: ApplyCanvasPatchRequest, signal?: AbortSignal): Promise<ApplyCanvasPatchResult>
  waitForRevision(request: WaitForCanvasRevisionRequest, signal?: AbortSignal): Promise<WaitForCanvasRevisionResult>
}

export const DEFAULT_CANVAS_REVISION_WAIT_MS = 20_000
const RETRY_BASE_MS = 250
const RETRY_MAX_MS = 5_000
const FAILURE_REPORT_THRESHOLD = 3

export type CanvasClientStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error' | 'closed'

export interface CanvasClientStateSnapshot {
  readonly status: CanvasClientStatus
  readonly document: CanvasDocument | undefined
  readonly error: unknown
  readonly dirty: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly selectedNodeIds: readonly NodeId[]
  readonly selectedEdgeIds: readonly EdgeId[]
}

export interface CanvasClientServiceOptions {
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
  readonly canvasId: CanvasId
  readonly clientId?: string
  readonly source?: string
  readonly revisionWaitMs?: number
  /** Authoritative document already carried by a project response; skips one bootstrap read. */
  readonly initialDocument?: CanvasDocument
  readonly renderers?: CanvasRendererRegistry
  readonly fitView?: (nodeIds?: readonly NodeId[]) => void
  readonly setViewport?: (viewport: CanvasViewport) => void | Promise<void>
}

interface OptimisticMutation {
  readonly mutationId: string
  readonly operations: readonly CanvasPatchOperation[]
}

let generatedClientId = 0

function defaultClientId(): string {
  generatedClientId += 1
  return `canvas-client-${generatedClientId}`
}

/** Object layer for exactly one workspace/project/canvas tuple. */
export class CanvasClientService implements CanvasClientApi {
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
  readonly canvasId: CanvasId
  readonly clientId: string
  readonly renderers: CanvasRendererRegistry
  readonly history = new CanvasSessionHistory()
  readonly actions: CanvasClientActions

  readonly #remote: CanvasRemotePort
  readonly #source: string
  readonly #revisionWaitMs: number
  #initialDocument: CanvasDocument | undefined
  readonly #fitView: ((nodeIds?: readonly NodeId[]) => void) | undefined
  readonly #setViewportHook: ((viewport: CanvasViewport) => void | Promise<void>) | undefined
  readonly #ownsRenderers: boolean
  readonly #documentListeners = new Set<(document: CanvasDocument) => void>()
  readonly #stateListeners = new Set<() => void>()
  readonly #selectedNodes = new Set<NodeId>()
  readonly #selectedEdges = new Set<EdgeId>()
  readonly #optimistic = new Map<string, OptimisticMutation>()
  readonly #recentOwnMutations = new Set<string>()
  readonly #lifetimeAbort = new AbortController()

  #authoritative: CanvasDocument | undefined
  #document: CanvasDocument | undefined
  #status: CanvasClientStatus = 'idle'
  #error: unknown
  #waitError: unknown
  #snapshot: CanvasClientStateSnapshot
  #writeTail: Promise<void> = Promise.resolve()
  #waitAbort: AbortController | undefined
  #waitTask: Promise<void> | undefined
  #startTask: Promise<CanvasDocument> | undefined
  #started = false
  #disposed = false
  #mutationCounter = 0

  constructor(remote: CanvasRemotePort, options: CanvasClientServiceOptions) {
    this.#remote = remote
    this.workspaceId = options.workspaceId
    this.projectId = options.projectId
    this.canvasId = options.canvasId
    this.clientId = options.clientId ?? defaultClientId()
    this.#source = options.source ?? '@convax/canvas'
    this.#revisionWaitMs = options.revisionWaitMs ?? DEFAULT_CANVAS_REVISION_WAIT_MS
    this.#initialDocument = options.initialDocument
    if (!Number.isSafeInteger(this.#revisionWaitMs) || this.#revisionWaitMs < 1 || this.#revisionWaitMs > 30_000) {
      throw new Error('revisionWaitMs must be a safe integer between 1 and 30000')
    }
    this.#fitView = options.fitView
    this.#setViewportHook = options.setViewport
    this.#ownsRenderers = options.renderers === undefined
    this.renderers = options.renderers ?? new CanvasRendererRegistry()
    this.#snapshot = this.#createStateSnapshot()
    this.actions = {
      applyPatch: request => this.applyPatch(request),
      setViewport: viewport => this.setViewport(viewport),
      selectNodes: nodeIds => { this.selectNodes(nodeIds) },
      selectEdges: edgeIds => { this.selectEdges(edgeIds) },
      fitView: nodeIds => { this.#fitView?.(nodeIds) },
      undo: () => this.undo(),
      redo: () => this.redo(),
    }
  }

  get state(): CanvasClientStateSnapshot {
    return this.#snapshot
  }

  getSnapshot = (): CanvasDocument => {
    this.#assertActive()
    if (this.#document === undefined) throw new Error('No Canvas document is open')
    return this.#document
  }

  getStateSnapshot = (): CanvasClientStateSnapshot => this.#snapshot

  subscribe(listener: (document: CanvasDocument) => void): () => void {
    if (this.#disposed) return () => {}
    this.#documentListeners.add(listener)
    return () => { this.#documentListeners.delete(listener) }
  }

  subscribeState = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => {}
    this.#stateListeners.add(listener)
    return () => { this.#stateListeners.delete(listener) }
  }

  start(): Promise<CanvasDocument> {
    this.#assertActive()
    if (this.#started && this.#document !== undefined) return Promise.resolve(this.getSnapshot())
    if (this.#startTask !== undefined) return this.#startTask
    const task = this.#startOnce()
    this.#startTask = task
    return task
  }

  async #startOnce(): Promise<CanvasDocument> {
    this.#started = true
    this.#status = 'loading'
    this.#error = undefined
    this.#publish(false)
    try {
      const initialDocument = this.#initialDocument
      this.#initialDocument = undefined
      const document = initialDocument ?? await this.#remote.getDocument(this.#identity(), this.#lifetimeAbort.signal)
      this.#assertDocumentIdentity(document)
      this.#authoritative = document
      this.#projectOptimistic()
      this.#status = 'ready'
      this.#publish(true)
      this.#startWaiter()
      return this.getSnapshot()
    } catch (error) {
      this.#started = false
      this.#status = 'error'
      this.#error = error
      this.#publish(false)
      throw error
    } finally {
      this.#startTask = undefined
    }
  }

  refresh(): Promise<CanvasDocument> {
    this.#assertStarted()
    return this.#serialize(async () => this.#refreshNow(true))
  }

  async applyPatch(request: CanvasClientPatchRequest, recordHistory = true): Promise<ApplyCanvasPatchResult> {
    this.#assertStarted()
    if (request.operations.length === 0) {
      const document = this.getSnapshot()
      return { document, revision: document.revision, applied: 0 }
    }

    const current = this.getSnapshot()
    const backward = invertCanvasPatch(current, request.operations)
    const mutationId = request.mutationId ?? this.#nextMutationId()
    if (this.#optimistic.has(mutationId) || this.#recentOwnMutations.has(mutationId)) {
      throw new Error(`Canvas mutationId already used: ${mutationId}`)
    }
    const mutation: OptimisticMutation = { mutationId, operations: request.operations }
    this.#optimistic.set(mutationId, mutation)
    this.#document = applyClientPatch(current, request.operations)
    if (recordHistory) this.history.record({ forward: request.operations, backward })
    this.#status = 'saving'
    this.#error = undefined
    this.#pruneSelection()
    this.#publish(true)

    return this.#serialize(async () => {
      const expectedRevision = this.#authoritative?.revision
      if (expectedRevision === undefined) throw new Error('No authoritative Canvas document is open')
      try {
        const result = await this.#remote.applyPatch({
          workspaceId: this.workspaceId,
          projectId: this.projectId,
          canvasId: this.canvasId,
          expectedRevision,
          mutationId,
          source: request.source ?? this.#source,
          originClientId: this.clientId,
          operations: request.operations,
        }, this.#lifetimeAbort.signal)
        this.#acceptWriteResult(result, expectedRevision)
        this.#optimistic.delete(mutationId)
        this.#rememberOwnMutation(mutationId)
        this.#projectOptimistic()
        this.#status = this.#optimistic.size > 0 ? 'saving' : 'ready'
        this.#error = undefined
        this.#publish(true)
        return result
      } catch (error) {
        this.#optimistic.delete(mutationId)
        this.history.clear()
        this.#status = 'error'
        this.#error = error
        try {
          const authoritative = await this.#remote.getDocument(
            this.#identity(),
            this.#lifetimeAbort.signal,
          )
          this.#assertDocumentIdentity(authoritative)
          this.#authoritative = authoritative
        } catch {
          // Keep the last acknowledged document when recovery is unavailable.
        }
        this.#projectOptimistic()
        this.#publish(true)
        throw error
      }
    })
  }

  applyOperations(
    operations: readonly CanvasPatchOperation[],
    options: { readonly source?: string; readonly mutationId?: string } = {},
  ): Promise<ApplyCanvasPatchResult> {
    return this.applyPatch({ operations, ...options })
  }

  async setViewport(viewport: CanvasViewport): Promise<ApplyCanvasPatchResult> {
    this.#assertStarted()
    await this.#setViewportHook?.(viewport)
    return this.applyPatch({ operations: viewportPatch(this.getSnapshot().viewport, viewport) }, false)
  }

  selectNodes(nodeIds: readonly NodeId[]): void {
    this.#assertStarted()
    this.#selectedNodes.clear()
    for (const nodeId of nodeIds) {
      if (this.getSnapshot().nodes[nodeId] !== undefined) this.#selectedNodes.add(nodeId)
    }
    this.#publish(false)
  }

  selectEdges(edgeIds: readonly EdgeId[]): void {
    this.#assertStarted()
    this.#selectedEdges.clear()
    for (const edgeId of edgeIds) {
      if (this.getSnapshot().edges[edgeId] !== undefined) this.#selectedEdges.add(edgeId)
    }
    this.#publish(false)
  }

  async undo(): Promise<void> {
    const entry = this.history.takeUndo()
    if (entry === undefined) return
    await this.applyPatch({ operations: entry.backward, source: `${this.#source}:undo` }, false)
  }

  async redo(): Promise<void> {
    const entry = this.history.takeRedo()
    if (entry === undefined) return
    await this.applyPatch({ operations: entry.forward, source: `${this.#source}:redo` }, false)
  }

  handleCommittedEvent(event: CanvasCommittedEvent): CanvasCommittedEventDisposition {
    if (this.#disposed) return 'duplicate'
    const authoritative = this.#authoritative
    if (authoritative === undefined) return 'refresh-required'
    const disposition = classifyCanvasCommittedEvent(
      this.workspaceId,
      this.projectId,
      this.canvasId,
      authoritative.revision,
      event,
    )
    if (disposition === 'duplicate') return disposition
    if (disposition === 'refresh-required') {
      if (
        event.workspaceId === this.workspaceId
        && event.projectId === this.projectId
        && event.canvasId === this.canvasId
      ) {
        this.history.clear()
        void this.refresh().catch(() => {})
      }
      return disposition
    }

    const knownOwnMutation = event.originClientId === this.clientId
      && (this.#optimistic.has(event.mutationId) || this.#recentOwnMutations.has(event.mutationId))
    try {
      this.#authoritative = {
        ...applyClientPatch(authoritative, event.operations),
        revision: event.revision,
      }
      if (knownOwnMutation) {
        this.#optimistic.delete(event.mutationId)
        this.#rememberOwnMutation(event.mutationId)
      } else {
        this.history.clear()
      }
      this.#projectOptimistic()
      this.#status = this.#optimistic.size > 0 ? 'saving' : 'ready'
      this.#publish(true)
    } catch {
      this.history.clear()
      void this.refresh().catch(() => {})
      return 'refresh-required'
    }
    return disposition
  }

  async flush(): Promise<void> {
    await this.#writeTail
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#lifetimeAbort.abort()
    this.#waitAbort?.abort()
    try {
      await this.#waitTask
    } catch {
      // Cancellation and transport failures are retired during disposal.
    }
    this.#optimistic.clear()
    this.history.clear()
    this.#selectedNodes.clear()
    this.#selectedEdges.clear()
    this.#initialDocument = undefined
    this.#authoritative = undefined
    this.#document = undefined
    this.#status = 'closed'
    this.#snapshot = this.#createStateSnapshot()
    if (this.#ownsRenderers) this.renderers.dispose()
    this.#documentListeners.clear()
    this.#stateListeners.clear()
  }

  async #refreshNow(clearHistory: boolean): Promise<CanvasDocument> {
    const document = await this.#remote.getDocument(this.#identity(), this.#lifetimeAbort.signal)
    this.#assertDocumentIdentity(document)
    if (clearHistory && this.#authoritative !== undefined && document.revision > this.#authoritative.revision) {
      this.history.clear()
    }
    this.#authoritative = document
    this.#projectOptimistic()
    this.#status = this.#optimistic.size > 0 ? 'saving' : 'ready'
    this.#error = undefined
    this.#publish(true)
    return this.getSnapshot()
  }

  #acceptWriteResult(result: ApplyCanvasPatchResult, expectedRevision: number): void {
    const expectedResultRevision = expectedRevision + 1
    this.#assertDocumentIdentity(result.document)
    if (result.revision !== expectedResultRevision || result.document.revision !== expectedResultRevision) {
      throw new Error(`Canvas write must advance exactly one revision from ${expectedRevision}`)
    }
    const currentRevision = this.#authoritative?.revision ?? -1
    if (currentRevision !== expectedRevision && currentRevision !== expectedResultRevision) {
      throw new Error('Canvas authoritative revision changed during serialized write')
    }
    this.#authoritative = result.document
  }

  #projectOptimistic(): void {
    const authoritative = this.#authoritative
    if (authoritative === undefined) {
      this.#document = undefined
      return
    }
    let projected = authoritative
    for (const mutation of this.#optimistic.values()) {
      projected = applyClientPatch(projected, mutation.operations)
    }
    this.#document = projected
    this.#pruneSelection()
  }

  #startWaiter(): void {
    if (this.#waitTask !== undefined || this.#waitAbort !== undefined) {
      throw new Error('Canvas revision waiter is already running')
    }
    const controller = new AbortController()
    this.#waitAbort = controller
    const task = this.#runWaiter(controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted || this.#disposed) return
        this.#status = 'error'
        this.#error = error
        this.#publish(false)
      })
      .finally(() => {
        if (this.#waitAbort === controller) this.#waitAbort = undefined
        if (this.#waitTask === task) this.#waitTask = undefined
      })
    this.#waitTask = task
  }

  async #runWaiter(signal: AbortSignal): Promise<void> {
    let failures = 0
    while (!signal.aborted && !this.#disposed && this.#authoritative !== undefined) {
      let result: WaitForCanvasRevisionResult
      try {
        result = await this.#remote.waitForRevision({
          workspaceId: this.workspaceId,
          projectId: this.projectId,
          canvasId: this.canvasId,
          afterRevision: this.#authoritative.revision,
          timeoutMs: this.#revisionWaitMs,
        }, signal)
      } catch (error) {
        if (signal.aborted || this.#disposed) return
        failures += 1
        if (failures >= FAILURE_REPORT_THRESHOLD) {
          this.#waitError = error
          this.#status = 'error'
          this.#error = error
          this.#publish(false)
        }
        await abortableDelay(retryDelay(failures), signal)
        continue
      }

      const recoveredError = this.#waitError
      failures = 0
      this.#waitError = undefined
      if (signal.aborted || this.#disposed) return
      if (result.status === 'timeout') {
        if (recoveredError !== undefined && this.#error === recoveredError) {
          this.#status = this.#optimistic.size > 0 ? 'saving' : 'ready'
          this.#error = undefined
          this.#publish(false)
        }
        continue
      }
      if (result.status === 'deleted') {
        this.#authoritative = undefined
        this.#document = undefined
        this.#optimistic.clear()
        this.history.clear()
        this.#selectedNodes.clear()
        this.#selectedEdges.clear()
        this.#status = 'closed'
        this.#error = undefined
        this.#publish(false)
        return
      }

      await this.#serialize(async () => {
        const authoritative = this.#authoritative
        if (authoritative === undefined || result.document.revision <= authoritative.revision) return
        this.#assertDocumentIdentity(result.document)
        this.history.clear()
        this.#authoritative = result.document
        this.#projectOptimistic()
        if (this.#error === undefined || this.#error === recoveredError) {
          this.#status = this.#optimistic.size > 0 ? 'saving' : 'ready'
          this.#error = undefined
        }
        this.#publish(true)
      })
    }
  }

  #identity(): GetCanvasDocumentRequest {
    return {
      workspaceId: this.workspaceId,
      projectId: this.projectId,
      canvasId: this.canvasId,
    }
  }

  #assertDocumentIdentity(document: CanvasDocument): void {
    if (document.workspaceId !== this.workspaceId || document.id !== this.canvasId) {
      throw new Error('Canvas Remote returned a different document')
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.#writeTail.then(operation)
    this.#writeTail = task.then(() => {}, () => {})
    return task
  }

  #nextMutationId(): string {
    this.#mutationCounter += 1
    return `${this.clientId}:${this.#mutationCounter}`
  }

  #rememberOwnMutation(mutationId: string): void {
    this.#recentOwnMutations.add(mutationId)
    if (this.#recentOwnMutations.size > 128) {
      const oldest = this.#recentOwnMutations.values().next().value
      if (oldest !== undefined) this.#recentOwnMutations.delete(oldest)
    }
  }

  #pruneSelection(): void {
    const document = this.#document
    if (document === undefined) return
    for (const nodeId of this.#selectedNodes) {
      if (document.nodes[nodeId] === undefined) this.#selectedNodes.delete(nodeId)
    }
    for (const edgeId of this.#selectedEdges) {
      if (document.edges[edgeId] === undefined) this.#selectedEdges.delete(edgeId)
    }
  }

  #createStateSnapshot(): CanvasClientStateSnapshot {
    return Object.freeze({
      status: this.#status,
      document: this.#document,
      error: this.#error,
      dirty: this.#optimistic.size > 0,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      selectedNodeIds: Object.freeze([...this.#selectedNodes]),
      selectedEdgeIds: Object.freeze([...this.#selectedEdges]),
    })
  }

  #publish(documentChanged: boolean): void {
    if (this.#disposed) return
    this.#snapshot = this.#createStateSnapshot()
    if (documentChanged && this.#document !== undefined) {
      for (const listener of [...this.#documentListeners]) listener(this.#document)
    }
    for (const listener of [...this.#stateListeners]) listener()
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Canvas Client service is disposed')
  }

  #assertStarted(): void {
    this.#assertActive()
    if (!this.#started || this.#document === undefined) throw new Error('Canvas Client service is not started')
  }
}

function retryDelay(failures: number): number {
  return Math.min(RETRY_BASE_MS * (2 ** Math.min(Math.max(failures - 1, 0), 5)), RETRY_MAX_MS)
}

function abortableDelay(timeoutMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, timeoutMs)
    function done(): void {
      signal.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', aborted)
      reject(signal.reason)
    }
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
  })
}
