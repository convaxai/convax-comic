import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  COMIC_BUILTIN_KIND_VERSION,
  COMIC_IMAGE_NODE_TYPE,
  COMIC_NOTE_NODE_TYPE,
  COMIC_SEQUENCE_EDGE_TYPE,
} from '@convax/canvas-builtins'
import {
  createDeterministicLeafReplaceOperations,
  encodeJsonPointer,
  type CanvasDocument,
  type CanvasHostApi,
  type CanvasNode,
  type CanvasPatchOperation,
  type CanvasProject,
  type JsonObject,
} from '@convax/canvas-api'

export interface CanvasV2ToolScope {
  readonly workspaceId: string
  readonly projectId: string
}

const TOOL_NAMES = [
  'canvas_get',
  'canvas_list',
  'canvas_create',
  'canvas_select',
  'canvas_create_node',
  'canvas_update_node',
  'canvas_delete_nodes',
  'canvas_connect',
] as const

type CanvasV2ToolName = (typeof TOOL_NAMES)[number]

interface ProjectResult {
  readonly revision: number
  readonly activeCanvasId: string
  readonly canvasCount: number
  readonly canvasesJson: string
}

interface MutationResult {
  readonly revision: number
  readonly documentId: string
  readonly nodeCount: number
  readonly edgeCount: number
  readonly changedIds: string[]
}

interface ActiveCanvas {
  readonly project: CanvasProject
  readonly document: CanvasDocument
}

function mutationMetadata(toolName: CanvasV2ToolName) {
  return {
    mutationId: `${toolName}:${randomUUID()}`,
    source: toolName,
  }
}

function generatedId(domain: 'canvas' | 'edge' | 'node'): string {
  return `${domain}:${randomUUID()}`
}

function pointer(domain: 'edges' | 'nodes', id: string): string {
  return encodeJsonPointer([domain, id])
}

function requireImageUrl(value: string | undefined): string {
  if (value === undefined) throw new Error('image nodes require an absolute http(s) URL')
  return value
}

function projectResult(project: CanvasProject): ProjectResult {
  const canvases = Object.values(project.canvases)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .map(document => ({
      id: document.id,
      title: document.metadata.title,
      nodeCount: Object.keys(document.nodes).length,
      edgeCount: Object.keys(document.edges).length,
      revision: document.revision,
    }))
  return {
    revision: project.revision,
    activeCanvasId: project.activeCanvasId,
    canvasCount: canvases.length,
    canvasesJson: JSON.stringify(canvases),
  }
}

function mutationResult(document: CanvasDocument, changedIds: readonly string[]): MutationResult {
  return {
    revision: document.revision,
    documentId: document.id,
    nodeCount: Object.keys(document.nodes).length,
    edgeCount: Object.keys(document.edges).length,
    changedIds: [...changedIds],
  }
}

async function readProject(canvasHost: CanvasHostApi, scope: CanvasV2ToolScope): Promise<CanvasProject> {
  return await canvasHost.projects.get(scope)
}

async function readActiveCanvas(canvasHost: CanvasHostApi, scope: CanvasV2ToolScope): Promise<ActiveCanvas> {
  const project = await readProject(canvasHost, scope)
  const document = project.canvases[project.activeCanvasId]
  if (document === undefined) throw new Error(`active canvas not found: ${project.activeCanvasId}`)
  return { project, document }
}

