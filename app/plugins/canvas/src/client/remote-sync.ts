import { parseCanvasDocument, serializeCanvasDocument } from '../schema.ts'
import type { CanvasWireSnapshot, CanvasWireSummary } from '../remote.ts'
import { CanvasWorkspace } from './store.ts'

interface RemoteResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly code: string; readonly message: string }
}

export interface CanvasRemoteApi {
  read(): Promise<RemoteResult<CanvasWireSnapshot>>
  replace(documentJson: string, expectedRevision: number): Promise<RemoteResult<CanvasWireSnapshot>>
  create(title: string, expectedRevision: number): Promise<RemoteResult<CanvasWireSnapshot>>
  select(canvasId: string, expectedRevision: number): Promise<RemoteResult<CanvasWireSnapshot>>
}

export interface CanvasProjectSnapshot {
  readonly revision: number
  readonly activeCanvasId: string
  readonly canvases: readonly CanvasWireSummary[]
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok && result.value !== undefined) return result.value
  throw new Error(result.error?.message ?? 'Canvas Remote request failed')
}

/** Client projection over the Host-owned Canvas service. */
export class CanvasRemoteSync {
  readonly workspace: CanvasWorkspace
  readonly #remote: CanvasRemoteApi
  readonly #listeners = new Set<() => void>()
  #revision = 0
  #snapshot: CanvasProjectSnapshot = Object.freeze({ revision: 0, activeCanvasId: '', canvases: Object.freeze([]) })
  #authoritativeJson = ''
  #pendingJson: string | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #poller: ReturnType<typeof setInterval> | undefined
  #unsubscribe: (() => void) | undefined
  #writing = false
  #disposed = false
  #error: Error | undefined

  constructor(remote: CanvasRemoteApi, workspace = new CanvasWorkspace({ initiallyOpen: true })) {
    this.#remote = remote
    this.workspace = workspace
  }

  get error(): Error | undefined {
    return this.#error
  }

  getSnapshot = (): CanvasProjectSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) throw new Error('CanvasRemoteSync has been disposed')
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  async start(): Promise<void> {
    this.#accept(unwrap(await this.#remote.read()))
    this.#unsubscribe = this.workspace.subscribe(() => { this.#queueLocalDocument() })
    this.#poller = setInterval(() => { void this.refresh() }, 1_000)
  }

  async refresh(): Promise<void> {
    if (this.#disposed || this.#writing || this.#pendingJson !== undefined) return
    try {
      const snapshot = unwrap(await this.#remote.read())
      if (snapshot.revision !== this.#revision) this.#accept(snapshot)
      this.#error = undefined
    } catch (error) {
      this.#error = error instanceof Error ? error : new Error(String(error))
    }
  }

  async flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer)
      this.#timer = undefined
    }
    await this.#writePending()
  }

  async createCanvas(title = ''): Promise<void> {
    await this.flush()
    await this.#runProjectOperation(() => this.#remote.create(title, this.#revision))
  }

  async selectCanvas(canvasId: string): Promise<void> {
    if (canvasId === this.#snapshot.activeCanvasId) return
    await this.flush()
    await this.#runProjectOperation(() => this.#remote.select(canvasId, this.#revision))
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    if (this.#poller !== undefined) clearInterval(this.#poller)
    this.#unsubscribe?.()
    await this.flush().catch(() => undefined)
    this.#disposed = true
    this.#listeners.clear()
    this.workspace.dispose()
  }

  #queueLocalDocument(): void {
    if (this.#disposed) return
    const documentJson = this.workspace.serialize()
    if (documentJson === this.#authoritativeJson) return
    this.#pendingJson = documentJson
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#writePending()
    }, 80)
  }

  async #writePending(): Promise<void> {
    if (this.#writing || this.#pendingJson === undefined || this.#disposed) return
    this.#writing = true
    const documentJson = this.#pendingJson
    this.#pendingJson = undefined
    try {
      this.#accept(unwrap(await this.#remote.replace(documentJson, this.#revision)))
      this.#error = undefined
    } catch (error) {
      this.#error = error instanceof Error ? error : new Error(String(error))
      try {
        this.#accept(unwrap(await this.#remote.read()))
      } catch {
        this.#pendingJson = documentJson
      }
    } finally {
      this.#writing = false
      if (this.#pendingJson !== undefined && !this.#disposed) await this.#writePending()
    }
  }

  async #runProjectOperation(request: () => Promise<RemoteResult<CanvasWireSnapshot>>): Promise<void> {
    if (this.#disposed) throw new Error('CanvasRemoteSync has been disposed')
    this.#writing = true
    try {
      this.#accept(unwrap(await request()))
      this.#error = undefined
    } catch (error) {
      this.#error = error instanceof Error ? error : new Error(String(error))
      throw this.#error
    } finally {
      this.#writing = false
    }
  }

  #accept(snapshot: CanvasWireSnapshot): void {
    const document = parseCanvasDocument(snapshot.documentJson)
    const documentJson = serializeCanvasDocument(document)
    this.#revision = snapshot.revision
    this.#authoritativeJson = documentJson
    if (this.workspace.serialize() !== documentJson) this.workspace.syncDocument(document)
    const next = Object.freeze({
      revision: snapshot.revision,
      activeCanvasId: snapshot.activeCanvasId,
      canvases: Object.freeze(snapshot.canvases.map(canvas => Object.freeze({ ...canvas }))),
    })
    const changed = JSON.stringify(this.#snapshot) !== JSON.stringify(next)
    this.#snapshot = next
    if (changed) for (const listener of this.#listeners) listener()
  }
}
