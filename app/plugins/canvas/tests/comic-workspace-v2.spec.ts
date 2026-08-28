import {
  applyCanvasPatch,
  type ApplyCanvasPatchRequest,
  type ApplyCanvasPatchResult,
  type CanvasDocument,
  type CanvasPatchOperation,
  type GetCanvasDocumentRequest,
  type WaitForCanvasRevisionRequest,
  type WaitForCanvasRevisionResult,
} from '@convax/canvas-api'
import { describe, expect, it, vi } from 'vitest'
import {
  ComicCanvasWorkspace,
  type ComicCanvasWorkspaceOptions,
} from '../src/client/comic-workspace-v2.ts'
import {
  CanvasClientService,
  type CanvasRemotePort,
} from '../src/client/canvas-client-service.ts'
import { CanvasFileError, type CanvasIdKind, type CanvasObjectUrlApi } from '../src/client/comic-ui-contract.ts'

function document(): CanvasDocument {
  return {
    schemaVersion: 2,
    revision: 0,
    id: 'canvas-main',
    workspaceId: 'workspace-main',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    metadata: { title: 'Comic board' },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: {
      note: {
        id: 'note', type: 'comic.note', kindVersion: 1,
        position: { x: 10, y: 20 }, zIndex: 0,
        style: { width: 280, height: 180 },
        data: { title: 'Opening', text: 'Once upon a panel' },
      },
      image: {
        id: 'image', type: 'comic.image', kindVersion: 1,
        position: { x: 400, y: 20 }, zIndex: 1,
        style: { width: 320, height: 240 },
        data: {
          title: 'Reference',
          source: { type: 'url', url: 'https://example.test/reference.png' },
          alt: 'Reference image',
        },
      },
      unknown: {
        id: 'unknown', type: 'plugin.special', kindVersion: 7,
        position: { x: 800, y: 20 }, zIndex: 2,
        style: { color: 'purple' },
        data: { secret: { nested: ['lossless', 42] }, runtimeIndependent: true },
      },
    },
    edges: {
      sequence: {
        id: 'sequence', type: 'comic.sequence', kindVersion: 1,
        source: 'note', target: 'image', sourceHandle: 'out',
        data: { label: 'Next' },
      },
      unknownEdge: {
        id: 'unknownEdge', type: 'plugin.edge', kindVersion: 3,
        source: 'image', target: 'unknown', data: { routing: 'custom' },
      },
    },
  }
}

class FakeRemote implements CanvasRemotePort {
  current: CanvasDocument
  readonly writes: ApplyCanvasPatchRequest[] = []
  failNext: unknown

  constructor(initial = document()) {
    this.current = structuredClone(initial)
  }

  async getDocument(_request: GetCanvasDocumentRequest): Promise<CanvasDocument> {
    return structuredClone(this.current)
  }

  async applyPatch(request: ApplyCanvasPatchRequest): Promise<ApplyCanvasPatchResult> {
    this.writes.push(structuredClone(request))
    if (this.failNext !== undefined) {
      const error = this.failNext
      this.failNext = undefined
      throw error
    }
    const patched = applyCanvasPatch({ document: this.current, operations: request.operations }).document
    this.current = { ...patched, revision: this.current.revision + 1, updatedAt: '2026-03-01T00:00:01.000Z' }
    return { document: structuredClone(this.current), revision: this.current.revision, applied: request.operations.length }
  }

  waitForRevision(_request: WaitForCanvasRevisionRequest, signal?: AbortSignal): Promise<WaitForCanvasRevisionResult> {
    return new Promise(resolve => {
      const finish = (): void => { resolve({ status: 'deleted' }) }
      if (signal?.aborted === true) finish()
      else signal?.addEventListener('abort', finish, { once: true })
    })
  }
}

function ids(): (kind: CanvasIdKind) => string {
  const counters = new Map<CanvasIdKind, number>()
  return kind => {
    const count = (counters.get(kind) ?? 0) + 1
    counters.set(kind, count)
    return `${kind}:new-${count}`
  }
}

