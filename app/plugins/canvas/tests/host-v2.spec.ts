import { Context } from '@deepseek-ai/cordis'
import {
  CANVAS_ERROR_CODES,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type CanvasProject,
} from '@convax/canvas-api'
import {
  CanvasStoreError,
  CanvasStoreRevisionConflict,
  type CanvasStore,
  type CommitCanvasProjectInput,
  type DeleteCanvasProjectInput,
  type StoredCanvasProject,
} from '@convax/canvas-store-api'
import { describe, expect, it, vi } from 'vitest'
import {
  CanvasHostService,
  createCanvasHostService,
  provideCanvasHostService,
} from '../src/host/canvas-host-service.ts'

const WORKSPACE = 'workspace-comic'
const META = { mutationId: 'mutation-test', source: 'host-v2-test' } as const

class MemoryCanvasStore implements CanvasStore {
  readonly rows = new Map<string, StoredCanvasProject>()
  failNextCommit = false
  activeCommits = 0
  maximumConcurrentCommits = 0
  readHook: ((projectId: string) => Promise<void>) | undefined

  async list(workspaceId: string): Promise<readonly StoredCanvasProject[]> {
    return [...this.rows.values()]
      .filter(row => row.workspaceId === workspaceId)
      .sort((left, right) => left.projectId.localeCompare(right.projectId))
      .map(clone)
  }

  async read(workspaceId: string, projectId: string): Promise<StoredCanvasProject | undefined> {
    const captured = this.rows.get(storeKey(workspaceId, projectId))
    const hook = this.readHook
    if (hook !== undefined) await hook(projectId)
    return captured === undefined ? undefined : clone(captured)
  }

  async initialize(workspaceId: string, projectId: string, projectJson: string): Promise<StoredCanvasProject> {
    const key = storeKey(workspaceId, projectId)
    const existing = this.rows.get(key)
    if (existing !== undefined) return clone(existing)
    const row = { workspaceId, projectId, revision: 0, projectJson }
    this.rows.set(key, row)
    return clone(row)
  }

  async commit(input: CommitCanvasProjectInput): Promise<StoredCanvasProject> {
    this.activeCommits += 1
    this.maximumConcurrentCommits = Math.max(this.maximumConcurrentCommits, this.activeCommits)
    try {
      await Promise.resolve()
      if (this.failNextCommit) {
        this.failNextCommit = false
        throw new CanvasStoreError('IO', 'injected persistence failure')
      }
      const key = storeKey(input.workspaceId, input.projectId)
      const current = this.rows.get(key)
      if (current === undefined) {
        throw new CanvasStoreError('NOT_FOUND', `missing ${input.workspaceId}/${input.projectId}`)
      }
      if (current.revision !== input.expectedRevision) {
        throw new CanvasStoreRevisionConflict(input.expectedRevision, current.revision)
      }
      const row = {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        revision: current.revision + 1,
        projectJson: input.projectJson,
      }
      this.rows.set(key, row)
      return clone(row)
    } finally {
      this.activeCommits -= 1
    }
  }

  async delete(input: DeleteCanvasProjectInput): Promise<boolean> {
    const key = storeKey(input.workspaceId, input.projectId)
    const current = this.rows.get(key)
    if (current === undefined) return false
    if (current.revision !== input.expectedRevision) {
      throw new CanvasStoreRevisionConflict(input.expectedRevision, current.revision)
    }
    return this.rows.delete(key)
  }
}

function storeKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}\u0000${projectId}`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function projectRequest(projectId: string, title = projectId) {
  return { workspaceId: WORKSPACE, projectId, canvasId: projectId, title, ...META }
}

function documentRequest(projectId: string, canvasId: string, title = canvasId, expectedProjectRevision = 0) {
  return { workspaceId: WORKSPACE, projectId, canvasId, title, expectedProjectRevision, ...META }
}

function node(id: string, label = id, type = 'comic.note'): CanvasNode {
  return {
    id,
    type,
    kindVersion: 1,
    position: { x: 0, y: 0 },
    zIndex: 0,
    style: { width: 240, height: 160 },
    data: { label },
  }
}

function edge(id: string, source: string, target: string, type = 'comic.flow'): CanvasEdge {
  return { id, type, kindVersion: 1, source, target, data: { label: id } }
}

function registerTypes(service: CanvasHostService): () => void {
  const disposeNode = service.registerNodeType({
    type: 'comic.note',
    kindVersion: 1,
    createData: () => ({ label: '' }),
    validateData: (value): value is { label: string } => typeof value === 'object'
      && value !== null
      && Object.keys(value).every(key => key === 'label')
      && typeof (value as { label?: unknown }).label === 'string',
  })
  const disposeEdge = service.registerEdgeType({
    type: 'comic.flow',
    kindVersion: 1,
    createData: () => ({ label: '' }),
    validateData: (value): value is { label: string } => typeof value === 'object'
      && value !== null
      && Object.keys(value).every(key => key === 'label')
      && typeof (value as { label?: unknown }).label === 'string',
  })
  return () => { disposeEdge(); disposeNode() }
}

async function addNode(
  service: CanvasHostService,
  projectId: string,
  canvasId: string,
  expectedRevision: number,
  value: CanvasNode,
) {
  return await service.nodes.create({
    workspaceId: WORKSPACE,
    projectId,
    canvasId,
    expectedRevision,
    node: value,
    ...META,
  })
}

describe('Canvas V2 Host authority', () => {
  it('lists projects in stable order, validates ownership, and deletes with project CAS', async () => {
    const store = new MemoryCanvasStore()
    const service = new CanvasHostService(store)
    await service.projects.create(projectRequest('project-z'))
    await service.projects.create(projectRequest('project-a'))
    await service.projects.create({ ...projectRequest('project-other'), workspaceId: 'workspace-other' })

    expect((await service.projects.list({ workspaceId: WORKSPACE })).map(item => item.projectId))
      .toEqual(['project-a', 'project-z'])
    expect((await service.projects.get({ workspaceId: WORKSPACE, projectId: 'project-a' })).activeCanvasId)
      .toBe('project-a')
    await expect(service.projects.get({ workspaceId: 'workspace-other', projectId: 'project-a' }))
      .rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' })
    await expect(service.projects.delete({
      workspaceId: WORKSPACE,
      projectId: 'project-a',
      expectedRevision: 1,
      ...META,
    })).rejects.toMatchObject({ code: CANVAS_ERROR_CODES.REVISION_CONFLICT })

    expect(await service.projects.delete({
      workspaceId: WORKSPACE,
      projectId: 'project-a',
      expectedRevision: 0,
      ...META,
    })).toEqual({ workspaceId: WORKSPACE, projectId: 'project-a', deleted: true })
    expect(await store.read(WORKSPACE, 'project-a')).toBeUndefined()
    await service.close()
  })

  it('isolates the same projectId across workspaces without parsing unrelated payloads', async () => {
    const store = new MemoryCanvasStore()
    const service = new CanvasHostService(store)
    const otherWorkspace = 'workspace-other'
    const projectId = 'project-shared'
    await service.projects.create(projectRequest(projectId, 'Workspace A'))
    await service.projects.create({
      ...projectRequest(projectId, 'Workspace B'),
      workspaceId: otherWorkspace,
      canvasId: 'canvas-other',
    })
    await store.initialize('workspace-poison', 'project-invalid', 'not-json')

    expect(await service.projects.list({ workspaceId: WORKSPACE })).toMatchObject([
      { workspaceId: WORKSPACE, projectId, title: 'Workspace A' },
    ])
    expect(await service.projects.list({ workspaceId: otherWorkspace })).toMatchObject([
      { workspaceId: otherWorkspace, projectId, title: 'Workspace B' },
    ])
    expect((await service.projects.get({ workspaceId: WORKSPACE, projectId })).metadata.title).toBe('Workspace A')
    expect((await service.projects.get({ workspaceId: otherWorkspace, projectId })).metadata.title).toBe('Workspace B')

    expect(await service.projects.delete({
      workspaceId: WORKSPACE,
      projectId,
      expectedRevision: 0,
      ...META,
    })).toMatchObject({ deleted: true, workspaceId: WORKSPACE })
    expect(await service.projects.get({ workspaceId: otherWorkspace, projectId })).toMatchObject({
      workspaceId: otherWorkspace,
      id: projectId,
    })
    await service.close()
  })

  it('creates, selects, renames and deletes documents while preventing an empty project', async () => {
    const service = new CanvasHostService(new MemoryCanvasStore())
    await service.projects.create(projectRequest('project-story', 'Story'))
    const second = await service.documents.create(documentRequest('project-story', 'canvas-two', 'Chapter 2'))
    expect(second).toMatchObject({ id: 'canvas-two', revision: 0 })

    const selected = await service.projects.setActiveCanvas({
      workspaceId: WORKSPACE,
      projectId: 'project-story',
      canvasId: 'canvas-two',
      expectedRevision: 1,
      ...META,
    })
    expect(selected).toMatchObject({ revision: 2, activeCanvasId: 'canvas-two' })

    const renamed = await service.documents.rename({
      workspaceId: WORKSPACE,
      projectId: 'project-story',
      canvasId: 'canvas-two',
      expectedRevision: 0,
      title: 'Renamed',
      ...META,
    })
    expect(renamed).toMatchObject({ revision: 1, metadata: { title: 'Renamed' } })
    expect((await service.projects.get({ workspaceId: WORKSPACE, projectId: 'project-story' })).revision).toBe(3)

    await service.documents.delete({
      workspaceId: WORKSPACE,
      projectId: 'project-story',
      canvasId: 'project-story',
      expectedRevision: 0,
      ...META,
    })
    await expect(service.documents.delete({
      workspaceId: WORKSPACE,
      projectId: 'project-story',
      canvasId: 'canvas-two',
      expectedRevision: 1,
      ...META,
    })).rejects.toMatchObject({ code: 'LAST_CANVAS' })
    expect((await service.documents.list({ workspaceId: WORKSPACE, projectId: 'project-story' })).map(item => item.canvasId))
      .toEqual(['canvas-two'])
    await service.close()
  })

  it('enforces Patch revisions and node/edge registries while preserving unknown existing types', async () => {
    const service = new CanvasHostService(new MemoryCanvasStore())
    const disposeTypes = registerTypes(service)
    await service.projects.create(projectRequest('project-types'))
    await addNode(service, 'project-types', 'project-types', 0, node('node-a'))
    await addNode(service, 'project-types', 'project-types', 1, node('node-b'))
    await service.edges.create({
      workspaceId: WORKSPACE,
      projectId: 'project-types',
      canvasId: 'project-types',
      expectedRevision: 2,
      edge: edge('edge-a-b', 'node-a', 'node-b'),
      ...META,
    })

    const updated = await service.documents.applyPatch({
      workspaceId: WORKSPACE,
      projectId: 'project-types',
      canvasId: 'project-types',
      expectedRevision: 3,
      operations: [{ op: 'replace', path: '/nodes/node-a/data/label', value: 'changed' }],
      ...META,
    })
    expect(updated).toMatchObject({ revision: 4, applied: 1 })
    await expect(service.documents.applyPatch({
      workspaceId: WORKSPACE,
      projectId: 'project-types',
      canvasId: 'project-types',
      expectedRevision: 3,
      operations: [{ op: 'replace', path: '/viewport/x', value: 9 }],
      ...META,
    })).rejects.toMatchObject({ code: CANVAS_ERROR_CODES.REVISION_CONFLICT })
    await expect(service.documents.applyPatch({
      workspaceId: WORKSPACE,
      projectId: 'project-types',
      canvasId: 'project-types',
      expectedRevision: 4,
      operations: [{ op: 'add', path: '/nodes/unknown', value: node('unknown', 'x', 'plugin.missing') }],
      ...META,
    })).rejects.toMatchObject({ code: CANVAS_ERROR_CODES.NODE_TYPE_NOT_REGISTERED })

    disposeTypes()
    const movedUnknown = await service.documents.applyPatch({
      workspaceId: WORKSPACE,
      projectId: 'project-types',
      canvasId: 'project-types',
      expectedRevision: 4,
      operations: [{ op: 'replace', path: '/nodes/node-a/position/x', value: 42 }],
      ...META,
    })
    expect(movedUnknown.document.nodes['node-a']?.position.x).toBe(42)
    await expect(service.documents.applyPatch({
      workspaceId: WORKSPACE,
      projectId: 'project-types',
      canvasId: 'project-types',
      expectedRevision: 5,
      operations: [{ op: 'replace', path: '/nodes/node-a/data/label', value: 'forbidden' }],
      ...META,
    })).rejects.toMatchObject({ code: CANVAS_ERROR_CODES.NODE_TYPE_NOT_REGISTERED })

    const removed = await service.nodes.remove({
      workspaceId: WORKSPACE,
      projectId: 'project-types',
      canvasId: 'project-types',
      expectedRevision: 5,
      nodeId: 'node-a',
      ...META,
    })
    expect(removed.document.nodes['node-a']).toBeUndefined()
    expect(removed.document.edges['edge-a-b']).toBeUndefined()
    await service.close()
  })

  it('serializes all mutations and applies exact document revisions under concurrency', async () => {
    const store = new MemoryCanvasStore()
    const service = new CanvasHostService(store)
    await service.projects.create(projectRequest('project-one'))
    await service.projects.create(projectRequest('project-two'))

    await Promise.all([
      service.documents.rename({
        workspaceId: WORKSPACE,
        projectId: 'project-one',
        canvasId: 'project-one',
        expectedRevision: 0,
        title: 'One',
        ...META,
      }),
      service.documents.rename({
        workspaceId: WORKSPACE,
        projectId: 'project-two',
        canvasId: 'project-two',
        expectedRevision: 0,
        title: 'Two',
        ...META,
      }),
    ])
    expect(store.maximumConcurrentCommits).toBe(1)

    const competing = await Promise.allSettled([
      service.documents.rename({
        workspaceId: WORKSPACE,
        projectId: 'project-one',
        canvasId: 'project-one',
        expectedRevision: 1,
        title: 'Winner A',
        ...META,
      }),
      service.documents.rename({
        workspaceId: WORKSPACE,
        projectId: 'project-one',
        canvasId: 'project-one',
        expectedRevision: 1,
        title: 'Winner B',
        ...META,
      }),
    ])
    expect(competing.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(competing.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await service.documents.get({ workspaceId: WORKSPACE, projectId: 'project-one', canvasId: 'project-one' })).revision).toBe(2)
    await service.close()
  })

  it('creates-and-activates once and rejects stale active-canvas mutations atomically', async () => {
    const service = new CanvasHostService(new MemoryCanvasStore())
    registerTypes(service)
    await service.projects.create(projectRequest('project-active-cas'))
    const created = await service.documents.createAndActivate({
      workspaceId: WORKSPACE,
      projectId: 'project-active-cas',
      canvasId: 'canvas-second',
      title: 'Second',
      expectedProjectRevision: 0,
      ...META,
    })
    expect(created.revision).toBe(0)
    expect(await service.projects.get({ workspaceId: WORKSPACE, projectId: 'project-active-cas' }))
      .toMatchObject({ revision: 1, activeCanvasId: 'canvas-second' })

    await service.projects.setActiveCanvas({
      workspaceId: WORKSPACE,
      projectId: 'project-active-cas',
      canvasId: 'project-active-cas',
      expectedRevision: 1,
      ...META,
    })
    await expect(service.documents.applyActivePatch({
      workspaceId: WORKSPACE,
      projectId: 'project-active-cas',
      expectedProjectRevision: 1,
      expectedActiveCanvasId: 'canvas-second',
      expectedRevision: 0,
      operations: [{ op: 'add', path: '/nodes/stale-node', value: node('stale-node') }],
      ...META,
    })).rejects.toMatchObject({ code: CANVAS_ERROR_CODES.REVISION_CONFLICT })
    expect((await service.documents.get({
      workspaceId: WORKSPACE,
      projectId: 'project-active-cas',
      canvasId: 'canvas-second',
    })).nodes['stale-node']).toBeUndefined()
    await service.close()
  })

  it('does not publish or advance in-memory authority when persistence fails', async () => {
    const store = new MemoryCanvasStore()
    const service = new CanvasHostService(store)
    await service.projects.create(projectRequest('project-failure'))
    const listener = vi.fn()
    service.onCommitted(listener)
    store.failNextCommit = true

    await expect(service.documents.rename({
      workspaceId: WORKSPACE,
      projectId: 'project-failure',
      canvasId: 'project-failure',
      expectedRevision: 0,
      title: 'Not persisted',
      ...META,
    })).rejects.toMatchObject({ code: 'IO' })
    expect(listener).not.toHaveBeenCalled()
    const stored = await service.projects.get({ workspaceId: WORKSPACE, projectId: 'project-failure' })
    expect(stored).toMatchObject({ revision: 0, metadata: { title: 'project-failure' } })
    expect(stored.canvases['project-failure']).toMatchObject({ revision: 0, metadata: { title: 'project-failure' } })
    await service.close()
  })

  it('isolates post-commit listener failures from authority results and later listeners', async () => {
    const listenerErrors = vi.fn()
    const service = new CanvasHostService(
      new MemoryCanvasStore(),
      undefined,
      undefined,
      { onListenerError: listenerErrors },
    )
    await service.projects.create(projectRequest('project-listeners'))
    registerTypes(service)
    const later = vi.fn()
    service.onCommitted(() => { throw new Error('listener failed') })
    service.onCommitted(later)

    const result = await addNode(service, 'project-listeners', 'project-listeners', 0, node('node-listener'))
    expect(result.revision).toBe(1)
    expect(listenerErrors).toHaveBeenCalledTimes(1)
    expect(later).toHaveBeenCalledTimes(1)
    expect((await service.documents.get({
      workspaceId: WORKSPACE,
      projectId: 'project-listeners',
      canvasId: 'project-listeners',
    })).nodes['node-listener']).toBeDefined()
    await service.close()
  })

  it('restores store and document revisions across service restart', async () => {
    const store = new MemoryCanvasStore()
    const first = new CanvasHostService(store)
    await first.projects.create(projectRequest('project-restart'))
    await first.documents.rename({
      workspaceId: WORKSPACE,
      projectId: 'project-restart',
      canvasId: 'project-restart',
      expectedRevision: 0,
      title: 'Persisted',
      ...META,
    })
    await first.close()

    const restarted = new CanvasHostService(store)
    const project = await restarted.projects.get({ workspaceId: WORKSPACE, projectId: 'project-restart' })
    expect(project.revision).toBe(1)
    expect(project.canvases['project-restart']).toMatchObject({ revision: 1, metadata: { title: 'Persisted' } })
    expect((await store.read(WORKSPACE, 'project-restart'))?.revision).toBe(project.revision)
    await restarted.close()
  })

  it('waits for changed, timeout and deleted outcomes only after persistence', async () => {
    const service = new CanvasHostService(new MemoryCanvasStore())
    await service.projects.create(projectRequest('project-wait'))
    const signal = new AbortController().signal
    const changed = service.documents.waitForRevision({
      workspaceId: WORKSPACE,
      projectId: 'project-wait',
      canvasId: 'project-wait',
      afterRevision: 0,
      timeoutMs: 1_000,
    }, signal)
    await service.documents.rename({
      workspaceId: WORKSPACE,
      projectId: 'project-wait',
      canvasId: 'project-wait',
      expectedRevision: 0,
      title: 'Changed',
      ...META,
    })
    await expect(changed).resolves.toMatchObject({ status: 'changed', document: { revision: 1 } })

    await expect(service.documents.waitForRevision({
      workspaceId: WORKSPACE,
      projectId: 'project-wait',
      canvasId: 'project-wait',
      afterRevision: 1,
      timeoutMs: 0,
    }, signal)).resolves.toEqual({ status: 'timeout', revision: 1 })

    const project = await service.projects.get({ workspaceId: WORKSPACE, projectId: 'project-wait' })
    await service.documents.create(documentRequest('project-wait', 'canvas-delete', 'Delete me', project.revision))
    const deleted = service.documents.waitForRevision({
      workspaceId: WORKSPACE,
      projectId: 'project-wait',
      canvasId: 'canvas-delete',
      afterRevision: 0,
      timeoutMs: 1_000,
    }, signal)
    await service.documents.delete({
      workspaceId: WORKSPACE,
      projectId: 'project-wait',
      canvasId: 'canvas-delete',
      expectedRevision: 0,
      ...META,
    })
    await expect(deleted).resolves.toEqual({ status: 'deleted' })
    await service.close()
  })

  it('bounds timeout and abort even while the CanvasStore read is hung', async () => {
    const store = new MemoryCanvasStore()
    const service = new CanvasHostService(store)
    await service.projects.create(projectRequest('project-slow-read'))
    store.readHook = async () => await new Promise<void>(() => {})

    await expect(service.documents.waitForRevision({
      workspaceId: WORKSPACE,
      projectId: 'project-slow-read',
      canvasId: 'project-slow-read',
      afterRevision: 0,
      timeoutMs: 5,
    }, new AbortController().signal)).resolves.toEqual({ status: 'timeout', revision: 0 })

    const controller = new AbortController()
    const aborted = service.documents.waitForRevision({
      workspaceId: WORKSPACE,
      projectId: 'project-slow-read',
      canvasId: 'project-slow-read',
      afterRevision: 0,
      timeoutMs: 30_000,
    }, controller.signal)
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    await service.close()
  })

  it('cancels waiters on caller abort and close, and closes the subscribe-before-read race', async () => {
    const store = new MemoryCanvasStore()
    const service = new CanvasHostService(store)
    await service.projects.create(projectRequest('project-race'))

    const caller = new AbortController()
    const aborted = service.documents.waitForRevision({
      workspaceId: WORKSPACE,
      projectId: 'project-race',
      canvasId: 'project-race',
      afterRevision: 0,
      timeoutMs: 1_000,
    }, caller.signal)
    caller.abort(new DOMException('caller stopped', 'AbortError'))
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })

    const raceSignal = new AbortController().signal
    let injected = false
    store.readHook = async (projectId) => {
      if (projectId !== 'project-race' || injected) return
      injected = true
      store.readHook = undefined
      await service.documents.rename({
        workspaceId: WORKSPACE,
        projectId: 'project-race',
        canvasId: 'project-race',
        expectedRevision: 0,
        title: 'Won race',
        ...META,
      })
    }
    await expect(service.documents.waitForRevision({
      workspaceId: WORKSPACE,
      projectId: 'project-race',
      canvasId: 'project-race',
      afterRevision: 0,
      timeoutMs: 1_000,
    }, raceSignal)).resolves.toMatchObject({ status: 'changed', document: { revision: 1 } })

    const closing = service.documents.waitForRevision({
      workspaceId: WORKSPACE,
      projectId: 'project-race',
      canvasId: 'project-race',
      afterRevision: 1,
      timeoutMs: 1_000,
    }, raceSignal)
    await service.close()
    await expect(closing).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('provides the new authority through an owned Cordis lifecycle without wiring the package index', async () => {
    const ctx = new Context()
    const service = createCanvasHostService(ctx, new MemoryCanvasStore())
    const events = vi.fn()
    ctx.on('canvas/committed', events)
    await ctx.plugin((pluginContext) => provideCanvasHostService(pluginContext, service))
    expect(ctx.get('canvasHost')).toBe(service)
    await service.projects.create(projectRequest('project-context'))
    expect(events).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
    await expect(service.projects.list({ workspaceId: WORKSPACE })).rejects.toMatchObject({ code: 'CLOSED' })
  })
})
