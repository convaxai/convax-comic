import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  CANVAS_SCHEMA_VERSION,
  type CanvasCommittedEvent,
  type CanvasHostApi,
  type CanvasNodeTypeDefinition,
} from '@convax/canvas-api'
import {
  CanvasStoreError,
  CanvasStoreRevisionConflict,
  type CanvasStore,
  type CommitCanvasProjectInput,
  type DeleteCanvasProjectInput,
  type StoredCanvasProject,
} from '@convax/canvas-store-api'
import {
  COMIC_IMAGE_NODE_TYPE,
  COMIC_NOTE_NODE_TYPE,
  COMIC_SEQUENCE_EDGE_TYPE,
  registerComicBuiltinTypes,
} from '@convax/canvas-builtins'
import { describe, expect, it } from 'vitest'
import { CanvasHostService } from '../src/host/canvas-host-service.ts'
import { registerCanvasV2Tools } from '../src/host/v2-tools.ts'

const WORKSPACE = 'workspace-tools'
const PROJECT = 'project-tools'
const CANVAS = 'canvas-main'
const SETUP_MUTATION = { mutationId: 'setup', source: 'tools-v2-test' } as const
const EXPECTED_TOOL_NAMES = [
  'canvas_connect',
  'canvas_create',
  'canvas_create_node',
  'canvas_delete_nodes',
  'canvas_get',
  'canvas_list',
  'canvas_select',
  'canvas_update_node',
]

class MemoryCanvasStore implements CanvasStore {
  readonly rows = new Map<string, StoredCanvasProject>()

  async list(workspaceId: string): Promise<readonly StoredCanvasProject[]> {
    return [...this.rows.values()]
      .filter(row => row.workspaceId === workspaceId)
      .sort((left, right) => left.projectId.localeCompare(right.projectId))
      .map(clone)
  }

  async read(workspaceId: string, projectId: string): Promise<StoredCanvasProject | undefined> {
    const row = this.rows.get(storeKey(workspaceId, projectId))
    return row === undefined ? undefined : clone(row)
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

class FakeToolsRegistry {
  readonly definitions = new Map<string, ToolDefinition>()
  readonly disposed: string[] = []
  failOnName: string | undefined

  register = (definition: ToolDefinition): (() => void) => {
    if (definition.name === this.failOnName) throw new Error(`injected registration failure: ${definition.name}`)
    if (this.definitions.has(definition.name)) throw new Error(`duplicate tool: ${definition.name}`)
    this.definitions.set(definition.name, definition)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.definitions.delete(definition.name)
      this.disposed.push(definition.name)
    }
  }

  async call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const definition = this.definitions.get(name)
    if (definition === undefined) throw new Error(`tool not registered: ${name}`)
    const execution = { signal: new AbortController().signal } as ToolRunContext
    return await definition.execute(args, execution) as T
  }
}

interface Harness {
  readonly host: CanvasHostService
  readonly tools: FakeToolsRegistry
  readonly disposeBuiltins: () => void
  readonly disposeTools: () => void
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

async function harness(tools = new FakeToolsRegistry()): Promise<Harness> {
  const host = new CanvasHostService(new MemoryCanvasStore())
  const disposeBuiltins = registerComicBuiltinTypes(host)
  await host.projects.create({
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    canvasId: CANVAS,
    title: 'Main',
    ...SETUP_MUTATION,
  })
  const ctx = { tools } as unknown as Context
  const disposeTools = registerCanvasV2Tools(ctx, host, { workspaceId: WORKSPACE, projectId: PROJECT })
  return { host, tools, disposeBuiltins, disposeTools }
}

async function disposeHarness(value: Harness): Promise<void> {
  value.disposeTools()
  value.disposeBuiltins()
  await value.host.close()
}

describe('Canvas V2 Agent tools', () => {
  it('registers exactly the eight public names and returns strict V2 project/document map JSON', async () => {
    const value = await harness()
    expect([...value.tools.definitions.keys()].sort()).toEqual(EXPECTED_TOOL_NAMES)
    expect(value.tools.definitions.get('canvas_get')?.parameters).toEqual({ type: 'object', properties: {} })
    expect(value.tools.definitions.get('canvas_create_node')?.parameters).toMatchObject({
      type: 'object',
      properties: { kind: { enum: ['note', 'image'] } },
    })

    const output = await value.tools.call<{
      revision: number
      projectRevision: number
      projectJson: string
      documentJson: string
    }>('canvas_get')
    const project = JSON.parse(output.projectJson) as Record<string, unknown>
    const document = JSON.parse(output.documentJson) as Record<string, unknown>
    expect(project).toMatchObject({
      schemaVersion: CANVAS_SCHEMA_VERSION,
      revision: output.projectRevision,
      id: PROJECT,
      workspaceId: WORKSPACE,
      activeCanvasId: CANVAS,
      canvases: { [CANVAS]: { id: CANVAS } },
    })
    expect(document).toMatchObject({
      schemaVersion: CANVAS_SCHEMA_VERSION,
      revision: output.revision,
      id: CANVAS,
      workspaceId: WORKSPACE,
      nodes: {},
      edges: {},
    })
    expect(Array.isArray(document.nodes)).toBe(false)
    expect(Array.isArray(document.edges)).toBe(false)

    const listed = await value.tools.call<{
      revision: number
      activeCanvasId: string
      canvasCount: number
      canvasesJson: string
    }>('canvas_list')
    expect(listed).toMatchObject({ revision: 0, activeCanvasId: CANVAS, canvasCount: 1 })
    expect(JSON.parse(listed.canvasesJson)).toEqual([{
      id: CANVAS,
      title: 'Main',
      nodeCount: 0,
      edgeCount: 0,
      revision: 0,
    }])
    await disposeHarness(value)
  })

  it('creates and selects multiple V2 canvases through project/document authority', async () => {
    const value = await harness()
    const created = await value.tools.call<{
      revision: number
      activeCanvasId: string
      canvasCount: number
      canvasesJson: string
    }>('canvas_create', { title: 'Chapter 2' })
    expect(created.canvasCount).toBe(2)
    expect(created.activeCanvasId).toMatch(/^canvas:[0-9a-f-]{36}$/)
    expect(created.revision).toBe(1)
    expect(JSON.parse(created.canvasesJson)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: CANVAS, title: 'Main' }),
      expect.objectContaining({ id: created.activeCanvasId, title: 'Chapter 2' }),
    ]))

