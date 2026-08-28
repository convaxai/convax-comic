import {
  CANVAS_SCHEMA_VERSION,
  applyCanvasPatch,
  type ApplyCanvasPatchRequest,
  type ApplyCanvasPatchResult,
  type CanvasCommittedEvent,
  type CanvasDocument,
  type CanvasPatchOperation,
  type GetCanvasDocumentRequest,
  type WaitForCanvasRevisionRequest,
  type WaitForCanvasRevisionResult,
} from '@convax/canvas-api'
import { describe, expect, it, vi } from 'vitest'
import {
  CanvasClientService,
  type CanvasRemotePort,
} from '../src/client/canvas-client-service.ts'
import { CanvasRendererRegistry } from '../src/client/renderer-registry.ts'

function fixture(): CanvasDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    revision: 1,
    id: 'canvas-1',
    workspaceId: 'workspace-1',
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    metadata: { title: 'Comic' },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: {
      'node-1': {
        id: 'node-1',
        type: 'comic.note',
        kindVersion: 1,
        position: { x: 0, y: 0 },
        zIndex: 0,
        style: { width: 240, height: 120 },
        data: { label: 'before', prompt: 'keep' },
      },
    },
    edges: {
      'edge-1': {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-1',
        type: 'comic.flow',
        kindVersion: 1,
        data: { label: 'loop' },
      },
    },
  }
}

interface PendingWaiter {
  readonly signal: AbortSignal | undefined
  readonly resolve: (result: WaitForCanvasRevisionResult) => void
  readonly reject: (error: unknown) => void
  readonly abort: () => void
}

class FakeRemote implements CanvasRemotePort {
  document = fixture()
  failNextWrite: Error | undefined
  writeGate: Promise<void> | undefined
  readonly waiters = new Set<PendingWaiter>()

  readonly getDocument = vi.fn(async (_request: GetCanvasDocumentRequest): Promise<CanvasDocument> => {
    return structuredClone(this.document)
  })

  readonly applyPatch = vi.fn(async (request: ApplyCanvasPatchRequest): Promise<ApplyCanvasPatchResult> => {
    await this.writeGate
    if (this.failNextWrite !== undefined) {
      const error = this.failNextWrite
      this.failNextWrite = undefined
      throw error
    }
    if (request.expectedRevision !== this.document.revision) throw new Error('revision conflict')
    const patched = applyCanvasPatch({ document: this.document, operations: request.operations })
    this.document = {
      ...patched.document,
      revision: this.document.revision + 1,
      updatedAt: '2026-08-26T00:00:01.000Z',
    }
    return {
      document: structuredClone(this.document),
      revision: this.document.revision,
      applied: request.operations.length,
    }
  })

  readonly waitForRevision = vi.fn((
    _request: WaitForCanvasRevisionRequest,
    signal?: AbortSignal,
  ): Promise<WaitForCanvasRevisionResult> => {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      let waiter!: PendingWaiter
      const abort = (): void => {
        this.waiters.delete(waiter)
        reject(signal?.reason)
      }
      waiter = { signal, resolve, reject, abort }
      this.waiters.add(waiter)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  })

  resolveWait(result: WaitForCanvasRevisionResult): void {
    const waiter = this.waiters.values().next().value
    if (waiter === undefined) throw new Error('No active revision waiter')
    waiter.signal?.removeEventListener('abort', waiter.abort)
    this.waiters.delete(waiter)
    waiter.resolve(result)
  }
}

function client(remote: FakeRemote, options: Partial<ConstructorParameters<typeof CanvasClientService>[1]> = {}): CanvasClientService {
  return new CanvasClientService(remote, {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    canvasId: 'canvas-1',
    clientId: 'client-1',
    revisionWaitMs: 50,
    ...options,
  })
}