function urls(): CanvasObjectUrlApi & { created: string[]; revoked: string[] } {
  const created: string[] = []
  const revoked: string[] = []
  return {
    created,
    revoked,
    createObjectURL() {
      const url = `blob:comic-${created.length + 1}`
      created.push(url)
      return url
    },
    revokeObjectURL(url) { revoked.push(url) },
  }
}

async function setup(options: ComicCanvasWorkspaceOptions = {}) {
  const remote = new FakeRemote()
  const service = new CanvasClientService(remote, {
    workspaceId: 'workspace-main',
    projectId: 'project-main',
    canvasId: 'canvas-main',
    revisionWaitMs: 30_000,
  })
  await service.start()
  const workspace = new ComicCanvasWorkspace(service, { createId: ids(), ...options })
  return { remote, service, workspace }
}

function paths(operations: readonly CanvasPatchOperation[]): string[] {
  return operations.map(operation => `${operation.op}:${operation.path}`)
}

describe('ComicCanvasWorkspace V2 projection', () => {
  it('projects V2 node/edge ID maps to a session-only UI view model', async () => {
    const { service, workspace } = await setup()
    const snapshot = workspace.getSnapshot()

    expect(snapshot.document).toMatchObject({
      id: 'canvas-main',
      title: 'Comic board',
      nodes: [
        { id: 'image', kind: 'image', title: 'Reference', size: { width: 320, height: 240 } },
        { id: 'note', kind: 'note', title: 'Opening', text: 'Once upon a panel' },
        {
          id: 'unknown', kind: 'note', title: 'Unsupported: plugin.special@7',
          readOnlyData: true, v2Type: 'plugin.special', v2KindVersion: 7,
        },
      ],
      edges: [
        { id: 'sequence', source: 'note', target: 'image', sourceHandle: 'out' },
        { id: 'unknownEdge', source: 'image', target: 'unknown' },
      ],
    })
    expect(Array.isArray(service.getSnapshot().nodes)).toBe(false)
    expect(service.getSnapshot().nodes.unknown?.data).toEqual({
      secret: { nested: ['lossless', 42] }, runtimeIndependent: true,
    })
    expect('serialize' in workspace).toBe(false)
    workspace.dispose()
  })

  it('owns open/subscription state only at the boundary and refuses document replacement', async () => {
    const { workspace } = await setup()
    const listener = vi.fn()
    const unsubscribe = workspace.subscribe(listener)
    expect(workspace.getSnapshot().open).toBe(false)
    workspace.openCanvas()
    workspace.open()
    expect(workspace.getSnapshot().open).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(() => workspace.openCanvas({ version: 1 })).toThrow(/started V2/u)
    unsubscribe()
    workspace.dispose()
  })
})