    const selected = await value.tools.call<{
      revision: number
      activeCanvasId: string
      canvasCount: number
    }>('canvas_select', { canvasId: CANVAS })
    expect(selected).toMatchObject({ revision: 2, activeCanvasId: CANVAS, canvasCount: 2 })
    const project = await value.host.projects.get({ workspaceId: WORKSPACE, projectId: PROJECT })
    expect(project.activeCanvasId).toBe(CANVAS)
    expect(Object.keys(project.canvases)).toHaveLength(2)
    await disposeHarness(value)
  })

  it('creates physical builtin nodes, updates mutable leaves, and connects a sequence edge', async () => {
    const value = await harness()
    const note = await value.tools.call<{ changedIds: string[]; revision: number }>('canvas_create_node', {
      kind: 'note',
      x: 10,
      y: 20,
      title: 'Beat',
      text: 'Dialogue',
    })
    await expect(value.tools.call('canvas_create_node', {
      kind: 'image',
      x: 300,
      y: 20,
      title: 'Missing source',
    })).rejects.toThrow(/require an absolute http\(s\) URL/u)
    const image = await value.tools.call<{ changedIds: string[]; revision: number }>('canvas_create_node', {
      kind: 'image',
      x: 300,
      y: 20,
      title: 'Panel',
      url: 'https://example.test/panel.png',
      alt: 'A comic panel',
    })
    expect(note.changedIds[0]).toMatch(/^node:[0-9a-f-]{36}$/)
    expect(image.changedIds[0]).toMatch(/^node:[0-9a-f-]{36}$/)

    const updated = await value.tools.call<{ revision: number }>('canvas_update_node', {
      id: note.changedIds[0],
      title: 'Opening beat',
      text: 'New dialogue',
      x: 12,
      y: 24,
      width: 300,
      height: 200,
    })
    expect(updated.revision).toBe(3)
    await value.tools.call('canvas_update_node', {
      id: image.changedIds[0],
      url: 'https://example.test/revised.png',
      alt: 'Revised panel',
    })
    const connected = await value.tools.call<{ changedIds: string[]; edgeCount: number }>('canvas_connect', {
      source: note.changedIds[0],
      target: image.changedIds[0],
    })
    expect(connected.changedIds[0]).toMatch(/^edge:[0-9a-f-]{36}$/)
    expect(connected.edgeCount).toBe(1)

    const document = await value.host.documents.get({ workspaceId: WORKSPACE, projectId: PROJECT, canvasId: CANVAS })
    expect(document.nodes[note.changedIds[0]!]).toMatchObject({
      type: COMIC_NOTE_NODE_TYPE,
      kindVersion: 1,
      position: { x: 12, y: 24 },
      style: { width: 300, height: 200 },
      data: { title: 'Opening beat', text: 'New dialogue' },
    })
    expect(document.nodes[image.changedIds[0]!]).toMatchObject({
      type: COMIC_IMAGE_NODE_TYPE,
      data: {
        title: 'Panel',
        source: { type: 'url', url: 'https://example.test/revised.png' },
        alt: 'Revised panel',
      },
    })
    expect(document.edges[connected.changedIds[0]!]).toMatchObject({
      type: COMIC_SEQUENCE_EDGE_TYPE,
      kindVersion: 1,
      source: note.changedIds[0],
      target: image.changedIds[0],
      data: { label: '' },
    })
    await expect(value.tools.call('canvas_update_node', { id: 'missing-node', x: 1 }))
      .rejects.toThrow('canvas node not found')
    await disposeHarness(value)
  })

  it('rejects unknown node updates and deletes nodes plus incident edges in one sorted Patch batch', async () => {
    const value = await harness()
    const first = await value.tools.call<{ changedIds: string[] }>('canvas_create_node', {
      kind: 'note', x: 0, y: 0,
    })
    const second = await value.tools.call<{ changedIds: string[] }>('canvas_create_node', {
      kind: 'note', x: 100, y: 0,
    })
    const third = await value.tools.call<{ changedIds: string[] }>('canvas_create_node', {
      kind: 'note', x: 200, y: 0,
    })
    const firstEdge = await value.tools.call<{ changedIds: string[] }>('canvas_connect', {
      source: first.changedIds[0], target: third.changedIds[0],
    })
    const secondEdge = await value.tools.call<{ changedIds: string[] }>('canvas_connect', {
      source: second.changedIds[0], target: third.changedIds[0],
    })

    const unknownDefinition: CanvasNodeTypeDefinition = {
      type: 'plugin.unknown',
      kindVersion: 1,
      createData: () => ({ value: '' }),
      validateData: (data): data is { value: string } => typeof data === 'object'
        && data !== null
        && !Array.isArray(data)
        && Object.keys(data).length === 1
        && typeof (data as { value?: unknown }).value === 'string',
    }
    const unregisterUnknown = value.host.registerNodeType(unknownDefinition)
    let document = await value.host.documents.get({ workspaceId: WORKSPACE, projectId: PROJECT, canvasId: CANVAS })
    const unknownId = 'node-unknown'
    await value.host.nodes.create({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      canvasId: CANVAS,
      expectedRevision: document.revision,
      node: {
        id: unknownId,
        type: unknownDefinition.type,
        kindVersion: 1,
        position: { x: 0, y: 100 },
        zIndex: 4,
        style: { width: 100, height: 100 },
        data: { value: 'opaque' },
      },
      ...SETUP_MUTATION,
    })
    unregisterUnknown()
    await expect(value.tools.call('canvas_update_node', { id: unknownId, x: 10 }))
      .rejects.toThrow('not mutable by Agent tools')

    const committed: CanvasCommittedEvent[] = []
    const stop = value.host.onCommitted(event => committed.push(event))
    const deleted = await value.tools.call<{ changedIds: string[]; nodeCount: number; edgeCount: number }>(
      'canvas_delete_nodes',
      { ids: [second.changedIds[0], first.changedIds[0]] },
    )
    expect(deleted.changedIds).toEqual([first.changedIds[0], second.changedIds[0]].sort())
    expect(deleted).toMatchObject({ nodeCount: 2, edgeCount: 0 })

    const deletionEvents = committed.filter(event => event.source === 'canvas_delete_nodes')
    expect(deletionEvents).toHaveLength(1)
    const event = deletionEvents[0]!
    expect(event.mutationId).toMatch(/^canvas_delete_nodes:[0-9a-f-]{36}$/)
    const sortedEdges = [firstEdge.changedIds[0]!, secondEdge.changedIds[0]!].sort()
    const sortedNodes = [first.changedIds[0]!, second.changedIds[0]!].sort()
    expect(event.operations).toEqual([
      ...sortedEdges.map(id => ({ op: 'remove', path: `/edges/${id}` })),
      ...sortedNodes.map(id => ({ op: 'remove', path: `/nodes/${id}` })),
    ])

    document = await value.host.documents.get({ workspaceId: WORKSPACE, projectId: PROJECT, canvasId: CANVAS })
    expect(Object.keys(document.nodes).sort()).toEqual([third.changedIds[0], unknownId].sort())
    expect(document.edges).toEqual({})
    stop()
    await disposeHarness(value)
  })

  it('tears down all tools idempotently and rolls back partial registration failures', async () => {
    const value = await harness()
    value.disposeTools()
    value.disposeTools()
    expect(value.tools.definitions.size).toBe(0)
    expect(value.tools.disposed).toEqual([
      'canvas_connect',
      'canvas_delete_nodes',
      'canvas_update_node',
      'canvas_create_node',
      'canvas_select',
      'canvas_create',
      'canvas_list',
      'canvas_get',
    ])
    value.disposeBuiltins()
    await value.host.close()

    const failing = new FakeToolsRegistry()
    failing.failOnName = 'canvas_update_node'
    const host = new CanvasHostService(new MemoryCanvasStore())
    expect(() => registerCanvasV2Tools(
      { tools: failing } as unknown as Context,
      host as CanvasHostApi,
      { workspaceId: WORKSPACE, projectId: PROJECT },
    )).toThrow('injected registration failure')
    expect(failing.definitions.size).toBe(0)
    expect(failing.disposed).toEqual([
      'canvas_create_node',
      'canvas_select',
      'canvas_create',
      'canvas_list',
      'canvas_get',
    ])
    await host.close()
  })
})