describe('CanvasClientService V2', () => {
  it('shares one in-flight start and creates exactly one revision waiter', async () => {
    const remote = new FakeRemote()
    const service = client(remote)
    const [left, right] = await Promise.all([service.start(), service.start()])
    expect(left).toEqual(right)
    expect(remote.getDocument).toHaveBeenCalledTimes(1)
    expect(remote.waitForRevision).toHaveBeenCalledTimes(1)
    await service.dispose()
  })

  it('does not dispose an externally owned renderer registry', async () => {
    const remote = new FakeRemote()
    const renderers = new CanvasRendererRegistry()
    const service = client(remote, { renderers })
    await service.start()
    await service.dispose()
    const dispose = renderers.registerNode({ type: 'external.note', kindVersion: 1, renderer: () => null })
    expect(renderers.hasNode('external.note', 1)).toBe(true)
    dispose()
    renderers.dispose()
  })

  it('publishes concurrent optimistic leaves while serializing authoritative writes', async () => {
    const remote = new FakeRemote()
    let release!: () => void
    remote.writeGate = new Promise<void>(resolve => { release = resolve })
    const service = client(remote)
    await service.start()

    const first = service.applyOperations([
      { op: 'replace', path: '/nodes/node-1/data/label', value: 'after' },
    ])
    const second = service.applyOperations([
      { op: 'replace', path: '/nodes/node-1/style/width', value: 360 },
    ])

    expect(service.getSnapshot()).toMatchObject({
      revision: 1,
      nodes: { 'node-1': { data: { label: 'after', prompt: 'keep' }, style: { width: 360 } } },
    })
    await vi.waitFor(() => expect(remote.applyPatch).toHaveBeenCalledTimes(1))
    release()
    await Promise.all([first, second])

    expect(remote.applyPatch).toHaveBeenCalledTimes(2)
    expect(remote.applyPatch.mock.calls.map(([request]) => request.expectedRevision)).toEqual([1, 2])
    expect(service.getSnapshot()).toMatchObject({ revision: 3 })
    expect(service.state.dirty).toBe(false)
    await service.dispose()
  })

  it('refreshes authoritative state after a failed optimistic write without a false revision', async () => {
    const remote = new FakeRemote()
    remote.failNextWrite = new Error('write failed')
    const service = client(remote)
    await service.start()

    await expect(service.applyOperations([
      { op: 'replace', path: '/nodes/node-1/data/label', value: 'not-durable' },
    ])).rejects.toThrow('write failed')

    expect(service.getSnapshot()).toMatchObject({
      revision: 1,
      nodes: { 'node-1': { data: { label: 'before' } } },
    })
    expect(remote.getDocument).toHaveBeenCalledTimes(2)
    expect(service.state).toMatchObject({ status: 'error', dirty: false })
    await service.dispose()
  })

  it('keeps undo, redo, and node/edge selection session-only', async () => {
    const remote = new FakeRemote()
    const service = client(remote)
    await service.start()
    const beforeSelection = service.getSnapshot()

    service.actions.selectNodes(['node-1'])
    service.actions.selectEdges(['edge-1'])
    expect(service.getSnapshot()).toBe(beforeSelection)
    expect(service.state).toMatchObject({
      selectedNodeIds: ['node-1'],
      selectedEdgeIds: ['edge-1'],
    })
    expect(remote.applyPatch).not.toHaveBeenCalled()

    await service.applyOperations([
      { op: 'replace', path: '/nodes/node-1/data/label', value: 'edited' },
    ])
    await service.undo()
    expect(service.getSnapshot().nodes['node-1']?.data.label).toBe('before')
    expect(service.history.canRedo).toBe(true)
    await service.redo()
    expect(service.getSnapshot().nodes['node-1']?.data.label).toBe('edited')
    await service.dispose()
  })

  it('runs one waiter across timeouts and aborts it on idempotent disposal', async () => {
    const remote = new FakeRemote()
    const service = client(remote)
    await service.start()
    await vi.waitFor(() => expect(remote.waiters.size).toBe(1))
    expect(remote.waitForRevision).toHaveBeenCalledTimes(1)

    remote.resolveWait({ status: 'timeout', revision: 1 })
    await vi.waitFor(() => expect(remote.waitForRevision).toHaveBeenCalledTimes(2))
    expect(remote.waiters.size).toBe(1)
    remote.resolveWait({ status: 'timeout', revision: 1 })
    await vi.waitFor(() => expect(remote.waitForRevision).toHaveBeenCalledTimes(3))
    expect(remote.waiters.size).toBe(1)

    await service.dispose()
    await service.dispose()
    expect(remote.waiters.size).toBe(0)
  })

  it('accepts changed waiter snapshots and refreshes committed-event gaps', async () => {
    const remote = new FakeRemote()
    const service = client(remote)
    await service.start()

    remote.document = external(remote.document, [
      { op: 'replace', path: '/nodes/node-1/data/prompt', value: 'waited' },
    ])
    remote.resolveWait({ status: 'changed', document: structuredClone(remote.document) })
    await vi.waitFor(() => expect(service.getSnapshot().revision).toBe(2))
    expect(service.getSnapshot().nodes['node-1']?.data.prompt).toBe('waited')

    remote.document = external(remote.document, [
      { op: 'replace', path: '/nodes/node-1/data/prompt', value: 'gap-refresh' },
    ], 2)
    const gap: CanvasCommittedEvent = {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      canvasId: 'canvas-1',
      revision: 4,
      mutationId: 'external-gap',
      source: 'test',
      originClientId: 'client-2',
      operations: [],
    }
    expect(service.handleCommittedEvent(gap)).toBe('refresh-required')
    await vi.waitFor(() => expect(service.getSnapshot().revision).toBe(4))
    expect(service.getSnapshot().nodes['node-1']?.data.prompt).toBe('gap-refresh')
    await service.dispose()
  })

  it('deduplicates an own committed event by both client and mutation IDs', async () => {
    const remote = new FakeRemote()
    let release!: () => void
    remote.writeGate = new Promise<void>(resolve => { release = resolve })
    const service = client(remote)
    await service.start()
    const operations: CanvasPatchOperation[] = [
      { op: 'replace', path: '/nodes/node-1/data/label', value: 'once' },
    ]
    const write = service.applyOperations(operations, { mutationId: 'mine-1' })
    await vi.waitFor(() => expect(remote.applyPatch).toHaveBeenCalledTimes(1))

    const event: CanvasCommittedEvent = {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      canvasId: 'canvas-1',
      revision: 2,
      mutationId: 'mine-1',
      source: 'test',
      originClientId: 'client-1',
      operations,
    }
    expect(service.handleCommittedEvent(event)).toBe('applied')
    expect(service.getSnapshot().nodes['node-1']?.data.label).toBe('once')
    expect(service.history.canUndo).toBe(true)
    expect(service.handleCommittedEvent(event)).toBe('duplicate')

    release()
    await write
    expect(service.getSnapshot()).toMatchObject({ revision: 2 })
    await service.dispose()
  })

  it('closes when the bounded waiter reports deletion', async () => {
    const remote = new FakeRemote()
    const service = client(remote)
    await service.start()
    remote.resolveWait({ status: 'deleted' })
    await vi.waitFor(() => expect(service.state.status).toBe('closed'))
    expect(() => service.getSnapshot()).toThrow(/No Canvas document/u)
    expect(remote.waitForRevision).toHaveBeenCalledTimes(1)
    await service.dispose()
  })
})

function external(
  document: CanvasDocument,
  operations: readonly CanvasPatchOperation[],
  revisionIncrease = 1,
): CanvasDocument {
  const patched = applyCanvasPatch({ document, operations }).document
  return {
    ...patched,
    revision: document.revision + revisionIncrease,
    updatedAt: '2026-08-26T00:00:02.000Z',
  }
}
