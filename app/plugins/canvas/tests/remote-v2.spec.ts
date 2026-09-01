import { Context } from '@deepseek-ai/cordis'
import {
  CANVAS_SCHEMA_VERSION,
  type ApplyCanvasPatchRequest,
  type CanvasDocument,
  type CanvasHostApi,
  type CanvasProject,
} from '@convax/canvas-api'
import { describe, expect, it, vi } from 'vitest'
import {
  CANVAS_HOST_TYPERT_V2_CONTRIBUTION,
  CANVAS_REMOTE_V2_DESCRIPTORS,
  CANVAS_REMOTE_V2_REQUEST_SCHEMAS,
  CANVAS_REMOTE_V2_RESULT_SCHEMAS,
} from '../src/remote-v2-contract.ts'
import { CanvasRemoteV2Service, TYPERT_REMOTE_V2 } from '../src/remote-v2.ts'

const timestamp = '2026-08-26T00:00:00.000Z'

function documentFixture(): CanvasDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    revision: 2,
    id: 'canvas-1',
    workspaceId: 'workspace-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: { title: 'Canvas' },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: {
      'node-1': {
        id: 'node-1',
        type: 'comic.note',
        kindVersion: 1,
        position: { x: 10, y: 20 },
        zIndex: 0,
        style: { width: 240, height: 120 },
        data: { text: 'Panel one' },
      },
    },
    edges: {
      'edge-1': {
        id: 'edge-1',
        type: 'comic.sequence',
        kindVersion: 1,
        source: 'node-1',
        target: 'node-1',
        data: { label: 'next' },
      },
    },
  }
}

function projectFixture(): CanvasProject {
  const document = documentFixture()
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    revision: 3,
    id: 'project-1',
    workspaceId: 'workspace-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: { title: 'Project' },
    activeCanvasId: document.id,
    canvases: { [document.id]: document },
  }
}

const metadata = { mutationId: 'mutation-1', source: 'test', originClientId: 'client-1' }
const identity = { workspaceId: 'workspace-1', projectId: 'project-1' }
const documentIdentity = { ...identity, canvasId: 'canvas-1' }
const patchResult = () => ({ document: documentFixture(), revision: 2, applied: 1 })

