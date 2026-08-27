import { describe, expect, it, vi } from 'vitest'
import {
  CanvasFileError,
  CanvasWorkspace,
  type CanvasIdKind,
  type CanvasObjectUrlApi,
} from '../src/client/store.ts'

function ids(): (kind: CanvasIdKind) => string {
  const counters = new Map<CanvasIdKind, number>()
  return (kind) => {
    const next = (counters.get(kind) ?? 0) + 1
    counters.set(kind, next)
    return `${kind}:${next}`
  }
}

function urls(): CanvasObjectUrlApi & { readonly created: string[]; readonly revoked: string[] } {
  const created: string[] = []
  const revoked: string[] = []
  return {
    created,
    revoked,
    createObjectURL(): string {
      const url = `blob:test-${created.length + 1}`
      created.push(url)
      return url
    },
    revokeObjectURL(url): void {
      revoked.push(url)
    },
  }
}

describe('CanvasWorkspace graph state', () => {
  it('owns open and selection UI state while keeping it out of serialization', () => {
    const workspace = new CanvasWorkspace({ createId: ids() })
    const listener = vi.fn()
    workspace.subscribe(listener)

    workspace.openCanvas()
    const note = workspace.addNode({ kind: 'text', position: { x: 10, y: 20 }, text: 'Beat one' })
    const image = workspace.addNode({ kind: 'image', position: { x: 400, y: 20 } })
    workspace.selectNode(note)
    const edge = workspace.addEdge({ source: note, target: image, sourceHandle: 'out' })
    workspace.setSelection({ nodeIds: [image], edgeIds: [edge] })

    const snapshot = workspace.getSnapshot()
    expect(snapshot.open).toBe(true)
    expect(snapshot.selectedNodeId).toBe(image)
    expect(snapshot.selection).toEqual({ nodeIds: [image], edgeIds: [edge] })
    expect(snapshot.document.nodes.find((node) => node.id === image)).toMatchObject({
      kind: 'image',
      source: { type: 'asset', assetId: 'asset:1' },
    })
    expect(workspace.resolveMediaUrl(image)).toBeUndefined()
    expect(workspace.serialize()).not.toContain('selectedNodeId')
    expect(workspace.serialize()).not.toContain('open')
    expect(listener).toHaveBeenCalledTimes(6)

    workspace.closeCanvas()
    expect(workspace.getSnapshot().open).toBe(false)
    expect(workspace.getSnapshot().selection.nodeIds).toEqual([])
  })

  it('moves, resizes, updates, duplicates, connects, and removes nodes atomically', () => {
    const workspace = new CanvasWorkspace({ createId: ids() })
    const note = workspace.createNode({ kind: 'note', position: { x: 0, y: 0 }, text: 'Draft' })
    const image = workspace.createNode({
      kind: 'image',
      position: { x: 200, y: 0 },
      media: { src: 'https://example.test/reference.png', name: 'Reference' },
    })
    workspace.moveNode(note, { x: 12, y: 18 })
    workspace.resizeNode(note, { width: 500, height: 300 })
    workspace.updateNode(note, { title: 'Scene', text: 'Revised' })
    const [copy] = workspace.duplicateNodes([note], { x: 20, y: 30 })
    expect(copy).toBeDefined()
    const edge = workspace.connect({ source: copy as string, target: image })
    expect(workspace.connect({ source: copy as string, target: image })).toBe(edge)

    expect(workspace.getSnapshot().document.nodes.find((node) => node.id === note)).toMatchObject({
      position: { x: 12, y: 18 },
      size: { width: 500, height: 300 },
      title: 'Scene',
      text: 'Revised',
    })
    expect(workspace.getSnapshot().document.nodes.find((node) => node.id === copy)).toMatchObject({
      position: { x: 32, y: 48 },
    })

    workspace.removeNode(copy as string)
    expect(workspace.getSnapshot().document.edges).toEqual([])
    workspace.setViewport({ x: 40, y: -20, zoom: 2 })
    expect(workspace.getSnapshot().document.viewport).toEqual({ x: 40, y: -20, zoom: 2 })
  })

  it('preserves graph identity when only the viewport changes', () => {
    const workspace = new CanvasWorkspace({ createId: ids() })
    workspace.createNode({ kind: 'note', position: { x: 10, y: 20 }, text: 'Stable' })
    const before = workspace.getSnapshot().document

    workspace.setViewport({ x: 24, y: -12, zoom: 1.4 })
    const after = workspace.getSnapshot().document

    expect(after).not.toBe(before)
    expect(after.nodes).toBe(before.nodes)
    expect(after.edges).toBe(before.edges)
  })

  it('preserves the untouched graph axis across node and edge commits', () => {
    const workspace = new CanvasWorkspace({ createId: ids() })
    const source = workspace.createNode({ kind: 'note', position: { x: 0, y: 0 } })
    const target = workspace.createNode({ kind: 'note', position: { x: 300, y: 0 } })
    const beforeEdge = workspace.getSnapshot().document

    workspace.connect({ source, target })
    const afterEdge = workspace.getSnapshot().document
    expect(afterEdge.nodes).toBe(beforeEdge.nodes)
    expect(afterEdge.edges).not.toBe(beforeEdge.edges)

    workspace.updateNode(source, { text: 'Changed' })
    const afterNode = workspace.getSnapshot().document
    expect(afterNode.nodes).not.toBe(afterEdge.nodes)
    expect(afterNode.edges).toBe(afterEdge.edges)
  })

  it('moves a batch atomically and coalesces a drag gesture into one undo step', () => {
    const workspace = new CanvasWorkspace({ createId: ids() })
    const first = workspace.createNode({ kind: 'note', position: { x: 0, y: 0 } })
    const second = workspace.createNode({ kind: 'note', position: { x: 300, y: 0 } })
    const listener = vi.fn()
    workspace.subscribe(listener)

    workspace.moveNodes([
      { id: first, position: { x: 20, y: 40 } },
      { id: second, position: { x: 360, y: 40 } },
    ])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(workspace.getSnapshot().document.nodes.map(node => node.position)).toEqual([
      { x: 20, y: 40 },
      { x: 360, y: 40 },
    ])

    workspace.beginGesture()
    workspace.moveNode(first, { x: 40, y: 60 })
    workspace.moveNode(first, { x: 80, y: 100 })
    workspace.endGesture()
    expect(workspace.undo()).toBe(true)
    expect(workspace.getSnapshot().document.nodes[0]?.position).toEqual({ x: 20, y: 40 })
    expect(workspace.redo()).toBe(true)
    expect(workspace.getSnapshot().document.nodes[0]?.position).toEqual({ x: 80, y: 100 })
  })

  it('coalesces live resize geometry, including top-left position, into one undo step', () => {
    const workspace = new CanvasWorkspace({ createId: ids() })
    const node = workspace.createNode({
      kind: 'image',
      position: { x: 100, y: 120 },
      size: { width: 320, height: 240 },
    })

    workspace.beginGesture()
    workspace.updateNode(node, { position: { x: 80, y: 100 }, size: { width: 340, height: 260 } })
    workspace.updateNode(node, { position: { x: 60, y: 80 }, size: { width: 360, height: 280 } })
    workspace.endGesture()
    expect(workspace.getSnapshot().document.nodes[0]).toMatchObject({
      position: { x: 60, y: 80 },
      size: { width: 360, height: 280 },
    })

    expect(workspace.undo()).toBe(true)
    expect(workspace.getSnapshot().document.nodes[0]).toMatchObject({
      position: { x: 100, y: 120 },
      size: { width: 320, height: 240 },
    })
  })

  it('removes selected nodes and edges as one undoable operation', () => {
    const workspace = new CanvasWorkspace({ createId: ids() })
    const first = workspace.createNode({ kind: 'note', position: { x: 0, y: 0 } })
    const second = workspace.createNode({ kind: 'note', position: { x: 300, y: 0 } })
    const edge = workspace.connect({ source: first, target: second })

    workspace.removeElements([first], [edge])
    expect(workspace.getSnapshot().document).toMatchObject({
      nodes: [{ id: second }],
      edges: [],
    })
    expect(workspace.canUndo()).toBe(true)
    expect(workspace.undo()).toBe(true)
    expect(workspace.getSnapshot().document.nodes).toHaveLength(2)
    expect(workspace.getSnapshot().document.edges).toMatchObject([{ id: edge }])
    expect(workspace.canRedo()).toBe(true)
  })

  it('strictly rejects blob/file URLs passed through create and update', () => {
    const workspace = new CanvasWorkspace({ createId: ids() })
    expect(() => workspace.createNode({
      kind: 'image',
      position: { x: 0, y: 0 },
      media: { src: 'blob:leak' },
    })).toThrowError(/only http and https/u)

    const image = workspace.createNode({ kind: 'image', position: { x: 0, y: 0 } })
    expect(() => workspace.updateNode(image, { media: { src: 'file:///private/image.png' } })).toThrowError(/only http and https/u)
  })

  it('rejects new video nodes at the workspace boundary', () => {
    const workspace = new CanvasWorkspace({ createId: ids() })
    expect(() => workspace.createNode({
      kind: 'video',
      position: { x: 0, y: 0 },
    } as never)).toThrowError(/only note and image/u)
  })
})

