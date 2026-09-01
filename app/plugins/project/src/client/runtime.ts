import type { RemoteFailure, RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ComicProjectScope,
  ListProjectFilesResult,
  ProjectFileEntry,
  WaitProjectFilesResult,
} from '../contracts.js'
import { PROJECT_ROOT_ID } from '../contracts.js'
import type {} from '../remote.js'

export interface ObservableStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface WorkspaceViewLike {
  readonly workspaceId: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

export interface WorkspacesLike {
  readonly list: ObservableStore<{
    readonly items: readonly WorkspaceViewLike[]
    readonly baselinesReady: boolean
    readonly recentWorkspaceId?: string
  }>
  connectWorkspace(workspaceId: string): Promise<string>
  create(input: { path: string }): Promise<WorkspaceViewLike>
  pickDirectory(): Promise<string | null>
}

export interface SessionsLike {
  readonly list: ObservableStore<{ readonly current?: string }>
  open(sessionId: string): void
}

export interface ProjectDirectorySnapshot {
  readonly entries: readonly ProjectFileEntry[]
  readonly truncated: boolean
  readonly loading: boolean
  readonly error?: string
}

export interface ComicProjectSnapshot {
  readonly activeWorkspaceId?: string
  readonly workspaces: readonly WorkspaceViewLike[]
  readonly sequence: number
  readonly directories: Readonly<Record<string, ProjectDirectorySnapshot>>
  readonly expanded: readonly string[]
  readonly phase: 'idle' | 'opening' | 'ready' | 'error'
  readonly error?: string
}

type ProjectRemote = TypertRemoteNamespaceMap['projectFiles']
type Listener = () => void

interface WorkspaceNavigation {
  readonly workspaceId: string
  readonly previousSessionId: string | undefined
  sessionId?: string
}

export class ProjectRemoteError extends Error {
  readonly code: string
  constructor(failure: RemoteFailure) {
    super(failure.message)
    this.name = 'ProjectRemoteError'
    this.code = failure.code
  }
}

export function unwrapProjectRemote<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw new ProjectRemoteError(result.error)
}

export function selectActiveWorkspace(
  workspaces: readonly WorkspaceViewLike[],
  currentSessionId: string | undefined,
  recentWorkspaceId: string | undefined,
): string | undefined {
  if (currentSessionId !== undefined) {
    return workspaces.find(workspace => workspace.sessionIds.includes(currentSessionId))?.workspaceId
  }
  if (recentWorkspaceId !== undefined && workspaces.some(workspace => workspace.workspaceId === recentWorkspaceId)) {
    return recentWorkspaceId
  }
  return workspaces[0]?.workspaceId
}

