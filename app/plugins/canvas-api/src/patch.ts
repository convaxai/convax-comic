import { CANVAS_ERROR_CODES, CanvasContractError } from './errors.js'
import { assertCanvasDocument, assertCanvasEdge, assertCanvasNode, isJsonValue, isPlainObject } from './schema.js'
import {
  MAX_CANVAS_JSON_DEPTH,
  MAX_CANVAS_PATCH_BYTES,
  MAX_CANVAS_PATCH_OPERATIONS,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from './types.js'

export interface CanvasNodeAddOperation { op: 'add'; path: string; value: CanvasNode }
export interface CanvasEdgeAddOperation { op: 'add'; path: string; value: CanvasEdge }
export type CanvasAddOperation = CanvasNodeAddOperation | CanvasEdgeAddOperation
export interface CanvasRemoveOperation { op: 'remove'; path: string }
export interface CanvasReplaceOperation { op: 'replace'; path: string; value: JsonValue }
export type CanvasPatchOperation = CanvasAddOperation | CanvasRemoveOperation | CanvasReplaceOperation

export interface ApplyCanvasPatchInput {
  document: CanvasDocument
  operations: readonly CanvasPatchOperation[]
}

export interface ApplyCanvasPatchResult {
  document: CanvasDocument
  revision: number
  applied: number
}

const DANGEROUS_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const SCALAR_NODE_FIELDS = new Set(['zIndex'])

function patchFail(code: keyof typeof CANVAS_ERROR_CODES, message: string): never {
  throw new CanvasContractError(CANVAS_ERROR_CODES[code], message)
}

function own(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function decodeJsonPointer(pointer: string): string[] {
  if (typeof pointer !== 'string') patchFail('PATCH_INVALID_POINTER', 'JSON Pointer must be a string')
  if (pointer === '') return []
  if (!pointer.startsWith('/')) patchFail('PATCH_INVALID_POINTER', `Invalid JSON Pointer: ${pointer}`)
  const segments = pointer.slice(1).split('/').map((raw) => {
    if (/~(?:[^01]|$)/.test(raw)) patchFail('PATCH_INVALID_POINTER', `Invalid JSON Pointer escape: ${pointer}`)
    const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (DANGEROUS_SEGMENTS.has(segment)) patchFail('PATCH_FORBIDDEN_PATH', `Forbidden path segment: ${segment}`)
    return segment
  })
  if (segments.length > MAX_CANVAS_JSON_DEPTH) {
    patchFail('PATCH_INVALID_POINTER', `JSON Pointer exceeds ${MAX_CANVAS_JSON_DEPTH} segments`)
  }
  return segments
}

export function encodeJsonPointer(segments: readonly string[]): string {
  if (segments.length > MAX_CANVAS_JSON_DEPTH) {
    patchFail('PATCH_INVALID_POINTER', `JSON Pointer exceeds ${MAX_CANVAS_JSON_DEPTH} segments`)
  }
  for (const segment of segments) {
    if (DANGEROUS_SEGMENTS.has(segment)) patchFail('PATCH_FORBIDDEN_PATH', `Forbidden path segment: ${segment}`)
  }
  return segments.length === 0 ? '' : `/${segments.map((segment) => segment.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`
}

function arrayIndex(segment: string, length: number): number | undefined {
  if (!/^(0|[1-9][0-9]*)$/.test(segment)) return undefined
  const index = Number(segment)
  return Number.isSafeInteger(index) && index < length ? index : undefined
}

function assertMutableLeafPath(segments: readonly string[]): void {
  const root = segments[0]
  if (root === 'metadata') {
    if (segments.length !== 2 || segments[1] !== 'title') patchFail('PATCH_FORBIDDEN_PATH', 'Only metadata.title is mutable')
    return
  }
  if (root === 'viewport') {
    if (segments.length !== 2 || !['x', 'y', 'zoom'].includes(segments[1] ?? '')) patchFail('PATCH_FORBIDDEN_PATH', 'Only viewport leaves are mutable')
    return
  }
  if (root === 'nodes') {
    const field = segments[2]
    if (segments.length < 3 || field === 'id') patchFail('PATCH_FORBIDDEN_PATH', 'Node aggregate and id fields are immutable')
    if (SCALAR_NODE_FIELDS.has(field ?? '')) {
      if (segments.length !== 3) patchFail('PATCH_FORBIDDEN_PATH', 'Scalar node fields are leaves')
      return
    }
    if (field === 'position') {
      if (segments.length !== 4 || !['x', 'y'].includes(segments[3] ?? '')) patchFail('PATCH_FORBIDDEN_PATH', 'Only position x/y leaves are mutable')
      return
    }
    if ((field === 'style' || field === 'data') && segments.length >= 4) return
    patchFail('PATCH_FORBIDDEN_PATH', 'Node path is not mutable')
  }
  if (root === 'edges') {
    const field = segments[2]
    if (segments.length < 3 || field === 'id') patchFail('PATCH_FORBIDDEN_PATH', 'Edge aggregate and id fields are immutable')
    if (field === 'data' && segments.length >= 4) return
    patchFail('PATCH_FORBIDDEN_PATH', 'Edge identity, endpoints, type, and aggregate fields are immutable')
  }
  patchFail('PATCH_FORBIDDEN_PATH', 'Host, identity, and aggregate fields are immutable')
}

function replaceLeaf(document: CanvasDocument, segments: string[], value: JsonValue): void {
  if (!isJsonValue(value)) patchFail('PATCH_INVALID_OPERATION', 'Replacement value must be JSON-safe')
  assertMutableLeafPath(segments)

  let parent: unknown = document
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(parent)) {
      const index = arrayIndex(segment, parent.length)
      if (index === undefined) patchFail('PATCH_PATH_NOT_FOUND', `Missing array path: ${encodeJsonPointer(segments)}`)
      parent = parent[index]
    } else {
      if ((typeof parent !== 'object' || parent === null) || !own(parent, segment)) patchFail('PATCH_PATH_NOT_FOUND', `Missing path: ${encodeJsonPointer(segments)}`)
      parent = (parent as Record<string, unknown>)[segment]
    }
  }

  const leaf = segments.at(-1) ?? ''
  if (Array.isArray(parent)) {
    const index = arrayIndex(leaf, parent.length)
    if (index === undefined) patchFail('PATCH_PATH_NOT_FOUND', `Missing array path: ${encodeJsonPointer(segments)}`)
    parent[index] = structuredClone(value)
  } else {
    if (typeof parent !== 'object' || parent === null || !own(parent, leaf)) patchFail('PATCH_PATH_NOT_FOUND', `Missing path: ${encodeJsonPointer(segments)}`)
    ;(parent as Record<string, JsonValue>)[leaf] = structuredClone(value)
  }
}

