import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { serializeCanvasDocument, type CanvasDocumentV1, type CanvasNodeV1 } from './schema.js'
import { createCanvasService, type CanvasService, type CanvasServiceConfig, type CanvasSnapshot } from './service.js'

export * from './schema.js'
export * from './service.js'

export const name = 'app-canvas'
export const inject = ['tools']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Product-owned Canvas authority available to Host plugins. */
    canvas: CanvasService
  }
}

function mutationResult(snapshot: CanvasSnapshot, changedIds: readonly string[]) {
  const visibleNodeIds = new Set(snapshot.document.nodes.filter(node => node.kind !== 'video').map(node => node.id))
  return {
    revision: snapshot.revision,
    documentId: snapshot.document.id,
    nodeCount: visibleNodeIds.size,
    edgeCount: snapshot.document.edges.filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)).length,
    changedIds: [...changedIds],
  }
}

function projectResult(canvas: CanvasService) {
  const snapshot = canvas.readJson()
  return {
    revision: snapshot.revision,
    activeCanvasId: snapshot.activeCanvasId,
    canvasCount: snapshot.canvases.length,
    canvasesJson: JSON.stringify(snapshot.canvases),
  }
}

const projectOutput = {
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      revision: { type: 'integer' as const, required: true },
      activeCanvasId: { type: 'string' as const, required: true },
      canvasCount: { type: 'integer' as const, required: true },
      canvasesJson: { type: 'string' as const, required: true },
    },
  },
  render: (_args: unknown, value: ReturnType<typeof projectResult>) => [{
    type: 'text' as const,
    text: `${value.canvasCount} canvases; active ${value.activeCanvasId}\n${value.canvasesJson}`,
  }],
} as const

const mutationOutput = {
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      revision: { type: 'integer' as const, required: true },
      documentId: { type: 'string' as const, required: true },
      nodeCount: { type: 'integer' as const, required: true },
      edgeCount: { type: 'integer' as const, required: true },
      changedIds: {
        type: 'array' as const,
        required: true,
        items: { type: 'string' as const },
      },
    },
  },
  render: (_args: unknown, value: ReturnType<typeof mutationResult>) => [{
    type: 'text' as const,
    text: `Canvas revision ${value.revision}: ${value.nodeCount} nodes, ${value.edgeCount} edges.`,
  }],
} as const

function findNode(canvas: CanvasService, id: string): CanvasNodeV1 {
  const node = canvas.snapshot().document.nodes.find(candidate => candidate.id === id)
  if (node === undefined || node.kind === 'video') throw new Error(`canvas node not found: ${id}`)
  return node
}

function comicDocument(document: CanvasDocumentV1): CanvasDocumentV1 {
  const nodes = document.nodes.filter(node => node.kind !== 'video')
  const nodeIds = new Set(nodes.map(node => node.id))
  return {
    ...document,
    nodes,
    edges: document.edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  }
}

