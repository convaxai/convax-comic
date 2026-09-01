import {
  isJsonValue,
  isPlainObject,
  type ApplyCanvasPatchRequest,
  type ApplyCanvasPatchResult,
  type CanvasClientActions,
  type CanvasClientApi,
  type CanvasClientPatchRequest,
  type CanvasCommittedEvent,
  type CanvasCommittedEventDisposition,
  type CanvasDocument,
  type CanvasId,
  type CanvasProject,
  type CanvasViewport,
  type GetCanvasDocumentRequest,
  type ProjectId,
  type WaitForCanvasRevisionRequest,
  type WaitForCanvasRevisionResult,
  type WorkspaceId,
} from '@convax/canvas-api'
import type {
  RemoteFailure,
  RemoteResult,
  TypertRemoteNamespaceMap,
} from '@deepseek-ai/dsh-typert-protocol'
import type {} from '../remote-v2.js'
import {
  CanvasClientService,
  type CanvasClientServiceOptions,
  type CanvasRemotePort,
} from './canvas-client-service.js'
import {
  ComicCanvasWorkspace,
  type ComicCanvasWorkspaceOptions,
} from './comic-workspace-v2.js'
import { CanvasRendererRegistry } from './renderer-registry.js'

export type CanvasRemoteV2Api = TypertRemoteNamespaceMap['canvasV2']

export class CanvasRemoteV2Error extends Error {
  readonly code: string
  readonly details: object

  constructor(failure: RemoteFailure) {
    super(failure.message)
    this.name = 'CanvasRemoteV2Error'
    this.code = failure.code
    this.details = failure.details
  }
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

/** Strictly unwraps only the official Typert RemoteResult envelope. */
export function unwrapCanvasRemoteV2Result<T>(result: RemoteResult<T>): T {
  if (!isPlainObject(result) || typeof result.ok !== 'boolean') {
    throw new TypeError('Malformed Canvas V2 RemoteResult')
  }
  if (result.ok) {
    if (!exactKeys(result, ['ok', 'value'])) throw new TypeError('Malformed Canvas V2 success result')
    return result.value
  }
  if (!exactKeys(result, ['ok', 'error']) || !isPlainObject(result.error)
    || !exactKeys(result.error, ['code', 'message', 'details'])
    || typeof result.error.code !== 'string' || result.error.code === ''
    || typeof result.error.message !== 'string'
    || !isPlainObject(result.error.details) || !isJsonValue(result.error.details)) {
    throw new TypeError('Malformed Canvas V2 failure result')
  }
  throw new CanvasRemoteV2Error(result.error as unknown as RemoteFailure)
}

/** Adapts the wrapped Typert namespace to the unwrapped CanvasClientService port. */
export class CanvasRemoteV2Port implements CanvasRemotePort {
  readonly #remote: CanvasRemoteV2Api

  constructor(remote: CanvasRemoteV2Api) {
    this.#remote = remote
  }