function assertOperationShape(operation: unknown): asserts operation is CanvasPatchOperation {
  if (!isPlainObject(operation) || typeof operation.op !== 'string' || typeof operation.path !== 'string') patchFail('PATCH_INVALID_OPERATION', 'Patch operation must contain op and path')
  if (operation.op === 'remove') {
    if (Object.keys(operation).length !== 2) patchFail('PATCH_INVALID_OPERATION', 'remove accepts only op and path')
    return
  }
  if (operation.op === 'add' || operation.op === 'replace') {
    if (Object.keys(operation).length !== 3 || !own(operation, 'value')) patchFail('PATCH_INVALID_OPERATION', `${operation.op} must contain exactly op, path, and value`)
    return
  }
  patchFail('PATCH_INVALID_OPERATION', `Unsupported patch operation: ${operation.op}`)
}

function applyOne(document: CanvasDocument, unknownOperation: unknown): void {
  assertOperationShape(unknownOperation)
  const operation = unknownOperation
  const segments = decodeJsonPointer(operation.path)
  const collection = segments[0]
  const isEntityPath = segments.length === 2 && (collection === 'nodes' || collection === 'edges')

  if ((operation.op === 'add' || operation.op === 'remove') && isEntityPath) {
    const id = segments[1] ?? ''
    const map = collection === 'nodes' ? document.nodes : document.edges
    if (operation.op === 'remove') {
      if (!own(map, id)) patchFail('PATCH_PATH_NOT_FOUND', `Missing ${collection === 'nodes' ? 'node' : 'edge'}: ${id}`)
      delete map[id]
      return
    }
    if (collection === 'nodes') {
      assertCanvasNode(operation.value)
      if (operation.value.id !== id) patchFail('PATCH_FORBIDDEN_PATH', 'Node id must match its map key')
      if (own(document.nodes, id)) patchFail('PATCH_NODE_ALREADY_EXISTS', `Node already exists: ${id}`)
      document.nodes[id] = structuredClone(operation.value)
    } else {
      assertCanvasEdge(operation.value)
      if (operation.value.id !== id) patchFail('PATCH_FORBIDDEN_PATH', 'Edge id must match its map key')
      if (own(document.edges, id)) patchFail('PATCH_EDGE_ALREADY_EXISTS', `Edge already exists: ${id}`)
      document.edges[id] = structuredClone(operation.value)
    }
    return
  }

  if (operation.op !== 'replace') patchFail('PATCH_FORBIDDEN_PATH', 'add/remove are allowed only at /nodes/<id> or /edges/<id>')
  replaceLeaf(document, segments, operation.value)
}