describe('Canvas Remote V2 contract', () => {
  it('exports one strict canvasV2 descriptor for every flat method', () => {
    const methods = [
      'listProjects', 'createProject', 'getProject', 'setActiveCanvas', 'deleteProject',
      'listDocuments', 'createDocument', 'getDocument', 'renameDocument', 'deleteDocument',
      'applyPatch', 'waitForRevision',
    ]
    const removedWireNames = [
      'canvasV2/createNode', 'canvasV2/updateNode', 'canvasV2/removeNode',
      'canvasV2/createEdge', 'canvasV2/updateEdge', 'canvasV2/removeEdge',
    ]
    const wireNames = CANVAS_REMOTE_V2_DESCRIPTORS.map(
      descriptor => `${descriptor.namespace}/${descriptor.method}`,
    )
    expect(CANVAS_REMOTE_V2_DESCRIPTORS).toHaveLength(12)
    for (const removedWireName of removedWireNames) expect(wireNames).not.toContain(removedWireName)
    expect(CANVAS_REMOTE_V2_DESCRIPTORS.map(descriptor => descriptor.method)).toEqual(methods)
    expect(CANVAS_REMOTE_V2_DESCRIPTORS.map(descriptor => descriptor.id)).toEqual(
      methods.map(method => `@convax/canvas#canvasV2/${method}`),
    )
    expect(TYPERT_REMOTE_V2).toMatchObject({ package: '@convax/canvas' })
    expect(TYPERT_REMOTE_V2.descriptors).toBe(CANVAS_REMOTE_V2_DESCRIPTORS)
    expect(CANVAS_HOST_TYPERT_V2_CONTRIBUTION).toMatchObject({
      package: '@convax/canvas',
      face: 'host',
      schemas: [],
    })
    expect(CANVAS_HOST_TYPERT_V2_CONTRIBUTION.invocations).toBe(CANVAS_REMOTE_V2_DESCRIPTORS)

    for (const descriptor of CANVAS_REMOTE_V2_DESCRIPTORS) {
      expect(descriptor).toMatchObject({
        service: 'canvasRemoteV2',
        namespace: 'canvasV2',
        invocation: { kind: 'direct' },
        parameters: [{ source: 'json', codec: { mode: 'strict' } }],
        result: { mode: 'strict' },
      })
      expect(descriptor.parameters).toHaveLength(1)
      expect(descriptor.parameters[0]?.codec).not.toMatchObject({ mode: 'src-json' })
      expect(descriptor.result).not.toMatchObject({ mode: 'src-json' })
    }
    expect(CANVAS_REMOTE_V2_DESCRIPTORS.find(({ method }) => method === 'waitForRevision')?.cancellation)
      .toEqual({ parameter: 'signal' })
    expect(CANVAS_REMOTE_V2_DESCRIPTORS.filter(descriptor => descriptor.cancellation !== undefined))
      .toHaveLength(1)
  })

  it('strictly rejects extra, malformed, and dangerous boundary data', () => {
    expect(() => CANVAS_REMOTE_V2_REQUEST_SCHEMAS.getDocument.parse({
      ...documentIdentity,
      extra: true,
    })).toThrow()

    expect(() => CANVAS_REMOTE_V2_REQUEST_SCHEMAS.applyPatch.parse({
      ...documentIdentity,
      expectedRevision: 2,
      ...metadata,
      operations: [{
        op: 'add',
        path: '/nodes/node-1',
        value: { ...documentFixture().nodes['node-1'], kindVersion: 0 },
      }],
    })).toThrow()

    const dangerousData = JSON.parse('{"__proto__":{"polluted":true}}') as unknown
    expect(() => CANVAS_REMOTE_V2_REQUEST_SCHEMAS.applyPatch.parse({
      ...documentIdentity,
      expectedRevision: 2,
      ...metadata,
      operations: [{
        op: 'add',
        path: '/nodes/node-1',
        value: { ...documentFixture().nodes['node-1'], data: dangerousData },
      }],
    })).toThrow()

    expect(() => CANVAS_REMOTE_V2_REQUEST_SCHEMAS.applyPatch.parse({
      ...documentIdentity,
      expectedRevision: 2,
      ...metadata,
      operations: [{ op: 'replace', path: '/nodes/node-1/data/payload', value: dangerousData }],
    })).toThrow()

    expect(() => CANVAS_REMOTE_V2_REQUEST_SCHEMAS.applyPatch.parse({
      ...documentIdentity,
      expectedRevision: 2,
      ...metadata,
      operations: [{ op: 'remove', path: '/nodes/__proto__' }],
    })).toThrow()
    expect(() => CANVAS_REMOTE_V2_REQUEST_SCHEMAS.applyPatch.parse({
      ...documentIdentity,
      expectedRevision: 2,
      ...metadata,
      operations: [],
    })).toThrow()
    expect(() => CANVAS_REMOTE_V2_RESULT_SCHEMAS.getProject.parse({
      ...projectFixture(),
      extra: true,
    })).toThrow()
    expect(() => CANVAS_REMOTE_V2_RESULT_SCHEMAS.applyPatch.parse({
      ...patchResult(),
      revision: 99,
    })).toThrow()
  })

  it('accepts exact parser-backed project, document, and patch values', () => {
    const document = documentFixture()
    expect(CANVAS_REMOTE_V2_RESULT_SCHEMAS.getProject.parse(projectFixture())).toEqual(projectFixture())
    expect(CANVAS_REMOTE_V2_RESULT_SCHEMAS.getDocument.parse(document)).toEqual(document)
    expect(() => CANVAS_REMOTE_V2_REQUEST_SCHEMAS.applyPatch.parse({
      ...documentIdentity,
      expectedRevision: 2,
      ...metadata,
      operations: [
        { op: 'add', path: '/nodes/node-1', value: document.nodes['node-1'] },
        { op: 'add', path: '/edges/edge-1', value: document.edges['edge-1'] },
        { op: 'replace', path: '/nodes/node-1/data/text', value: 'Updated' },
      ],
    })).not.toThrow()
  })
})