describe('CanvasWorkspace temporary media', () => {
  it('validates a whole image drop before allocating URLs and rejects video files', async () => {
    const objectUrl = urls()
    const workspace = new CanvasWorkspace({
      createId: ids(),
      objectUrl,
      mediaPolicy: {
        image: { maxBytes: 4 },
      },
    })
    const good = new File(['img'], 'panel.png', { type: 'image/png' })
    const bad = new File(['unsafe'], 'vector.svg', { type: 'image/svg+xml' })
    const oversized = new File(['large'], 'large.png', { type: 'image/png' })

    await expect(workspace.addDroppedFiles([good, bad], { x: 100, y: 200 })).rejects.toBeInstanceOf(CanvasFileError)
    await expect(workspace.addDroppedFiles([good, oversized], { x: 100, y: 200 })).rejects.toMatchObject({ code: 'too-large' })
    expect(objectUrl.created).toEqual([])
    expect(workspace.getSnapshot().document.nodes).toEqual([])

    const video = new File(['mp4'], 'motion.mp4', { type: 'video/mp4' })
    await expect(workspace.addFiles([good, video], { x: 100, y: 200 })).rejects.toMatchObject({ code: 'unsupported-type' })
    expect(objectUrl.created).toEqual([])

    const second = new File(['jpg'], 'reference.jpg', { type: 'image/jpeg' })
    const nodeIds = await workspace.addFiles([good, second], { x: 100, y: 200 })
    expect(nodeIds).toEqual(['node:1', 'node:2'])
    expect(workspace.getSnapshot().document.nodes).toMatchObject([
      { kind: 'image', position: { x: 100, y: 200 }, source: { type: 'asset', assetId: 'asset:1' } },
      { kind: 'image', position: { x: 128, y: 228 }, source: { type: 'asset', assetId: 'asset:2' } },
    ])
    expect(workspace.getMediaPreviewUrl(nodeIds[0] as string)).toBe('blob:test-1')
    expect(workspace.getMediaPreviewUrl(nodeIds[1] as string)).toBe('blob:test-2')
    expect(workspace.serialize()).not.toContain('blob:test')
    expect(workspace.serialize()).not.toContain('lastModified')
  })

  it('releases an object URL only after its last node reference is deleted', async () => {
    const objectUrl = urls()
    const workspace = new CanvasWorkspace({ createId: ids(), objectUrl })
    const [image] = await workspace.addFiles(
      [new File(['png'], 'panel.png', { type: 'image/png' })],
      { x: 0, y: 0 },
    )
    const [copy] = workspace.duplicateNode([image as string])

    workspace.removeNode(image as string)
    expect(objectUrl.revoked).toEqual([])
    expect(workspace.getMediaPreviewUrl(copy as string)).toBe('blob:test-1')
    workspace.removeNode(copy as string)
    expect(objectUrl.revoked).toEqual(['blob:test-1'])
  })

  it('revokes previews on replace, document replacement, and dispose', async () => {
    const objectUrl = urls()
    const workspace = new CanvasWorkspace({ createId: ids(), objectUrl })
    const [image] = await workspace.addFiles(
      [new File(['one'], 'one.png', { type: 'image/png' })],
      { x: 0, y: 0 },
    )
    await workspace.attachFile(image as string, new File(['two'], 'two.png', { type: 'image/png' }))
    expect(objectUrl.revoked).toEqual(['blob:test-1'])
    expect(workspace.getMediaPreviewUrl(image as string)).toBe('blob:test-2')

    await workspace.addFiles([new File(['img'], 'second.png', { type: 'image/png' })], { x: 50, y: 50 })
    workspace.importDocument({
      version: 1,
      id: 'document:replacement',
      title: 'Replacement',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
    })
    expect(objectUrl.revoked).toEqual(['blob:test-1', 'blob:test-2', 'blob:test-3'])

    const [last] = await workspace.addFiles(
      [new File(['last'], 'last.png', { type: 'image/png' })],
      { x: 0, y: 0 },
    )
    expect(workspace.getMediaPreviewUrl(last as string)).toBe('blob:test-4')
    workspace.dispose()
    workspace.dispose()
    expect(objectUrl.revoked).toEqual(['blob:test-1', 'blob:test-2', 'blob:test-3', 'blob:test-4'])
    expect(() => workspace.openCanvas()).toThrowError(/disposed/u)
  })

  it('can resolve persistent assets without placing runtime URLs in the document', () => {
    const workspace = new CanvasWorkspace({
      createId: ids(),
      resolveAssetUrl: (assetId) => `/comic/assets/${encodeURIComponent(assetId)}`,
    })
    const image = workspace.createNode({
      kind: 'image',
      position: { x: 0, y: 0 },
      source: { type: 'asset', assetId: 'asset:sha256:abc' },
    })

    expect(workspace.resolveMediaUrl(image)).toBe('/comic/assets/asset%3Asha256%3Aabc')
    expect(workspace.serialize()).not.toContain('/comic/assets/')
  })
})