function registerCanvasTools(ctx: Context, canvas: CanvasService): void {
  ctx.tools.register(defineTool({
    name: 'canvas_get',
    description: 'Read the complete current Convax Canvas document as strict versioned JSON before editing it.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          revision: { type: 'integer', required: true },
          documentJson: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Canvas revision ${value.revision}\n${value.documentJson}`,
      }],
    },
    execute: async () => {
      const snapshot = canvas.snapshot()
      return { revision: snapshot.revision, documentJson: serializeCanvasDocument(comicDocument(snapshot.document)) }
    },
    isConcurrencySafe: () => true,
  }))

  ctx.tools.register(defineTool({
    name: 'canvas_list',
    description: 'List every canvas in the current Convax project and identify the active canvas.',
    parameters: {},
    output: projectOutput,
    execute: async () => projectResult(canvas),
    isConcurrencySafe: () => true,
  }))

  ctx.tools.register(defineTool({
    name: 'canvas_create',
    description: 'Create and activate a new canvas inside the current Convax project.',
    parameters: {
      title: { type: 'string', description: 'Optional canvas title.' },
    },
    output: projectOutput,
    execute: async (args) => {
      await canvas.createCanvas(args.title ?? '')
      return projectResult(canvas)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'canvas_select',
    description: 'Switch the active canvas for subsequent Canvas reads and mutations.',
    parameters: {
      canvasId: { type: 'string', required: true },
    },
    output: projectOutput,
    execute: async (args) => {
      await canvas.selectCanvas(args.canvasId)
      return projectResult(canvas)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'canvas_create_node',
    description: 'Create one note or image node on the current Convax Canvas.',
    parameters: {
      kind: { type: 'string', required: true, enum: ['note', 'image'] },
      x: { type: 'number', required: true },
      y: { type: 'number', required: true },
      title: { type: 'string' },
      text: { type: 'string', description: 'Note text; valid only for note nodes.' },
      url: { type: 'string', description: 'Absolute http(s) media URL for an image node.' },
      alt: { type: 'string', description: 'Alternative text for an image node.' },
    },
    output: mutationOutput,
    execute: async (args) => {
      const common = {
        kind: args.kind,
        position: { x: args.x, y: args.y },
        ...(args.title === undefined ? {} : { title: args.title }),
      }
      const input = args.kind === 'note'
        ? { ...common, kind: 'note' as const, ...(args.text === undefined ? {} : { text: args.text }) }
        : {
            ...common,
            kind: 'image' as const,
            ...(args.url === undefined ? {} : { source: { type: 'url' as const, url: args.url } }),
            ...(args.alt === undefined ? {} : { alt: args.alt }),
          }
      const result = await canvas.createNode(input)
      return mutationResult(result.snapshot, [result.id])
    },
  }))

  ctx.tools.register(defineTool({
    name: 'canvas_update_node',
    description: 'Update fields, position, size, or media URL of one existing Convax Canvas node.',
    parameters: {
      id: { type: 'string', required: true },
      title: { type: 'string' },
      text: { type: 'string', description: 'Valid only for note nodes.' },
      alt: { type: 'string', description: 'Valid only for image nodes.' },
      url: { type: 'string', description: 'Absolute http(s) URL; valid only for image nodes.' },
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
    },
    output: mutationOutput,
    execute: async (args) => {
      const previous = findNode(canvas, args.id)
      const patch = {
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.text === undefined ? {} : { text: args.text }),
        ...(args.alt === undefined ? {} : { alt: args.alt }),
        ...(args.url === undefined ? {} : { source: { type: 'url' as const, url: args.url } }),
        ...(args.x === undefined && args.y === undefined ? {} : {
          position: { x: args.x ?? previous.position.x, y: args.y ?? previous.position.y },
        }),
        ...(args.width === undefined && args.height === undefined ? {} : {
          size: { width: args.width ?? previous.size.width, height: args.height ?? previous.size.height },
        }),
      }
      if (Object.keys(patch).length === 0) throw new Error('canvas_update_node requires at least one changed field')
      return mutationResult(await canvas.updateNode(args.id, patch), [args.id])
    },
  }))

  ctx.tools.register(defineTool({
    name: 'canvas_delete_nodes',
    description: 'Delete one or more Convax Canvas nodes and every edge connected to them.',
    parameters: {
      ids: { type: 'array', required: true, items: { type: 'string' } },
    },
    output: mutationOutput,
    execute: async (args) => {
      if (args.ids.length === 0) throw new Error('canvas_delete_nodes requires at least one id')
      return mutationResult(await canvas.removeNodes(args.ids), args.ids)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'canvas_connect',
    description: 'Create a directed edge between two existing Convax Canvas nodes.',
    parameters: {
      source: { type: 'string', required: true },
      target: { type: 'string', required: true },
    },
    output: mutationOutput,
    execute: async (args) => {
      findNode(canvas, args.source)
      findNode(canvas, args.target)
      const result = await canvas.connect({ source: args.source, target: args.target })
      return mutationResult(result.snapshot, [result.id])
    },
  }))
}

export async function apply(ctx: Context, config: CanvasServiceConfig = {}): Promise<() => Promise<void>> {
  const canvas = await createCanvasService(ctx, config)
  registerCanvasTools(ctx, canvas)
  return async () => {
    await canvas.flush()
    canvas.dispose()
  }
}
