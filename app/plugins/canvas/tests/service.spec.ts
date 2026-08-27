import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { CanvasRevisionConflict, createCanvasService } from '../src/service.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Canvas Host service', () => {
  it('provides a revisioned, persisted document authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'convax-canvas-'))
    temporaryRoots.push(root)
    const ctx = new Context()
    const canvas = await createCanvasService(ctx, { dataDir: root })

    const created = await canvas.createNode({
      kind: 'note',
      position: { x: 10, y: 20 },
      title: 'Opening',
      text: 'First beat',
    })
    expect(created.snapshot.revision).toBe(1)
    expect(ctx.get('canvas')).toBeDefined()

    const wire = canvas.readJson()
    expect(JSON.parse(wire.documentJson)).toMatchObject({
      version: 1,
      nodes: [{ kind: 'note', title: 'Opening', text: 'First beat' }],
    })
    await expect(canvas.replaceJson(wire.documentJson, 0)).rejects.toBeInstanceOf(CanvasRevisionConflict)

    const persisted = await readFile(join(root, 'default', 'canvas.canvas.json'), 'utf8')
    expect(JSON.parse(persisted)).toMatchObject({
      version: 1,
      id: 'project:default',
      activeCanvasId: wire.activeCanvasId,
      canvases: [JSON.parse(wire.documentJson)],
    })
    await canvas.flush()
    canvas.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps multiple canvases isolated inside one project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'convax-canvas-project-'))
    temporaryRoots.push(root)
    const ctx = new Context()
    const canvas = await createCanvasService(ctx, { dataDir: root })
    const firstId = canvas.snapshot().document.id
    await canvas.createNode({ kind: 'note', position: { x: 0, y: 0 }, title: 'First' })

    await canvas.createCanvas('Storyboard')
    const secondId = canvas.snapshot().document.id
    expect(secondId).not.toBe(firstId)
    expect(canvas.readJson()).toMatchObject({
      activeCanvasId: secondId,
      canvases: [
        { id: firstId, title: 'Untitled canvas', nodeCount: 1 },
        { id: secondId, title: 'Storyboard', nodeCount: 0 },
      ],
    })

    await canvas.createNode({ kind: 'image', position: { x: 20, y: 20 }, title: 'Reference' })
    await canvas.selectCanvas(firstId)
    expect(canvas.snapshot().document.nodes.map(node => node.title)).toEqual(['First'])
    await canvas.selectCanvas(secondId)
    expect(canvas.snapshot().document.nodes.map(node => node.title)).toEqual(['Reference'])

    const persisted = JSON.parse(await readFile(join(root, 'default', 'canvas.canvas.json'), 'utf8')) as {
      canvases: unknown[]
    }
    expect(persisted.canvases).toHaveLength(2)
    canvas.dispose()
    await ctx.fiber.dispose()
  })

  it('preserves legacy video data while excluding it from Comic canvas summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'convax-canvas-legacy-'))
    temporaryRoots.push(root)
    const projectDir = join(root, 'default')
    await mkdir(projectDir)
    await writeFile(join(projectDir, 'canvas.canvas.json'), JSON.stringify({
      version: 1,
      id: 'project:default',
      activeCanvasId: 'document:legacy',
      canvases: [{
        version: 1,
        id: 'document:legacy',
        title: 'Legacy',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          { id: 'node:note', kind: 'note', position: { x: 0, y: 0 }, size: { width: 200, height: 120 }, title: 'Note', text: '' },
          { id: 'node:video', kind: 'video', position: { x: 240, y: 0 }, size: { width: 320, height: 180 }, title: 'Old clip', source: { type: 'url', url: 'https://example.test/clip.mp4' } },
        ],
        edges: [{ id: 'edge:legacy', source: 'node:note', target: 'node:video' }],
      }],
    }))
    const ctx = new Context()
    const canvas = await createCanvasService(ctx, { dataDir: root })

    expect(canvas.snapshot().document.nodes).toHaveLength(2)
    expect(canvas.readJson().canvases).toEqual([{
      id: 'document:legacy',
      title: 'Legacy',
      nodeCount: 1,
      edgeCount: 0,
    }])

    canvas.dispose()
    await ctx.fiber.dispose()
  })
})