function requireToolMutableNode(document: CanvasDocument, id: string): CanvasNode {
  const node = document.nodes[id]
  if (node === undefined) throw new Error(`canvas node not found: ${id}`)
  if (node.kindVersion !== COMIC_BUILTIN_KIND_VERSION
    || (node.type !== COMIC_NOTE_NODE_TYPE && node.type !== COMIC_IMAGE_NODE_TYPE)) {
    throw new Error(`canvas node type is not mutable by Agent tools: ${node.type}@${String(node.kindVersion)}`)
  }
  return node
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
  render: (_args: unknown, value: ProjectResult) => [{
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
  render: (_args: unknown, value: MutationResult) => [{
    type: 'text' as const,
    text: `Canvas revision ${value.revision}: ${value.nodeCount} nodes, ${value.edgeCount} edges.`,
  }],
} as const

/**
 * Register the V2 Canvas Agent surface. Every mutation resolves the current
 * active Canvas immediately
 * before issuing an exact-revision Host request.
 */
export function registerCanvasV2Tools(
  ctx: Context,
  canvasHost: CanvasHostApi,
  scope: CanvasV2ToolScope,
): () => void {
  const disposers: Array<() => void> = []
  const register = (definition: Parameters<Context['tools']['register']>[0]): void => {
    disposers.push(ctx.tools.register(definition))
  }

  try {
    register(defineTool({
      name: 'canvas_get',
      description: 'Read the complete current Convax Canvas document as strict versioned JSON before editing it.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            revision: { type: 'integer', required: true },
            projectRevision: { type: 'integer', required: true },
            projectJson: { type: 'string', required: true },
            documentJson: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `Canvas revision ${value.revision}\n${value.documentJson}`,
        }],
      },
      execute: async () => {
        const { project, document } = await readActiveCanvas(canvasHost, scope)
        return {
          revision: document.revision,
          projectRevision: project.revision,
          projectJson: JSON.stringify(project),
          documentJson: JSON.stringify(document),
        }
      },
      isConcurrencySafe: () => true,
    }))

    register(defineTool({
      name: 'canvas_list',
      description: 'List every canvas in the current Convax project and identify the active canvas.',
      parameters: {},
      output: projectOutput,
      execute: async () => projectResult(await readProject(canvasHost, scope)),
      isConcurrencySafe: () => true,
    }))

    register(defineTool({
      name: 'canvas_create',
      description: 'Create and activate a new canvas inside the current Convax project.',
      parameters: {
        title: { type: 'string', description: 'Optional canvas title.' },
      },
      output: projectOutput,
      execute: async (args) => {
        const project = await readProject(canvasHost, scope)
        const canvasId = generatedId('canvas')
        await canvasHost.documents.createAndActivate({
          ...scope,
          canvasId,
          title: args.title ?? '',
          expectedProjectRevision: project.revision,
          ...mutationMetadata('canvas_create'),
        })
        return projectResult(await readProject(canvasHost, scope))
      },
    }))

    register(defineTool({
      name: 'canvas_select',
      description: 'Switch the active canvas for subsequent Canvas reads and mutations.',
      parameters: {
        canvasId: { type: 'string', required: true },
      },
      output: projectOutput,
      execute: async (args) => {
        const project = await readProject(canvasHost, scope)
        const selected = await canvasHost.projects.setActiveCanvas({
          ...scope,
          canvasId: args.canvasId,
          expectedRevision: project.revision,
          ...mutationMetadata('canvas_select'),
        })
        return projectResult(selected)
      },
    }))

    register(defineTool({
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
        const { project, document } = await readActiveCanvas(canvasHost, scope)
        const id = generatedId('node')
        const title = args.title ?? (args.kind === 'note' ? 'Note' : 'Image')
        if (args.kind === 'note' && (args.url !== undefined || args.alt !== undefined)) {
          throw new Error('note nodes do not accept image fields')
        }
        if (args.kind === 'image' && args.text !== undefined) {
          throw new Error('image nodes do not accept note text')
        }
        const value: CanvasNode = args.kind === 'note'
          ? {
              id,
              type: COMIC_NOTE_NODE_TYPE,
              kindVersion: COMIC_BUILTIN_KIND_VERSION,
              position: { x: args.x, y: args.y },
              zIndex: Object.keys(document.nodes).length,
              style: { width: 280, height: 180 },
              data: { title, text: args.text ?? '' },
            }
          : {
              id,
              type: COMIC_IMAGE_NODE_TYPE,
              kindVersion: COMIC_BUILTIN_KIND_VERSION,
              position: { x: args.x, y: args.y },
              zIndex: Object.keys(document.nodes).length,
              style: { width: 320, height: 240 },
              data: {
                title,
                source: { type: 'url', url: requireImageUrl(args.url) },
                alt: args.alt ?? title,
              },
            }
        const result = await canvasHost.documents.applyActivePatch({
          ...scope,
          expectedProjectRevision: project.revision,
          expectedActiveCanvasId: document.id,
          expectedRevision: document.revision,
          operations: [{ op: 'add', path: pointer('nodes', id), value }],
          ...mutationMetadata('canvas_create_node'),
        })
        return mutationResult(result.document, [id])
      },
    }))

    register(defineTool({
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
        const { project, document } = await readActiveCanvas(canvasHost, scope)
        const previous = requireToolMutableNode(document, args.id)
        if (previous.type === COMIC_NOTE_NODE_TYPE && (args.alt !== undefined || args.url !== undefined)) {
          throw new Error('note nodes do not accept image fields')
        }
        if (previous.type === COMIC_IMAGE_NODE_TYPE && args.text !== undefined) {
          throw new Error('image nodes do not accept note text')
        }
        const position = {
          ...(args.x === undefined ? {} : { x: args.x }),
          ...(args.y === undefined ? {} : { y: args.y }),
        }
        const style = {
          ...(args.width === undefined ? {} : { width: args.width }),
          ...(args.height === undefined ? {} : { height: args.height }),
        }
        const data = {
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.text === undefined ? {} : { text: args.text }),
          ...(args.alt === undefined ? {} : { alt: args.alt }),
          ...(args.url === undefined ? {} : { source: { type: 'url', url: args.url } }),
        }
        if (args.url !== undefined) {
          const source = previous.data.source
          if (typeof source !== 'object' || source === null || Array.isArray(source)
            || source.type !== 'url' || typeof source.url !== 'string') {
            throw new Error('asset-backed image sources cannot be replaced through leaf updates')
          }
        }
        if (Object.keys(position).length === 0 && Object.keys(style).length === 0 && Object.keys(data).length === 0) {
          throw new Error('canvas_update_node requires at least one changed field')
        }
        const changes = {
          ...(Object.keys(position).length === 0 ? {} : { position }),
          ...(Object.keys(style).length === 0 ? {} : { style }),
          ...(Object.keys(data).length === 0 ? {} : { data }),
        }
        const result = await canvasHost.documents.applyActivePatch({
          ...scope,
          expectedProjectRevision: project.revision,
          expectedActiveCanvasId: document.id,
          expectedRevision: document.revision,
          operations: createDeterministicLeafReplaceOperations(
            pointer('nodes', args.id),
            changes as JsonObject,
          ),
          ...mutationMetadata('canvas_update_node'),
        })
        return mutationResult(result.document, [args.id])
      },
    }))

    register(defineTool({
      name: 'canvas_delete_nodes',
      description: 'Delete one or more Convax Canvas nodes and every edge connected to them.',
      parameters: {
        ids: { type: 'array', required: true, items: { type: 'string' } },
      },
      output: mutationOutput,
      execute: async (args) => {
        if (args.ids.length === 0) throw new Error('canvas_delete_nodes requires at least one id')
        const { project, document } = await readActiveCanvas(canvasHost, scope)
        const nodeIds = [...new Set(args.ids)].sort()
        for (const id of nodeIds) {
          if (document.nodes[id] === undefined) throw new Error(`canvas node not found: ${id}`)
        }
        const selected = new Set(nodeIds)
        const edgeIds = Object.values(document.edges)
          .filter(edge => selected.has(edge.source) || selected.has(edge.target))
          .map(edge => edge.id)
          .sort()
        const operations: CanvasPatchOperation[] = [
          ...edgeIds.map(id => ({ op: 'remove' as const, path: pointer('edges', id) })),
          ...nodeIds.map(id => ({ op: 'remove' as const, path: pointer('nodes', id) })),
        ]
        const result = await canvasHost.documents.applyActivePatch({
          ...scope,
          expectedProjectRevision: project.revision,
          expectedActiveCanvasId: document.id,
          expectedRevision: document.revision,
          operations,
          ...mutationMetadata('canvas_delete_nodes'),
        })
        return mutationResult(result.document, nodeIds)
      },
    }))

    register(defineTool({
      name: 'canvas_connect',
      description: 'Create a directed edge between two existing Convax Canvas nodes.',
      parameters: {
        source: { type: 'string', required: true },
        target: { type: 'string', required: true },
      },
      output: mutationOutput,
      execute: async (args) => {
        const { project, document } = await readActiveCanvas(canvasHost, scope)
        if (document.nodes[args.source] === undefined) throw new Error(`canvas node not found: ${args.source}`)
        if (document.nodes[args.target] === undefined) throw new Error(`canvas node not found: ${args.target}`)
        const id = generatedId('edge')
        const value = {
          id,
          type: COMIC_SEQUENCE_EDGE_TYPE,
          kindVersion: COMIC_BUILTIN_KIND_VERSION,
          source: args.source,
          target: args.target,
          data: { label: '' },
        }
        const result = await canvasHost.documents.applyActivePatch({
          ...scope,
          expectedProjectRevision: project.revision,
          expectedActiveCanvasId: document.id,
          expectedRevision: document.revision,
          operations: [{ op: 'add', path: pointer('edges', id), value }],
          ...mutationMetadata('canvas_connect'),
        })
        return mutationResult(result.document, [id])
      },
    }))
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }

  let active = true
  return () => {
    if (!active) return
    active = false
    for (const dispose of disposers.reverse()) dispose()
  }
}