  async getDocument(request: GetCanvasDocumentRequest): Promise<CanvasDocument> {
    return unwrapCanvasRemoteV2Result(await this.#remote.getDocument(request))
  }

  async applyPatch(request: ApplyCanvasPatchRequest): Promise<ApplyCanvasPatchResult> {
    return unwrapCanvasRemoteV2Result(await this.#remote.applyPatch(request))
  }

  async waitForRevision(
    request: WaitForCanvasRevisionRequest,
    signal?: AbortSignal,
  ): Promise<WaitForCanvasRevisionResult> {
    return unwrapCanvasRemoteV2Result(await this.#remote.waitForRevision(
      request,
      signal ?? new AbortController().signal,
    ))
  }
}

export function createCanvasRemoteV2Port(remote: CanvasRemoteV2Api): CanvasRemotePort {
  return new CanvasRemoteV2Port(remote)
}

export interface CanvasProjectCanvasSummary {
  readonly id: CanvasId
  readonly title: string
  readonly nodeCount: number
  readonly edgeCount: number
}

export interface CanvasProjectSyncSnapshot {
  readonly revision: number
  readonly activeCanvasId: CanvasId
  readonly canvases: readonly CanvasProjectCanvasSummary[]
}

export interface CanvasProjectSyncOptions {
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
  readonly clientId?: string
  readonly source?: string
  readonly revisionWaitMs?: number
  readonly renderers?: CanvasRendererRegistry
  readonly workspace?: ComicCanvasWorkspaceOptions
  readonly createCanvasId?: () => CanvasId
  readonly ensureProject?: {
    readonly canvasId?: CanvasId
    readonly title?: string
  }
  readonly fitView?: CanvasClientServiceOptions['fitView']
  readonly setViewport?: CanvasClientServiceOptions['setViewport']
}

let generatedSyncId = 0

function randomSuffix(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function defaultSyncId(): string {
  generatedSyncId += 1
  return `canvas-project-sync-${generatedSyncId}-${randomSuffix()}`
}

function defaultCanvasId(): CanvasId {
  return `canvas:${randomSuffix()}`
}

function emptyProjectSnapshot(): CanvasProjectSyncSnapshot {
  return Object.freeze({ revision: 0, activeCanvasId: '', canvases: Object.freeze([]) })
}

/** Coordinates one V2 project while exposing stable UI and CanvasClient surfaces. */
export class CanvasProjectSync {
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
  readonly clientId: string
  readonly renderers: CanvasRendererRegistry
  readonly actions: CanvasClientActions
  readonly canvasClient: CanvasClientApi
  readonly client: CanvasClientApi

  readonly #remote: CanvasRemoteV2Api
  readonly #port: CanvasRemotePort
  readonly #source: string
  readonly #revisionWaitMs: number | undefined
  readonly #workspaceOptions: ComicCanvasWorkspaceOptions
  readonly #createCanvasId: () => CanvasId
  readonly #ensureProject: CanvasProjectSyncOptions['ensureProject']
  readonly #fitView: CanvasClientServiceOptions['fitView']
  readonly #setViewport: CanvasClientServiceOptions['setViewport']
  readonly #ownsRenderers: boolean
  readonly #projectListeners = new Set<() => void>()
  readonly #documentListeners = new Set<(document: CanvasDocument) => void>()

  #project: CanvasProject | undefined
  #snapshot: CanvasProjectSyncSnapshot = emptyProjectSnapshot()
  #service: CanvasClientService | undefined
  #workspace: ComicCanvasWorkspace | undefined
  #unsubscribeDocument: (() => void) | undefined
  #projectTail: Promise<void> = Promise.resolve()
  #startTask: Promise<void> | undefined
  #mutationCounter = 0
  #disposed = false

  constructor(remote: CanvasRemoteV2Api, options: CanvasProjectSyncOptions) {
    this.#remote = remote
    this.#port = createCanvasRemoteV2Port(remote)
    this.workspaceId = options.workspaceId
    this.projectId = options.projectId
    this.clientId = options.clientId ?? defaultSyncId()
    this.#source = options.source ?? '@convax/canvas:project-sync'
    this.#revisionWaitMs = options.revisionWaitMs
    this.#workspaceOptions = options.workspace ?? {}
    this.#createCanvasId = options.createCanvasId ?? defaultCanvasId
    this.#ensureProject = options.ensureProject
    this.#fitView = options.fitView
    this.#setViewport = options.setViewport
    this.#ownsRenderers = options.renderers === undefined
    this.renderers = options.renderers ?? new CanvasRendererRegistry()

    this.actions = {
      applyPatch: request => this.#active().actions.applyPatch(request),
      setViewport: viewport => this.#active().actions.setViewport(viewport),
      selectNodes: nodeIds => { this.#active().actions.selectNodes(nodeIds) },
      selectEdges: edgeIds => { this.#active().actions.selectEdges(edgeIds) },
      fitView: nodeIds => { this.#active().actions.fitView(nodeIds) },
      undo: () => this.#active().actions.undo(),
      redo: () => this.#active().actions.redo(),
    }

    const coordinator = this
    this.canvasClient = Object.freeze({
      get workspaceId(): WorkspaceId { return coordinator.workspaceId },
      get projectId(): ProjectId { return coordinator.projectId },
      get canvasId(): CanvasId { return coordinator.#active().canvasId },
      get actions(): CanvasClientActions { return coordinator.actions },
      get renderers(): CanvasRendererRegistry { return coordinator.renderers },
      getSnapshot: (): CanvasDocument => coordinator.#active().getSnapshot(),
      refresh: (): Promise<CanvasDocument> => coordinator.#active().refresh(),
      handleCommittedEvent: (event: CanvasCommittedEvent): CanvasCommittedEventDisposition =>
        coordinator.#active().handleCommittedEvent(event),
      subscribe: (listener: (document: CanvasDocument) => void): (() => void) =>
        coordinator.#subscribeDocument(listener),
    })
    this.client = this.canvasClient
  }

  get workspace(): ComicCanvasWorkspace {
    if (this.#workspace === undefined) throw new Error('Canvas project sync is not started')
    return this.#workspace
  }

  get activeService(): CanvasClientService {
    return this.#active()
  }

  getSnapshot = (): CanvasProjectSyncSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#assertActive()
    this.#projectListeners.add(listener)
    return () => { this.#projectListeners.delete(listener) }
  }

  start(): Promise<void> {
    this.#assertActive()
    if (this.#service !== undefined) return Promise.resolve()
    if (this.#startTask !== undefined) return this.#startTask
    const task = this.#startOnce().finally(() => {
      if (this.#startTask === task) this.#startTask = undefined
    })
    this.#startTask = task
    return task
  }

  async #startOnce(): Promise<void> {
    const project = await this.#getOrCreateProject()
    this.#assertActive()
    const service = this.#createService(project.activeCanvasId, project.canvases[project.activeCanvasId])
    try {
      await service.start()
      this.#assertActive()
      const workspace = new ComicCanvasWorkspace(service, { ...this.#workspaceOptions, disposeService: false })
      this.#project = project
      this.#service = service
      this.#workspace = workspace
      this.#bindDocument(service)
      this.#publishProject(project)
    } catch (error) {
      await service.dispose()
      throw error
    }
  }

  refreshProject(): Promise<CanvasProjectSyncSnapshot> {
    this.#assertStarted()
    return this.#serializeProject(async () => {
      const project = await this.#getProject()
      if (project.activeCanvasId !== this.#active().canvasId) {
        await this.#switch(project, project.activeCanvasId)
      } else {
        this.#project = project
        this.#publishProject(project)
      }
      return this.#snapshot
    })
  }

  createCanvas(title = ''): Promise<CanvasId> {
    this.#assertStarted()
    return this.#serializeProject(async () => {
      const current = await this.#getProject()
      const canvasId = this.#createCanvasId()
      await this.#unwrap(this.#remote.createDocument({
        workspaceId: this.workspaceId,
        projectId: this.projectId,
        canvasId,
        title,
        expectedProjectRevision: current.revision,
        ...this.#metadata('create-document'),
      }))
      const project = await this.#getProject()
      await this.#switch(project, canvasId)
      return canvasId
    })
  }

  selectCanvas(canvasId: CanvasId): Promise<void> {
    this.#assertStarted()
    if (canvasId === this.#active().canvasId) return Promise.resolve()
    return this.#serializeProject(async () => {
      const current = await this.#getProject()
      await this.#unwrap(this.#remote.setActiveCanvas({
        workspaceId: this.workspaceId,
        projectId: this.projectId,
        canvasId,
        expectedRevision: current.revision,
        ...this.#metadata('select-canvas'),
      }))
      const project = await this.#getProject()
      await this.#switch(project, canvasId)
    })
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const startup = this.#startTask
    if (startup !== undefined) {
      try {
        await startup
      } catch {
        // A startup invalidated by disposal has already cleaned its local service.
      }
    }
    try {
      await this.#projectTail
    } catch {
      // A failed project operation does not prevent teardown.
    }
    const service = this.#service
    const workspace = this.#workspace
    this.#unsubscribeDocument?.()
    this.#unsubscribeDocument = undefined
    if (workspace !== undefined) {
      // The stable facade owns its current service and initiates its aborting dispose.
      workspace.dispose()
    } else if (service !== undefined) {
      await service.dispose()
    }
    if (service !== undefined) await service.dispose()
    if (this.#ownsRenderers) this.renderers.dispose()
    this.#projectListeners.clear()
    this.#documentListeners.clear()
    this.#service = undefined
    this.#workspace = undefined
    this.#project = undefined
  }

