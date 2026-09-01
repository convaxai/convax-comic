import {
  CANVAS_SCHEMA_VERSION,
  applyCanvasPatch,
  type ApplyCanvasPatchRequest,
  type CanvasDocument,
  type CanvasProject,
  type SetActiveCanvasRequest,
} from '@convax/canvas-api'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import { CanvasRendererRegistry } from '../src/client/renderer-registry.ts'
import {
  CanvasProjectSync,
  CanvasRemoteV2Error,
  type CanvasRemoteV2Api,
  unwrapCanvasRemoteV2Result,
} from '../src/client/project-sync-v2.ts'

const timestamp = '2026-08-26T00:00:00.000Z'

function documentFixture(id: string, title: string, withNode = false): CanvasDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    revision: 1,
    id,
    workspaceId: 'workspace-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: { title },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: withNode ? {
      'node-1': {
        id: 'node-1',
        type: 'comic.note',
        kindVersion: 1,
        position: { x: 0, y: 0 },
        zIndex: 0,
        style: { width: 240, height: 120 },
        data: { title: 'Note', text: 'Before' },
      },
    } : {},
    edges: {},
  }
}

function projectFixture(): CanvasProject {
  const first = documentFixture('canvas-a', 'First', true)
  const second = documentFixture('canvas-b', 'Second')
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    revision: 4,
    id: 'project-1',
    workspaceId: 'workspace-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: { title: 'Comic' },
    activeCanvasId: first.id,
    canvases: { [first.id]: first, [second.id]: second },
  }
}

interface PendingWaiter {
  readonly canvasId: string
  readonly signal: AbortSignal | undefined
  readonly abort: () => void
  readonly reject: (error: unknown) => void
}

class FakeWrappedRemote {
  project = projectFixture()
  failNextSetActive = false
  readonly waiters = new Set<PendingWaiter>()

  readonly getProject = vi.fn(async (): Promise<RemoteResult<CanvasProject>> => this.ok(this.project))

  readonly getDocument = vi.fn(async (request: { canvasId: string }): Promise<RemoteResult<CanvasDocument>> => {
    const document = this.project.canvases[request.canvasId]
    if (document === undefined) return this.failure('CANVAS_NOT_FOUND', 'missing canvas')
    return this.ok(document)
  })

  readonly applyPatch = vi.fn(async (request: ApplyCanvasPatchRequest) => {
    const current = this.project.canvases[request.canvasId]
    if (current === undefined) return this.failure('CANVAS_NOT_FOUND', 'missing canvas')
    if (request.expectedRevision !== current.revision) return this.failure('REVISION_CONFLICT', 'stale document')
    const patched = applyCanvasPatch({ document: current, operations: request.operations })
    const document = { ...patched.document, revision: current.revision + 1, updatedAt: timestamp }
    this.project = {
      ...this.project,
      revision: this.project.revision + 1,
      canvases: { ...this.project.canvases, [document.id]: document },
    }
    return this.ok({ document: structuredClone(document), revision: document.revision, applied: request.operations.length })
  })