describe('ComicCanvasWorkspace V2 mutations', () => {
  it('covers create/update/move/batch move/duplicate/connect/viewport and selection optimistically', async () => {
    const { remote, service, workspace } = await setup()
    workspace.openCanvas()
    const note = workspace.createNode({
      kind: 'text', position: { x: 20, y: 30 }, size: { width: 300, height: 190 }, text: 'Draft',
    })
    const image = workspace.createNode({
      kind: 'image', position: { x: 420, y: 30 },
      source: { type: 'url', url: 'https://example.test/new.png' }, alt: 'New',
    })
    expect(note).toBe('node:new-1')
    expect(image).toBe('node:new-2')
    expect(workspace.getSnapshot().document.nodes.map(node => node.id)).toContain(note)

    workspace.updateNode(note, { title: 'Scene', text: 'Revised', size: { width: 500, height: 300 } })
    workspace.moveNode(note, { x: 40, y: 50 })
    workspace.moveNodes([
      { id: note, position: { x: 60, y: 70 } },
      { id: image, position: { x: 460, y: 70 } },
    ])
    const [copy] = workspace.duplicateNodes([note], { x: 10, y: 20 })
    expect(copy).toBe('node:new-3')
    const edge = workspace.connect({ source: copy!, target: image, sourceHandle: 'out' })
    expect(workspace.connect({ source: copy!, target: image, sourceHandle: 'out' })).toBe(edge)
    workspace.setViewport({ x: 100, y: -50, zoom: 1.5 })
    workspace.setSelection({ nodeIds: [copy!], edgeIds: [edge] })
    expect(workspace.getSnapshot()).toMatchObject({ selectedNodeId: copy, selection: { nodeIds: [copy], edgeIds: [edge] } })
    workspace.selectNode(note)
    expect(workspace.getSnapshot().selection).toEqual({ nodeIds: [note], edgeIds: [] })

    expect(workspace.getSnapshot().document.nodes.find(node => node.id === note)).toMatchObject({
      kind: 'note', title: 'Scene', text: 'Revised', position: { x: 60, y: 70 }, size: { width: 500, height: 300 },
    })
    expect(service.getSnapshot().nodes[note]).toMatchObject({
      type: 'comic.note', kindVersion: 1, data: { title: 'Scene', text: 'Revised' },
    })
    expect(service.getSnapshot().edges[edge]).toMatchObject({
      type: 'comic.sequence', kindVersion: 1, data: { label: '' },
    })
    expect(service.getSnapshot().viewport).toEqual({ x: 100, y: -50, zoom: 1.5 })

    await workspace.flush()
    const serializedWrites = JSON.stringify(remote.writes)
    expect(serializedWrites).not.toContain('"version":1')
    expect(remote.writes.flatMap(write => write.operations).filter(operation => operation.op === 'add')).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: `/nodes/${note}` }), expect.objectContaining({ path: `/edges/${edge}` })]),
    )
    workspace.dispose()
  })

  it('keeps unknown data lossless while allowing only geometry and deletion', async () => {
    const { service, workspace } = await setup()
    const originalData = structuredClone(service.getSnapshot().nodes.unknown!.data)
    expect(() => workspace.updateNode('unknown', { title: 'Overwrite' })).toThrow(/read-only/u)
    expect(() => workspace.updateNode('unknown', { text: 'Overwrite' })).toThrow(/read-only/u)
    expect(() => workspace.duplicateNodes(['unknown'])).toThrow(/cannot be duplicated/u)

    workspace.moveNode('unknown', { x: 900, y: 100 })
    workspace.updateNode('unknown', { size: { width: 360, height: 220 } })
    expect(workspace.getSnapshot().document.nodes.find(node => node.id === 'unknown')).toMatchObject({
      position: { x: 900, y: 100 }, size: { width: 360, height: 220 }, readOnlyData: true,
    })
    expect(service.getSnapshot().nodes.unknown?.data).toEqual(originalData)
    await workspace.flush()
    workspace.removeNodes(['unknown'])
    expect(service.getSnapshot().nodes.unknown).toBeUndefined()
    workspace.dispose()
  })

  it('removes explicit and incident edges with nodes in one atomic patch batch', async () => {
    const { remote, service, workspace } = await setup()
    workspace.removeElements(['image'], ['unknownEdge'])
    expect(service.getSnapshot().nodes.image).toBeUndefined()
    expect(service.getSnapshot().edges.sequence).toBeUndefined()
    expect(service.getSnapshot().edges.unknownEdge).toBeUndefined()
    await workspace.flush()

    const deletion = remote.writes.find(write => write.operations.some(operation => operation.path === '/nodes/image'))
    expect(deletion).toBeDefined()
    expect(paths(deletion!.operations)).toEqual([
      'remove:/edges/sequence',
      'remove:/edges/unknownEdge',
      'remove:/nodes/image',
    ])

    workspace.removeEdges([])
    workspace.removeNodes([])
    workspace.dispose()
  })

  it('delegates coalesced gesture history and immediate undo/redo to the V2 Client service', async () => {
    const { service, workspace } = await setup()
    workspace.beginGesture()
    workspace.moveNode('note', { x: 20, y: 30 })
    workspace.moveNode('note', { x: 40, y: 60 })
    workspace.endGesture()
    expect(service.history.size).toBe(1)
    expect(workspace.getSnapshot().document.nodes.find(node => node.id === 'note')?.position).toEqual({ x: 40, y: 60 })

    expect(workspace.undo()).toBe(true)
    expect(workspace.getSnapshot().document.nodes.find(node => node.id === 'note')?.position).toEqual({ x: 10, y: 20 })
    await workspace.flush()
    expect(workspace.redo()).toBe(true)
    expect(workspace.getSnapshot().document.nodes.find(node => node.id === 'note')?.position).toEqual({ x: 40, y: 60 })
    await workspace.flush()
    workspace.dispose()
  })

  it('exposes queued write errors through flush and errors while retaining optimistic calls', async () => {
    const { remote, workspace } = await setup()
    remote.failNext = new Error('write rejected')
    const id = workspace.createNode({ kind: 'note', position: { x: 0, y: 0 } })
    expect(workspace.getSnapshot().document.nodes.some(node => node.id === id)).toBe(true)
    await expect(workspace.flush()).rejects.toBeInstanceOf(AggregateError)
    expect(workspace.errors).toHaveLength(1)
    expect(workspace.errors[0]).toEqual(expect.objectContaining({ message: 'write rejected' }))
    workspace.dispose()
  })
})