describe('CanvasRemoteV2Service delegation', () => {
  it('maps every flat method directly to CanvasHostService without owning state', async () => {
    const project = projectFixture()
    const document = documentFixture()
    const results = {
      listProjects: [{ workspaceId: 'workspace-1', projectId: 'project-1', title: 'Project', activeCanvasId: 'canvas-1', revision: 3, createdAt: timestamp, updatedAt: timestamp }],
      createProject: project,
      getProject: project,
      setActiveCanvas: project,
      deleteProject: { ...identity, deleted: true },
      listDocuments: [{ ...documentIdentity, title: 'Canvas', revision: 2, createdAt: timestamp, updatedAt: timestamp }],
      createDocument: document,
      getDocument: document,
      renameDocument: document,
      deleteDocument: { ...documentIdentity, deleted: true },
      applyPatch: patchResult(),
      waitForRevision: { status: 'timeout' as const, revision: 2 },
    }
    const spies = Object.fromEntries(Object.entries(results).map(([name, result]) => [
      name,
      vi.fn(async () => result),
    ])) as Record<keyof typeof results, ReturnType<typeof vi.fn>>
    const host = {
      projects: {
        list: spies.listProjects,
        create: spies.createProject,
        get: spies.getProject,
        setActiveCanvas: spies.setActiveCanvas,
        delete: spies.deleteProject,
      },
      documents: {
        list: spies.listDocuments,
        create: vi.fn(),
        createAndActivate: spies.createDocument,
        get: spies.getDocument,
        rename: spies.renameDocument,
        delete: spies.deleteDocument,
        applyPatch: spies.applyPatch,
        waitForRevision: spies.waitForRevision,
      },
      nodes: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
      edges: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
      registerNodeType: vi.fn(),
      registerEdgeType: vi.fn(),
    } as unknown as CanvasHostApi
    const ctx = new Context()
    ctx.provide('canvasHost', host)
    new CanvasRemoteV2Service(ctx)
    const service = ctx.get('canvasRemoteV2') as CanvasRemoteV2Service
    const signal = new AbortController().signal
    const requests = {
      listProjects: { workspaceId: 'workspace-1' },
      createProject: { ...documentIdentity, title: 'Project', ...metadata },
      getProject: identity,
      setActiveCanvas: { ...documentIdentity, expectedRevision: 3, ...metadata },
      deleteProject: { ...identity, expectedRevision: 3, ...metadata },
      listDocuments: identity,
      createDocument: { ...documentIdentity, title: 'Canvas', expectedProjectRevision: 3, ...metadata },
      getDocument: documentIdentity,
      renameDocument: { ...documentIdentity, expectedRevision: 2, title: 'Renamed', ...metadata },
      deleteDocument: { ...documentIdentity, expectedRevision: 2, ...metadata },
      applyPatch: {
        ...documentIdentity,
        expectedRevision: 2,
        operations: [
          { op: 'add', path: '/nodes/node-1', value: document.nodes['node-1']! },
          { op: 'add', path: '/edges/edge-1', value: document.edges['edge-1']! },
        ],
        ...metadata,
      } satisfies ApplyCanvasPatchRequest,
      waitForRevision: { ...documentIdentity, afterRevision: 2, timeoutMs: 100 },
    }

    try {
      for (const name of Object.keys(requests) as (keyof typeof requests)[]) {
        const args = name === 'waitForRevision' ? [requests[name], signal] : [requests[name]]
        const result = await (service as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[name]!(...args)
        expect(result).toBe(results[name])
        expect(spies[name]).toHaveBeenCalledTimes(1)
        expect(spies[name]).toHaveBeenCalledWith(...args)
      }
      expect(CanvasRemoteV2Service.inject).toEqual(['canvasHost'])
      expect(service.typertRemote).toMatchObject({
        serviceKey: 'canvasRemoteV2',
        namespace: 'canvasV2',
      })

      results.getProject.metadata.title = 'Host changed'
      await expect(service.getProject(identity)).resolves.toHaveProperty('metadata.title', 'Host changed')
      expect(spies.getProject).toHaveBeenCalledTimes(2)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