  readonly waitForRevision = vi.fn((
    request: { canvasId: string },
    signal?: AbortSignal,
  ): Promise<RemoteResult<{ status: 'timeout'; revision: number }>> => {
    signal?.throwIfAborted()
    return new Promise((_resolve, reject) => {
      let waiter!: PendingWaiter
      const abort = (): void => {
        signal?.removeEventListener('abort', abort)
        this.waiters.delete(waiter)
        reject(signal?.reason)
      }
      waiter = { canvasId: request.canvasId, signal, abort, reject }
      this.waiters.add(waiter)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  })

  readonly createDocument = vi.fn(async (request: {
    canvasId: string
    title: string
    expectedProjectRevision: number
  }): Promise<RemoteResult<CanvasDocument>> => {
    if (request.expectedProjectRevision !== this.project.revision) {
      return this.failure('REVISION_CONFLICT', 'stale project')
    }
    const document = { ...documentFixture(request.canvasId, request.title), revision: 0 }
    this.project = {
      ...this.project,
      revision: this.project.revision + 1,
      activeCanvasId: document.id,
      canvases: { ...this.project.canvases, [document.id]: document },
    }
    return this.ok(document)
  })

  readonly setActiveCanvas = vi.fn(async (request: SetActiveCanvasRequest): Promise<RemoteResult<CanvasProject>> => {
    if (this.failNextSetActive) {
      this.failNextSetActive = false
      return this.failure('REVISION_CONFLICT', 'stale project')
    }
    if (request.expectedRevision !== this.project.revision) {
      return this.failure('REVISION_CONFLICT', 'stale project')
    }
    if (this.project.canvases[request.canvasId] === undefined) {
      return this.failure('CANVAS_NOT_FOUND', 'missing canvas')
    }
    this.project = {
      ...this.project,
      revision: this.project.revision + 1,
      activeCanvasId: request.canvasId,
    }
    return this.ok(this.project)
  })

  api(): CanvasRemoteV2Api {
    const unsupported = vi.fn(async () => this.failure('UNSUPPORTED', 'not used'))
    return {
      listProjects: unsupported,
      createProject: unsupported,
      getProject: this.getProject,
      setActiveCanvas: this.setActiveCanvas,
      deleteProject: unsupported,
      listDocuments: unsupported,
      createDocument: this.createDocument,
      getDocument: this.getDocument,
      renameDocument: unsupported,
      deleteDocument: unsupported,
      applyPatch: this.applyPatch,
      waitForRevision: this.waitForRevision,
    } as unknown as CanvasRemoteV2Api
  }

  private ok<T>(value: T): RemoteResult<T> {
    return { ok: true, value: structuredClone(value) }
  }

  private failure<T>(code: string, message: string): RemoteResult<T> {
    return { ok: false, error: { code, message, details: {} } }
  }
}

function sync(remote: FakeWrappedRemote, registry = new CanvasRendererRegistry()): CanvasProjectSync {
  return new CanvasProjectSync(remote.api(), {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    clientId: 'sync-1',
    revisionWaitMs: 50,
    renderers: registry,
    createCanvasId: () => 'canvas-created',
    workspace: { initiallyOpen: true },
  })
}

describe('CanvasProjectSync V2', () => {
  it('strictly unwraps Typert results and rejects malformed envelopes', () => {
    expect(unwrapCanvasRemoteV2Result({ ok: true, value: 3 })).toBe(3)
    expect(() => unwrapCanvasRemoteV2Result({
      ok: false,
      error: { code: 'REVISION_CONFLICT', message: 'stale', details: {} },
    })).toThrow(CanvasRemoteV2Error)
    expect(() => unwrapCanvasRemoteV2Result({ ok: true, value: 3, extra: true } as never)).toThrow(TypeError)
    expect(() => unwrapCanvasRemoteV2Result({
      ok: false,
      error: { code: 'bad', message: 'bad', details: JSON.parse('{"__proto__":true}') },
    })).toThrow(TypeError)
  })

  it('starts one active waiter and exposes stable project, workspace, registry, and client surfaces', async () => {
    const remote = new FakeWrappedRemote()
    const registry = new CanvasRendererRegistry()
    const coordinator = sync(remote, registry)
    await coordinator.start()

    expect(coordinator.getSnapshot()).toEqual({
      revision: 4,
      activeCanvasId: 'canvas-a',
      canvases: [
        { id: 'canvas-a', title: 'First', nodeCount: 1, edgeCount: 0 },
        { id: 'canvas-b', title: 'Second', nodeCount: 0, edgeCount: 0 },
      ],
    })
    expect(remote.getProject).toHaveBeenCalledTimes(1)
    expect(remote.getDocument).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', projectId: 'project-1', canvasId: 'canvas-a',
    })
    expect(remote.waiters.size).toBe(1)
    expect([...remote.waiters][0]?.canvasId).toBe('canvas-a')

    const workspace = coordinator.workspace
    const client = coordinator.canvasClient
    expect(coordinator.client).toBe(client)
    expect(client.renderers).toBe(registry)
    expect(client.canvasId).toBe('canvas-a')
    await coordinator.start()
    expect(coordinator.workspace).toBe(workspace)
    expect(coordinator.canvasClient).toBe(client)
    expect(coordinator.renderers).toBe(registry)
    expect(remote.waitForRevision).toHaveBeenCalledTimes(1)
    await coordinator.dispose()
  })

  it('cannot publish a stale service when disposal races project startup', async () => {
    const remote = new FakeWrappedRemote()
    const original = remote.api()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const getProject = vi.fn(async () => {
      await gate
      return { ok: true as const, value: structuredClone(remote.project) }
    })
    const coordinator = new CanvasProjectSync(
      { ...original, getProject } as unknown as CanvasRemoteV2Api,
      { workspaceId: 'workspace-1', projectId: 'project-1' },
    )

    const start = coordinator.start()
    await vi.waitFor(() => expect(getProject).toHaveBeenCalledOnce())
    const disposal = coordinator.dispose()
    release()
    await expect(start).rejects.toThrow('Canvas project sync is disposed')
    await disposal
    expect(() => coordinator.workspace).toThrow('not started')
    expect(remote.waiters.size).toBe(0)
  })

  it('initializes a missing workspace-bound project when requested', async () => {
    const remote = new FakeWrappedRemote()
    const getProject = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'REMOTE_ERROR', message: 'Canvas project not found: project-1', details: {} },
    }))
    const createProject = vi.fn(async (request: { workspaceId: string; projectId: string }) => ({
      ok: true as const,
      value: structuredClone({
        ...remote.project,
        workspaceId: request.workspaceId,
        id: request.projectId,
      }),
    }))
    const api = { ...remote.api(), getProject, createProject } as unknown as CanvasRemoteV2Api
    const coordinator = new CanvasProjectSync(api, {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      clientId: 'sync-initialize',
      revisionWaitMs: 50,
      ensureProject: { canvasId: 'canvas-a', title: 'Initialized' },
    })

    await coordinator.start()
    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      canvasId: 'canvas-a',
      title: 'Initialized',
    }))
    await coordinator.dispose()
  })

  it('rejects a lazy-create response outside the requested project scope', async () => {
    const remote = new FakeWrappedRemote()
    const api = {
      ...remote.api(),
      getProject: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'PROJECT_NOT_FOUND', message: 'missing project', details: {} },
      })),
      createProject: vi.fn(async () => ({
        ok: true as const,
        value: structuredClone({ ...remote.project, id: 'project:other' }),
      })),
    } as unknown as CanvasRemoteV2Api
    const coordinator = new CanvasProjectSync(api, {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      ensureProject: { canvasId: 'canvas-a' },
    })

    await expect(coordinator.start()).rejects.toThrow('returned a different project')
    await coordinator.dispose()
  })

  it('forwards optimistic writes and rebinds stable facades across create/select switches', async () => {
    const remote = new FakeWrappedRemote()
    const coordinator = sync(remote)
    await coordinator.start()
    const workspace = coordinator.workspace
    const registry = coordinator.renderers
    const client = coordinator.canvasClient
    const old = coordinator.activeService
    const documents: string[] = []
    client.subscribe(document => { documents.push(document.id) })

    const write = coordinator.actions.applyPatch({
      operations: [{ op: 'replace', path: '/nodes/node-1/data/text', value: 'Optimistic' }],
    })
    expect(client.getSnapshot().nodes['node-1']?.data.text).toBe('Optimistic')
    await write
    expect(client.getSnapshot().revision).toBe(2)

    await expect(coordinator.createCanvas('Created')).resolves.toBe('canvas-created')
    expect(remote.createDocument).toHaveBeenCalledWith(expect.objectContaining({
      canvasId: 'canvas-created',
      expectedProjectRevision: 5,
    }))
    expect(remote.setActiveCanvas).not.toHaveBeenCalled()
    expect(coordinator.workspace).toBe(workspace)
    expect(coordinator.renderers).toBe(registry)
    expect(coordinator.canvasClient).toBe(client)
    expect(client.canvasId).toBe('canvas-created')
    expect(old.state.status).toBe('closed')
    expect(remote.waiters.size).toBe(1)
    expect([...remote.waiters][0]?.canvasId).toBe('canvas-created')
    expect(documents).toContain('canvas-created')

    const createdService = coordinator.activeService
    await coordinator.selectCanvas('canvas-b')
    expect(client.canvasId).toBe('canvas-b')
    expect(createdService.state.status).toBe('closed')
    expect(remote.waiters.size).toBe(1)
    expect([...remote.waiters][0]?.canvasId).toBe('canvas-b')
    expect(coordinator.getSnapshot().activeCanvasId).toBe('canvas-b')
    await coordinator.dispose()
  })

  it('preserves the old service on stale project failure and retains an externally owned registry', async () => {
    const remote = new FakeWrappedRemote()
    const registry = new CanvasRendererRegistry()
    const disposeRegistry = vi.spyOn(registry, 'dispose')
    const coordinator = sync(remote, registry)
    await coordinator.start()
    const old = coordinator.activeService
    const workspace = coordinator.workspace
    const disposeWorkspace = vi.spyOn(workspace, 'dispose')
    const disposeService = vi.spyOn(old, 'dispose')

    remote.failNextSetActive = true
    await expect(coordinator.selectCanvas('canvas-b')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(coordinator.activeService).toBe(old)
    expect(coordinator.workspace).toBe(workspace)
    expect(coordinator.canvasClient.canvasId).toBe('canvas-a')
    expect(coordinator.getSnapshot().activeCanvasId).toBe('canvas-a')
    expect(remote.waiters.size).toBe(1)

    await coordinator.dispose()
    await coordinator.dispose()
    expect(remote.waiters.size).toBe(0)
    expect(disposeService).toHaveBeenCalledTimes(1)
    expect(disposeWorkspace).toHaveBeenCalledTimes(1)
    expect(disposeRegistry).not.toHaveBeenCalled()
    registry.dispose()
  })
})
