import { describe, expect, it } from 'vitest'
import {
  CANVAS_ERROR_CODES,
  CanvasContractError,
  MAX_CANVAS_PATCH_OPERATIONS,
  applyCanvasPatch,
  createDeterministicLeafReplaceOperations,
  createLeafReplaceOperations,
  decodeJsonPointer,
  encodeJsonPointer,
} from '../src/index.ts'
import { createDocument, createEdge, createNode } from './fixtures.ts'

function capture(action: () => unknown): CanvasContractError {
  try {
    action()
    throw new Error('Expected patch to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(CanvasContractError)
    return error as CanvasContractError
  }
}

describe('Canvas patch contract', () => {
  it('adds/removes complete node and edge entities at their ID-map roots', () => {
    const input = createDocument()
    const result = applyCanvasPatch({
      document: input,
      operations: [
        { op: 'add', path: '/nodes/node-c', value: createNode('node-c', 800) },
        { op: 'add', path: '/edges/edge-b-c', value: createEdge('edge-b-c', 'node-b', 'node-c') },
        { op: 'remove', path: '/edges/edge-a-b' },
      ],
    })

    expect(result.applied).toBe(3)
    expect(result.revision).toBe(input.revision)
    expect(result.document.nodes['node-c']?.id).toBe('node-c')
    expect(result.document.edges['edge-b-c']?.target).toBe('node-c')
    expect(result.document.edges['edge-a-b']).toBeUndefined()
    expect(input.nodes['node-c']).toBeUndefined()
  })

  it('supports only existing mutable leaves for metadata, viewport, nodes, and edges', () => {
    const result = applyCanvasPatch({
      document: createDocument(),
      operations: [
        { op: 'replace', path: '/metadata/title', value: 'Revised title' },
        { op: 'replace', path: '/viewport/zoom', value: 1.5 },
        { op: 'replace', path: '/nodes/node-a/position/x', value: 42 },
        { op: 'replace', path: '/nodes/node-a/style/color', value: 'blue' },
        { op: 'replace', path: '/nodes/node-a/data/nested/visible', value: false },
        { op: 'replace', path: '/edges/edge-a-b/data/weight', value: 2 },
      ],
    })

    expect(result.document.metadata.title).toBe('Revised title')
    expect(result.document.viewport.zoom).toBe(1.5)
    expect(result.document.nodes['node-a']?.position.x).toBe(42)
    expect(result.document.nodes['node-a']?.data).toMatchObject({ nested: { visible: false } })
    expect(result.document.edges['edge-a-b']).toMatchObject({ target: 'node-b', data: { weight: 2 } })
  })

  it.each([
    '/schemaVersion',
    '/revision',
    '/id',
    '/workspaceId',
    '/createdAt',
    '/updatedAt',
    '/metadata',
    '/viewport',
    '/nodes/node-a',
    '/nodes/node-a/id',
    '/nodes/node-a/type',
    '/nodes/node-a/kindVersion',
    '/nodes/node-a/data',
    '/edges/edge-a-b',
    '/edges/edge-a-b/id',
    '/edges/edge-a-b/type',
    '/edges/edge-a-b/kindVersion',
    '/edges/edge-a-b/source',
    '/edges/edge-a-b/target',
    '/edges/edge-a-b/data',
  ])('forbids host, identity, and aggregate replacement at %s', (path) => {
    const error = capture(() => applyCanvasPatch({ document: createDocument(), operations: [{ op: 'replace', path, value: 'x' }] }))
    expect(error.code).toBe(CANVAS_ERROR_CODES.PATCH_FORBIDDEN_PATH)
    expect(error.operationIndex).toBe(0)
  })

  it('forbids prototype-pollution pointers in decode, encode, and patch application', () => {
    expect(capture(() => decodeJsonPointer('/nodes/__proto__/data/x')).code).toBe(CANVAS_ERROR_CODES.PATCH_FORBIDDEN_PATH)
    expect(capture(() => encodeJsonPointer(['nodes', 'constructor'])).code).toBe(CANVAS_ERROR_CODES.PATCH_FORBIDDEN_PATH)
    expect(capture(() => applyCanvasPatch({
      document: createDocument(),
      operations: [{ op: 'replace', path: '/nodes/node-a/data/prototype/value', value: true }],
    })).code).toBe(CANVAS_ERROR_CODES.PATCH_FORBIDDEN_PATH)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('is atomic when a later operation fails', () => {
    const input = createDocument()
    const before = structuredClone(input)
    const error = capture(() => applyCanvasPatch({
      document: input,
      operations: [
        { op: 'replace', path: '/metadata/title', value: 'Must not leak' },
        { op: 'remove', path: '/edges/missing' },
      ],
    }))

    expect(error.code).toBe(CANVAS_ERROR_CODES.PATCH_PATH_NOT_FOUND)
    expect(error.operationIndex).toBe(1)
    expect(input).toEqual(before)
  })

  it('atomically rejects a transaction whose final graph has dangling edges', () => {
    const input = createDocument()
    const error = capture(() => applyCanvasPatch({ document: input, operations: [{ op: 'remove', path: '/nodes/node-a' }] }))
    expect(error.code).toBe(CANVAS_ERROR_CODES.INVALID_EDGE)
    expect(input.nodes['node-a']).toBeDefined()
  })

  it('rejects duplicate entities, mismatched IDs, absent leaves, invalid values, and extra operation fields', () => {
    expect(capture(() => applyCanvasPatch({ document: createDocument(), operations: [{ op: 'add', path: '/nodes/node-a', value: createNode('node-a') }] })).code)
      .toBe(CANVAS_ERROR_CODES.PATCH_NODE_ALREADY_EXISTS)
    expect(capture(() => applyCanvasPatch({ document: createDocument(), operations: [{ op: 'add', path: '/edges/edge-a-b', value: createEdge('different') }] })).code)
      .toBe(CANVAS_ERROR_CODES.PATCH_FORBIDDEN_PATH)
    expect(capture(() => applyCanvasPatch({ document: createDocument(), operations: [{ op: 'replace', path: '/nodes/node-a/data/missing', value: 1 }] })).code)
      .toBe(CANVAS_ERROR_CODES.PATCH_PATH_NOT_FOUND)
    expect(capture(() => applyCanvasPatch({ document: createDocument(), operations: [{ op: 'replace', path: '/viewport/x', value: Number.NaN }] })).code)
      .toBe(CANVAS_ERROR_CODES.PATCH_INVALID_OPERATION)
    const malformed = { op: 'remove', path: '/edges/edge-a-b', value: null } as never
    expect(capture(() => applyCanvasPatch({ document: createDocument(), operations: [malformed] })).code)
      .toBe(CANVAS_ERROR_CODES.PATCH_INVALID_OPERATION)
  })

  it('round-trips JSON Pointer escaping and rejects malformed escapes', () => {
    const segments = ['nodes', 'node/a~b', 'data', 'caption/value']
    expect(decodeJsonPointer(encodeJsonPointer(segments))).toEqual(segments)
    expect(capture(() => decodeJsonPointer('not-a-pointer')).code).toBe(CANVAS_ERROR_CODES.PATCH_INVALID_POINTER)
    expect(capture(() => decodeJsonPointer('/bad~2escape')).code).toBe(CANVAS_ERROR_CODES.PATCH_INVALID_POINTER)
  })

  it('bounds patch operation count and JSON Pointer depth', () => {
    const operation = { op: 'replace', path: '/viewport/x', value: 1 } as const
    const tooMany = Array.from({ length: MAX_CANVAS_PATCH_OPERATIONS + 1 }, () => operation)
    expect(capture(() => applyCanvasPatch({ document: createDocument(), operations: tooMany })).code)
      .toBe(CANVAS_ERROR_CODES.PATCH_INVALID_OPERATION)

    const deep = `/${Array.from({ length: 70 }, () => 'nested').join('/')}`
    expect(capture(() => decodeJsonPointer(deep)).code).toBe(CANVAS_ERROR_CODES.PATCH_INVALID_POINTER)
  })

  it('creates deterministic sorted leaf operations, including nested objects and arrays', () => {
    expect(createLeafReplaceOperations('/viewport', { zoom: 2, x: 1 })).toEqual([
      { op: 'replace', path: '/viewport/x', value: 1 },
      { op: 'replace', path: '/viewport/zoom', value: 2 },
    ])
    expect(createDeterministicLeafReplaceOperations('/nodes/node-a/data', {
      zeta: true,
      alpha: { second: 2, first: ['a', 'b'] },
    })).toEqual([
      { op: 'replace', path: '/nodes/node-a/data/alpha/first/0', value: 'a' },
      { op: 'replace', path: '/nodes/node-a/data/alpha/first/1', value: 'b' },
      { op: 'replace', path: '/nodes/node-a/data/alpha/second', value: 2 },
      { op: 'replace', path: '/nodes/node-a/data/zeta', value: true },
    ])
  })
})