  #createService(canvasId: CanvasId, initialDocument?: CanvasDocument): CanvasClientService {
    return new CanvasClientService(this.#port, {
      workspaceId: this.workspaceId,
      projectId: this.projectId,
      canvasId,
      clientId: `${this.clientId}:${canvasId}`,
      source: this.#source,
      ...(initialDocument === undefined ? {} : { initialDocument }),
      renderers: this.renderers,
      ...(this.#revisionWaitMs === undefined ? {} : { revisionWaitMs: this.#revisionWaitMs }),
      ...(this.#fitView === undefined ? {} : { fitView: this.#fitView }),
      ...(this.#setViewport === undefined ? {} : { setViewport: this.#setViewport }),
    })
  }

  async #switch(project: CanvasProject, canvasId: CanvasId): Promise<void> {
    if (project.activeCanvasId !== canvasId || project.canvases[canvasId] === undefined) {
      throw new Error(`Canvas project did not activate ${canvasId}`)
    }
    const old = this.#active()
    await old.flush()
    const next = this.#createService(canvasId, project.canvases[canvasId])
    try {
      await next.start()
      const workspace = this.workspace
      workspace.switchService(next)
      this.#unsubscribeDocument?.()
      this.#service = next
      this.#bindDocument(next)
      this.#project = project
      this.#publishProject(project)
      this.#emitDocument(next.getSnapshot())
    } catch (error) {
      await next.dispose()
      throw error
    }
    await old.dispose()
  }

