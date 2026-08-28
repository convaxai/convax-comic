import { describe, expect, it } from 'vitest'
import {
  CANVAS_ERROR_CODES,
  CanvasContractError,
  assertCanvasDocument,
  assertCanvasProject,
  isJsonValue,
  parseCanvasDocument,
  parseCanvasDocumentJson,
  parseCanvasProject,
  parseCanvasProjectJson,
  serializeCanvasDocument,
  serializeCanvasProject,
} from '../src/index.ts'
import { createDocument, createProject } from './fixtures.ts'

function expectCode(action: () => unknown, code: string): void {
  try {
    action()
    throw new Error('Expected contract validation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(CanvasContractError)
    expect((error as CanvasContractError).code).toBe(code)
  }
}

describe('Canvas schema', () => {
  it('accepts and clones a strict schema-version 2 document with node and edge maps', () => {
    const input = createDocument()
    assertCanvasDocument(input)
    const parsed = parseCanvasDocument(input)

    expect(parsed).toEqual(input)
    expect(parsed).not.toBe(input)
    expect(parsed.nodes['node-a']).not.toBe(input.nodes['node-a'])
    expect(parsed.edges['edge-a-b']?.source).toBe('node-a')
  })

  it('round-trips owned document and project JSON boundaries', () => {
    const document = createDocument()
    const project = createProject()
    expect(parseCanvasDocumentJson(serializeCanvasDocument(document))).toEqual(document)
    expect(parseCanvasProjectJson(serializeCanvasProject(project))).toEqual(project)
    expectCode(() => parseCanvasProjectJson('{broken'), CANVAS_ERROR_CODES.INVALID_PROJECT)
  })

  it('accepts and clones a multi-canvas project preserving activeCanvasId', () => {
    const input = createProject()
    const second = createDocument()
    second.id = 'canvas-second'
    second.metadata.title = 'Chapter 2'
    input.canvases['canvas-second'] = second

    assertCanvasProject(input)
    const parsed = parseCanvasProject(input)
    expect(Object.keys(parsed.canvases).sort()).toEqual(['canvas-main', 'canvas-second'])
    expect(parsed.activeCanvasId).toBe('canvas-main')
    expect(parsed).not.toBe(input)
  })

  it('reports unsupported persisted versions explicitly and rejects runtime fields', () => {
    const wrongVersion = { ...createDocument(), schemaVersion: 1 }
    expectCode(() => assertCanvasDocument(wrongVersion), CANVAS_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION)
    expectCode(() => parseCanvasProjectJson(JSON.stringify({ version: 1, id: 'legacy' })), CANVAS_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION)

    const runtimeDocument = { ...createDocument(), selectedNodeIds: ['node-a'] }
    expectCode(() => assertCanvasDocument(runtimeDocument), CANVAS_ERROR_CODES.INVALID_DOCUMENT)
  })

  it('rejects runtime node and edge fields', () => {
    const nodeRuntime = createDocument() as unknown as Record<string, unknown>
    const nodes = nodeRuntime.nodes as Record<string, Record<string, unknown>>
    if (nodes['node-a']) nodes['node-a'].selected = true
    expectCode(() => assertCanvasDocument(nodeRuntime), CANVAS_ERROR_CODES.INVALID_NODE)

    const edgeRuntime = createDocument() as unknown as Record<string, unknown>
    const edges = edgeRuntime.edges as Record<string, Record<string, unknown>>
    if (edges['edge-a-b']) edges['edge-a-b'].animated = true
    expectCode(() => assertCanvasDocument(edgeRuntime), CANVAS_ERROR_CODES.INVALID_EDGE)
  })

  it('rejects map-key mismatches and dangling edge endpoints', () => {
    const nodeMismatch = createDocument()
    nodeMismatch.nodes['wrong-key'] = nodeMismatch.nodes['node-a']!
    delete nodeMismatch.nodes['node-a']
    expectCode(() => assertCanvasDocument(nodeMismatch), CANVAS_ERROR_CODES.INVALID_NODE)

    const edgeMismatch = createDocument()
    edgeMismatch.edges['wrong-key'] = edgeMismatch.edges['edge-a-b']!
    delete edgeMismatch.edges['edge-a-b']
    expectCode(() => assertCanvasDocument(edgeMismatch), CANVAS_ERROR_CODES.INVALID_EDGE)

    const dangling = createDocument()
    dangling.edges['edge-a-b']!.target = 'missing-node'
    expectCode(() => assertCanvasDocument(dangling), CANVAS_ERROR_CODES.INVALID_EDGE)
  })

  it('rejects invalid project canvas ownership and active canvas references', () => {
    const wrongWorkspace = createProject()
    wrongWorkspace.canvases['canvas-main']!.workspaceId = 'other-workspace'
    expectCode(() => assertCanvasProject(wrongWorkspace), CANVAS_ERROR_CODES.INVALID_PROJECT)

    const missingActive = createProject()
    missingActive.activeCanvasId = 'canvas-missing'
    expectCode(() => assertCanvasProject(missingActive), CANVAS_ERROR_CODES.INVALID_PROJECT)
  })

  it('rejects cycles, dangerous keys, non-finite numbers, and non-plain objects recursively', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(isJsonValue(cyclic)).toBe(false)

    const dangerous = Object.create(null) as Record<string, unknown>
    dangerous.safe = true
    Object.defineProperty(dangerous, 'constructor', { value: { polluted: true }, enumerable: true })
    expect(isJsonValue(dangerous)).toBe(false)
    expect(isJsonValue({ value: Number.NaN })).toBe(false)
    expect(isJsonValue({ date: new Date() })).toBe(false)

    const document = createDocument()
    document.nodes['node-a']!.data = cyclic as never
    expectCode(() => assertCanvasDocument(document), CANVAS_ERROR_CODES.INVALID_JSON_VALUE)
  })

  it('enforces finite geometry, valid timestamps, and safe identifier syntax', () => {
    const geometry = createDocument()
    geometry.viewport.zoom = 0
    expectCode(() => assertCanvasDocument(geometry), CANVAS_ERROR_CODES.INVALID_DOCUMENT)

    const timestamp = createDocument()
    timestamp.updatedAt = 'yesterday'
    expectCode(() => assertCanvasDocument(timestamp), CANVAS_ERROR_CODES.INVALID_DOCUMENT)

    const identifier = createDocument()
    identifier.id = '__proto__'
    expectCode(() => assertCanvasDocument(identifier), CANVAS_ERROR_CODES.INVALID_CANVAS_ID)

    const dangerousId = createDocument()
    dangerousId.nodes['constructor'] = { ...dangerousId.nodes['node-a']!, id: 'constructor' }
    expectCode(() => assertCanvasDocument(dangerousId), CANVAS_ERROR_CODES.INVALID_NODE_ID)
  })

  it('requires a non-empty project with one active canvas and bounds JSON depth', () => {
    const empty = createProject()
    empty.canvases = {}
    expectCode(() => assertCanvasProject(empty), CANVAS_ERROR_CODES.INVALID_PROJECT)

    let nested: unknown = true
    for (let depth = 0; depth < 70; depth += 1) nested = { nested }
    expect(isJsonValue(nested)).toBe(false)
  })
})