export class ComicProjectRuntime {
  readonly #remote: ProjectRemote
  readonly #workspaces: WorkspacesLike
  readonly #sessions: SessionsLike
  readonly #listeners = new Set<Listener>()
  readonly #directories = new Map<string, ProjectDirectorySnapshot>()
  readonly #directoryRequests = new Map<string, number>()
  readonly #expanded = new Set<string>()
  #snapshot: ComicProjectSnapshot = Object.freeze({
    workspaces: Object.freeze([]), sequence: 0, directories: Object.freeze({}), expanded: Object.freeze([]), phase: 'idle',
  })
  #leaseId: string | undefined
  #leaseAbort: AbortController | undefined
  #navigation: WorkspaceNavigation | undefined
  #navigationVersion = 0
  #addProjectRequestId = 0
  #generation = 0
  #directoryRequestId = 0
  #disposed = false
  #unsubscribers: Array<() => void> = []

  constructor(remote: ProjectRemote, workspaces: WorkspacesLike, sessions: SessionsLike) {
    this.#remote = remote
    this.#workspaces = workspaces
    this.#sessions = sessions
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
  readonly getSnapshot = (): ComicProjectSnapshot => this.#snapshot

  start(): void {
    if (this.#unsubscribers.length > 0 || this.#disposed) return
    const refresh = (): void => { this.#followSelection() }
    this.#unsubscribers = [this.#workspaces.list.subscribe(refresh), this.#sessions.list.subscribe(refresh)]
    refresh()
  }

  scope(): ComicProjectScope | undefined {
    const workspaceId = this.#snapshot.activeWorkspaceId
    return workspaceId === undefined ? undefined : Object.freeze({
      workspaceId,
      projectId: PROJECT_ROOT_ID,
      readFile: (path: string, signal: AbortSignal) => this.#readProjectFile(workspaceId, path, signal),
    })
  }

  async #readProjectFile(workspaceId: string, path: string, signal: AbortSignal) {
    if (this.#disposed || workspaceId !== this.#snapshot.activeWorkspaceId) {
      throw new Error('project selection changed before the file could be added to Canvas')
    }
    return unwrapProjectRemote(await this.#remote.read({ workspaceId, path }, signal))
  }

  async switchWorkspace(workspaceId: string): Promise<void> {
    if (this.#disposed) return
    this.#navigationVersion += 1
    const navigation: WorkspaceNavigation = {
      workspaceId,
      previousSessionId: this.#sessions.list.getSnapshot().current,
    }
    this.#navigation = navigation
    this.#followSelection()
    try {
      const sessionId = await this.#workspaces.connectWorkspace(workspaceId)
      if (this.#disposed || this.#navigation !== navigation) return
      const current = this.#sessions.list.getSnapshot().current
      if (current !== navigation.previousSessionId && current !== sessionId) {
        this.#navigation = undefined
        this.#followSelection()
        return
      }
      navigation.sessionId = sessionId
      this.#sessions.open(sessionId)
      this.#followSelection()
    } catch (error) {
      if (this.#disposed || this.#navigation !== navigation) return
      this.#navigation = undefined
      this.#followSelection()
      throw error
    }
  }

  async addProject(): Promise<void> {
    const requestId = ++this.#addProjectRequestId
    const navigationVersion = this.#navigationVersion
    const stale = (): boolean => this.#disposed
      || requestId !== this.#addProjectRequestId
      || navigationVersion !== this.#navigationVersion
    let path: string | null
    try {
      path = await this.#workspaces.pickDirectory()
    } catch (error) {
      if (stale()) return
      throw error
    }
    if (path === null || stale()) return
    let workspace: WorkspaceViewLike
    try {
      workspace = await this.#workspaces.create({ path })
    } catch (error) {
      if (stale()) return
      throw error
    }
    if (stale()) return
    await this.switchWorkspace(workspace.workspaceId)
  }

  async newSession(): Promise<void> {
    const workspaceId = this.#snapshot.activeWorkspaceId
    if (workspaceId === undefined) return
    await this.switchWorkspace(workspaceId)
  }

  async toggleDirectory(path: string): Promise<void> {
    if (this.#expanded.has(path)) {
      this.#expanded.delete(path)
      this.#publish()
      return
    }
    this.#expanded.add(path)
    this.#publish()
    await this.loadDirectory(path)
  }

  async refreshVisibleDirectories(): Promise<void> {
    if (this.#leaseId === undefined) return
    const paths = new Set<string>(['', ...this.#expanded])
    await Promise.all([...paths].map(path => this.loadDirectory(path)))
  }

  async loadDirectory(path: string): Promise<void> {
    const leaseId = this.#leaseId
    if (leaseId === undefined) return
    const requestId = ++this.#directoryRequestId
    this.#directoryRequests.set(path, requestId)
    this.#directories.set(path, { entries: this.#directories.get(path)?.entries ?? [], truncated: false, loading: true })
    this.#publish()
    try {
      const result = unwrapProjectRemote(await this.#remote.list({ leaseId, path }))
      if (leaseId !== this.#leaseId || this.#directoryRequests.get(path) !== requestId) return
      this.#directoryRequests.delete(path)
      this.#directories.set(path, { entries: result.entries, truncated: result.truncated, loading: false })
      this.#setSequence(result)
    } catch (error) {
      if (leaseId !== this.#leaseId || this.#directoryRequests.get(path) !== requestId) return
      this.#directoryRequests.delete(path)
      this.#directories.set(path, {
        entries: this.#directories.get(path)?.entries ?? [], truncated: false, loading: false, error: message(error),
      })
      this.#publish()
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#generation += 1
    this.#navigation = undefined
    this.#directoryRequests.clear()
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe()
    await this.#releaseLease()
    this.#listeners.clear()
  }

  #followSelection(): void {
    if (this.#disposed) return
    const workspaces = this.#workspaces.list.getSnapshot()
    const current = this.#sessions.list.getSnapshot().current
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspaces.items.find(workspace => workspace.sessionIds.includes(current))?.workspaceId
    const navigation = this.#navigation
    let selected: string | undefined
    if (navigation === undefined) {
      selected = workspaces.baselinesReady
        ? selectActiveWorkspace(workspaces.items, current, workspaces.recentWorkspaceId)
        : undefined
    } else if (navigation.sessionId === undefined
      || current === navigation.sessionId
      || current === navigation.previousSessionId) {
      selected = navigation.workspaceId
      if (current === navigation.sessionId && currentWorkspaceId === navigation.workspaceId) {
        this.#navigation = undefined
      }
    } else {
      this.#navigation = undefined
      selected = workspaces.baselinesReady
        ? selectActiveWorkspace(workspaces.items, current, workspaces.recentWorkspaceId)
        : undefined
    }
    if (selected === this.#snapshot.activeWorkspaceId) {
      this.#snapshot = Object.freeze({ ...this.#snapshot, workspaces: Object.freeze([...workspaces.items]) })
      this.#emit()
      return
    }
    const generation = ++this.#generation
    this.#snapshot = Object.freeze({
      ...(selected !== undefined ? { activeWorkspaceId: selected } : {}),
      workspaces: Object.freeze([...workspaces.items]),
      sequence: 0,
      directories: Object.freeze({}),
      expanded: Object.freeze([]),
      phase: selected === undefined ? 'idle' : 'opening',
    })
    this.#directories.clear()
    this.#directoryRequests.clear()
    this.#expanded.clear()
    this.#emit()
    void this.#openSelection(selected, generation)
  }

  async #openSelection(workspaceId: string | undefined, generation: number): Promise<void> {
    await this.#releaseLease()
    if (workspaceId === undefined || generation !== this.#generation || this.#disposed) return
    try {
      const opened = unwrapProjectRemote(await this.#remote.open({ workspaceId }))
      if (generation !== this.#generation || this.#disposed) {
        await this.#remote.close({ leaseId: opened.leaseId })
        return
      }
      this.#leaseId = opened.leaseId
      this.#leaseAbort = new AbortController()
      this.#snapshot = Object.freeze({ ...this.#snapshot, sequence: opened.sequence, phase: 'ready' })
      this.#emit()
      await this.loadDirectory('')
      void this.#waitLoop(opened.leaseId, generation, this.#leaseAbort.signal)
    } catch (error) {
      if (generation !== this.#generation || this.#disposed) return
      this.#snapshot = Object.freeze({ ...this.#snapshot, phase: 'error', error: message(error) })
      this.#emit()
    }
  }

  async #waitLoop(leaseId: string, generation: number, signal: AbortSignal): Promise<void> {
    let after = this.#snapshot.sequence
    while (!signal.aborted && generation === this.#generation && leaseId === this.#leaseId) {
      try {
        const result = unwrapProjectRemote(await this.#remote.wait({ leaseId, afterSequence: after, timeoutMs: 20_000 }, signal))
        if (signal.aborted || generation !== this.#generation || leaseId !== this.#leaseId) return
        after = result.sequence
        if (result.status === 'changed') await this.#applyInvalidation(result)
      } catch (error) {
        if (signal.aborted || generation !== this.#generation) return
        this.#snapshot = Object.freeze({ ...this.#snapshot, phase: 'error', error: message(error) })
        this.#emit()
        return
      }
    }
  }

  async #applyInvalidation(result: Extract<WaitProjectFilesResult, { status: 'changed' }>): Promise<void> {
    this.#snapshot = Object.freeze({ ...this.#snapshot, sequence: result.sequence })
    const paths = result.reset ? [...this.#directories.keys()] : result.paths.filter(path => this.#directories.has(path))
    if (result.reset && paths.length === 0) paths.push('')
    await Promise.all(paths.map(path => this.loadDirectory(path)))
    this.#publish()
  }

  async #releaseLease(): Promise<void> {
    this.#leaseAbort?.abort(new Error('project selection changed'))
    this.#leaseAbort = undefined
    const leaseId = this.#leaseId
    this.#leaseId = undefined
    if (leaseId !== undefined) {
      try { await this.#remote.close({ leaseId }) } catch { /* Host lifecycle is authoritative. */ }
    }
  }

  #setSequence(result: ListProjectFilesResult): void {
    this.#snapshot = Object.freeze({ ...this.#snapshot, sequence: Math.max(this.#snapshot.sequence, result.sequence) })
    this.#publish()
  }

  #publish(): void {
    const directories: Record<string, ProjectDirectorySnapshot> = {}
    for (const [path, value] of this.#directories) directories[path] = Object.freeze({ ...value, entries: Object.freeze([...value.entries]) })
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      directories: Object.freeze(directories),
      expanded: Object.freeze([...this.#expanded].sort()),
    })
    this.#emit()
  }

  #emit(): void { for (const listener of this.#listeners) listener() }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