  #bindDocument(service: CanvasClientService): void {
    this.#unsubscribeDocument?.()
    this.#unsubscribeDocument = service.subscribe((document) => {
      if (service !== this.#service) return
      this.#updateActiveSummary(document)
      this.#emitDocument(document)
    })
  }

  #subscribeDocument(listener: (document: CanvasDocument) => void): () => void {
    this.#assertActive()
    this.#documentListeners.add(listener)
    return () => { this.#documentListeners.delete(listener) }
  }

  #emitDocument(document: CanvasDocument): void {
    for (const listener of [...this.#documentListeners]) listener(document)
  }

  #updateActiveSummary(document: CanvasDocument): void {
    const project = this.#project
    if (project === undefined || document.id !== project.activeCanvasId) return
    const next: CanvasProject = {
      ...project,
      canvases: { ...project.canvases, [document.id]: document },
    }
    this.#project = next
    this.#publishProject(next)
  }

  #publishProject(project: CanvasProject): void {
    const canvases = Object.values(project.canvases)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map(document => Object.freeze({
        id: document.id,
        title: document.metadata.title,
        nodeCount: Object.keys(document.nodes).length,
        edgeCount: Object.keys(document.edges).length,
      }))
    this.#snapshot = Object.freeze({
      revision: project.revision,
      activeCanvasId: project.activeCanvasId,
      canvases: Object.freeze(canvases),
    })
    for (const listener of [...this.#projectListeners]) listener()
  }

  async #getOrCreateProject(): Promise<CanvasProject> {
    try {
      return await this.#getProject()
    } catch (error) {
      if (!(error instanceof CanvasRemoteV2Error)
        || (error.code !== 'PROJECT_NOT_FOUND' && !error.message.startsWith('Canvas project not found:'))
        || this.#ensureProject === undefined) throw error
    }

    this.#assertActive()
    const canvasId = this.#ensureProject.canvasId ?? this.#createCanvasId()
    try {
      const project = await this.#unwrap(this.#remote.createProject({
        workspaceId: this.workspaceId,
        projectId: this.projectId,
        canvasId,
        title: this.#ensureProject.title ?? 'Untitled canvas',
        ...this.#metadata('initialize-project'),
      }))
      return this.#assertProjectScope(project)
    } catch (error) {
      if (!(error instanceof CanvasRemoteV2Error)
        || (error.code !== 'PROJECT_ALREADY_EXISTS' && !error.message.startsWith('Canvas project already exists:'))) throw error
      return await this.#getProject()
    }
  }

  async #getProject(): Promise<CanvasProject> {
    const project = await this.#unwrap(this.#remote.getProject({
      workspaceId: this.workspaceId,
      projectId: this.projectId,
    }))
    return this.#assertProjectScope(project)
  }

  #assertProjectScope(project: CanvasProject): CanvasProject {
    if (project.workspaceId !== this.workspaceId || project.id !== this.projectId) {
      throw new Error('Canvas V2 Remote returned a different project')
    }
    return project
  }

  async #unwrap<T>(task: Promise<RemoteResult<T>>): Promise<T> {
    return unwrapCanvasRemoteV2Result(await task)
  }

  #metadata(operation: string): { mutationId: string; source: string; originClientId: string } {
    this.#mutationCounter += 1
    return {
      mutationId: `${this.clientId}:${operation}:${this.#mutationCounter}`,
      source: this.#source,
      originClientId: this.clientId,
    }
  }

  #serializeProject<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.#projectTail.then(operation)
    this.#projectTail = task.then(() => {}, () => {})
    return task
  }

  #requireProject(): CanvasProject {
    if (this.#project === undefined) throw new Error('Canvas project sync is not started')
    return this.#project
  }

  #active(): CanvasClientService {
    if (this.#service === undefined) throw new Error('Canvas project sync is not started')
    return this.#service
  }

  #assertStarted(): void {
    this.#assertActive()
    this.#active()
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Canvas project sync is disposed')
  }
}