export function applyCanvasPatch(input: ApplyCanvasPatchInput): ApplyCanvasPatchResult {
  assertCanvasDocument(input.document)
  if (!Array.isArray(input.operations)) patchFail('PATCH_INVALID_OPERATION', 'operations must be an array')
  if (input.operations.length > MAX_CANVAS_PATCH_OPERATIONS) {
    patchFail('PATCH_INVALID_OPERATION', `operations must contain at most ${MAX_CANVAS_PATCH_OPERATIONS} entries`)
  }
  let patchJson: string
  try {
    patchJson = JSON.stringify(input.operations)
  } catch {
    patchFail('PATCH_INVALID_OPERATION', 'operations must be JSON serializable')
  }
  if (new TextEncoder().encode(patchJson).byteLength > MAX_CANVAS_PATCH_BYTES) {
    patchFail('PATCH_INVALID_OPERATION', `operations exceed ${MAX_CANVAS_PATCH_BYTES} JSON bytes`)
  }
  const document = structuredClone(input.document)
  for (let index = 0; index < input.operations.length; index += 1) {
    try {
      applyOne(document, input.operations[index])
    } catch (error) {
      if (error instanceof CanvasContractError) throw new CanvasContractError(error.code, error.message, index)
      throw error
    }
  }
  try {
    assertCanvasDocument(document)
  } catch (error) {
    if (error instanceof CanvasContractError) throw new CanvasContractError(error.code, error.message, Math.max(0, input.operations.length - 1))
    throw error
  }
  return { document, revision: document.revision, applied: input.operations.length }
}

function flattenLeaves(segments: readonly string[], value: JsonValue, output: CanvasReplaceOperation[]): void {
  if (value === null || typeof value !== 'object') {
    output.push({ op: 'replace', path: encodeJsonPointer(segments), value })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flattenLeaves([...segments, String(index)], entry, output))
    return
  }
  for (const key of Object.keys(value).sort()) flattenLeaves([...segments, key], value[key] as JsonValue, output)
}

export function createDeterministicLeafReplaceOperations(basePath: string, changes: JsonObject): CanvasReplaceOperation[] {
  const segments = decodeJsonPointer(basePath)
  if (!isJsonValue(changes)) patchFail('PATCH_INVALID_OPERATION', 'changes must be a JSON-safe object')
  const operations: CanvasReplaceOperation[] = []
  flattenLeaves(segments, changes, operations)
  return operations
}

export function createLeafReplaceOperations(basePath: string, changes: Readonly<Record<string, JsonPrimitive>>): CanvasReplaceOperation[] {
  const segments = decodeJsonPointer(basePath)
  return Object.keys(changes).sort().map((key) => ({
    op: 'replace',
    path: encodeJsonPointer([...segments, key]),
    value: structuredClone(changes[key] as JsonPrimitive),
  }))
}
