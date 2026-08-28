import { Context } from '@deepseek-ai/cordis'
import {
  CANVAS_ERROR_CODES,
  CANVAS_SCHEMA_VERSION,
  type CanvasClientApi,
  type CanvasDocument,
} from '@convax/canvas-api'
import {
  CanvasStoreRevisionConflict,
  type CanvasStore,
  type CommitCanvasProjectInput,
  type DeleteCanvasProjectInput,
  type StoredCanvasProject,
} from '@convax/canvas-store-api'
import { describe, expect, it } from 'vitest'
import { CanvasRendererRegistry } from '../src/client/renderer-registry.ts'
import { CanvasHostService } from '../src/host/canvas-host-service.ts'
import {
  EXTERNAL_KIND_VERSION,
  EXTERNAL_NODE_TYPE,
  ExternalCanvasHostExtension,
  externalCanvasClientExtension,
} from './fixtures/external-canvas-extension.ts'

class MemoryStore implements CanvasStore {
  row: StoredCanvasProject | undefined
  async list(workspaceId: string) { return this.row?.workspaceId === workspaceId ? [structuredClone(this.row)] : [] }
  async read(workspaceId: string, projectId: string) {
    return this.row?.workspaceId === workspaceId && this.row.projectId === projectId
      ? structuredClone(this.row)
      : undefined
  }
  async initialize(workspaceId: string, projectId: string, projectJson: string) {
    this.row ??= { workspaceId, projectId, revision: 0, projectJson }
    return structuredClone(this.row)
  }
  async commit(input: CommitCanvasProjectInput) {
    if (this.row === undefined) throw new Error('missing row')
    if (this.row.revision !== input.expectedRevision) {
      throw new CanvasStoreRevisionConflict(input.expectedRevision, this.row.revision)
    }
    this.row = { ...this.row, revision: this.row.revision + 1, projectJson: input.projectJson }
    return structuredClone(this.row)
  }
  async delete(input: DeleteCanvasProjectInput) {
    if (this.row === undefined) return false
    if (this.row.revision !== input.expectedRevision) {
      throw new CanvasStoreRevisionConflict(input.expectedRevision, this.row.revision)
    }
    this.row = undefined
    return true
  }
}

const WORKSPACE = 'workspace:external'
const PROJECT = 'project:external'
const CANVAS = 'canvas:external'
const META = { mutationId: 'external-test', source: 'external-extension' } as const

function emptyDocument(): CanvasDocument {
  const timestamp = '2026-08-27T00:00:00.000Z'
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    revision: 0,
    id: CANVAS,
    workspaceId: WORKSPACE,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: { title: 'External' },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: {},
    edges: {},
  }
}

describe('out-of-tree Canvas extension contract', () => {
  it('contributes and fully retracts Host types and Client renderers through public services', async () => {
    const ctx = new Context()
    const host = new CanvasHostService(new MemoryStore())
    ctx.provide('canvasHost', host)
    await host.projects.create({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      canvasId: CANVAS,
      title: 'External',
      ...META,
    })
    const hostExtension = await ctx.plugin(ExternalCanvasHostExtension)
    await host.nodes.create({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      canvasId: CANVAS,
      expectedRevision: 0,
      node: {
        id: 'external-node',
        type: EXTERNAL_NODE_TYPE,
        kindVersion: EXTERNAL_KIND_VERSION,
        position: { x: 1, y: 2 },
        zIndex: 0,
        style: { width: 200, height: 100 },
        data: { label: 'lossless' },
      },
      ...META,
    })
    await hostExtension.dispose()
    await expect(host.documents.applyPatch({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      canvasId: CANVAS,
      expectedRevision: 1,
      operations: [{ op: 'replace', path: '/nodes/external-node/position/x', value: 42 }],
      ...META,
    })).resolves.toMatchObject({ revision: 2 })
    await expect(host.documents.applyPatch({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      canvasId: CANVAS,
      expectedRevision: 2,
      operations: [{ op: 'replace', path: '/nodes/external-node/data/label', value: 'mutated' }],
      ...META,
    })).rejects.toMatchObject({ code: CANVAS_ERROR_CODES.NODE_TYPE_NOT_REGISTERED })

    const renderers = new CanvasRendererRegistry()
    const Renderer = () => null
    const client: CanvasClientApi = {
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      canvasId: CANVAS,
      getSnapshot: emptyDocument,
      refresh: async () => emptyDocument(),
      actions: {} as CanvasClientApi['actions'],
      renderers,
      handleCommittedEvent: () => 'refresh-required',
      subscribe: () => () => {},
    }
    ctx.provide('canvasClient', client)
    const clientExtension = await ctx.plugin(externalCanvasClientExtension(Renderer))
    expect(renderers.hasNode(EXTERNAL_NODE_TYPE, EXTERNAL_KIND_VERSION)).toBe(true)
    expect(renderers.resolveNode(EXTERNAL_NODE_TYPE, EXTERNAL_KIND_VERSION)).toBe(Renderer)
    await clientExtension.dispose()
    expect(renderers.hasNode(EXTERNAL_NODE_TYPE, EXTERNAL_KIND_VERSION)).toBe(false)

    await host.close()
    await ctx.fiber.dispose()
  })
})