describe('ComicCanvasWorkspace temporary image media', () => {
  it('validates whole drops, creates V2 image nodes, resolves previews, and revokes orphaned URLs', async () => {
    const objectUrl = urls()
    const { remote, service, workspace } = await setup({
      objectUrl,
      mediaPolicy: { image: { maxBytes: 4 } },
      resolveAssetUrl: assetId => `/assets/${encodeURIComponent(assetId)}`,
    })
    const good = new File(['png'], 'panel.png', { type: 'image/png' })
    const second = new File(['jpg'], 'panel-2.jpg', { type: 'image/jpeg' })
    const bad = new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' })
    const large = new File(['large'], 'large.png', { type: 'image/png' })

    await expect(workspace.addDroppedFiles([good, bad], { x: 0, y: 0 })).rejects.toBeInstanceOf(CanvasFileError)
    await expect(workspace.addDroppedFiles([good, large], { x: 0, y: 0 })).rejects.toMatchObject({ code: 'too-large' })
    expect(objectUrl.created).toEqual([])

    const ids = await workspace.addDroppedFiles([good, second], { x: 100, y: 200 })
    expect(ids).toEqual(['node:new-1', 'node:new-2'])
    expect(workspace.getMediaPreviewUrl(ids[0]!)).toBe('blob:comic-1')
    expect(workspace.getMediaPreviewUrl(ids[1]!)).toBe('blob:comic-2')
    expect(service.getSnapshot().nodes[ids[0]!]).toMatchObject({
      type: 'comic.image', kindVersion: 1,
      position: { x: 100, y: 200 },
      data: { source: { type: 'asset', assetId: 'asset:new-1' } },
    })
    expect(JSON.stringify(remote.writes)).not.toContain('blob:comic')
    expect(JSON.stringify(service.getSnapshot())).not.toContain('lastModified')

    const [copy] = workspace.duplicateNodes([ids[0]!])
    workspace.removeNodes([ids[0]!])
    expect(objectUrl.revoked).toEqual([])
    expect(workspace.getMediaPreviewUrl(copy!)).toBe('blob:comic-1')
    workspace.removeNodes([copy!])
    expect(objectUrl.revoked).toEqual(['blob:comic-1'])
    expect(workspace.getMediaPreviewUrl('image')).toBe('https://example.test/reference.png')
    workspace.dispose()
    expect(objectUrl.revoked).toEqual(['blob:comic-1', 'blob:comic-2'])
  })

  it('uses the persistent asset resolver without placing runtime URLs into V2', async () => {
    const initial = document()
    initial.nodes.image!.data = {
      title: 'Asset', source: { type: 'asset', assetId: 'asset:sha256:abc' }, alt: 'Asset',
    }
    const remote = new FakeRemote(initial)
    const service = new CanvasClientService(remote, {
      workspaceId: 'workspace-main', projectId: 'project-main', canvasId: 'canvas-main', revisionWaitMs: 30_000,
    })
    await service.start()
    const workspace = new ComicCanvasWorkspace(service, {
      resolveAssetUrl: assetId => `/assets/${encodeURIComponent(assetId)}`,
    })
    expect(workspace.getMediaPreviewUrl('image')).toBe('/assets/asset%3Asha256%3Aabc')
    expect(JSON.stringify(service.getSnapshot())).not.toContain('/assets/')
    workspace.dispose()
  })
})
