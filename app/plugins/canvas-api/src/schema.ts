import { CANVAS_ERROR_CODES, CanvasContractError } from './errors.js'
import {
  CANVAS_SCHEMA_VERSION,
  MAX_CANVAS_DOCUMENT_BYTES,
  MAX_CANVAS_EDGES,
  MAX_CANVAS_JSON_DEPTH,
  MAX_CANVAS_NODES,
  MAX_CANVAS_PROJECT_BYTES,
  MAX_PROJECT_CANVASES,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type CanvasProject,
  type JsonValue,
} from './types.js'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const DOCUMENT_KEYS = ['schemaVersion', 'revision', 'id', 'workspaceId', 'createdAt', 'updatedAt', 'metadata', 'viewport', 'nodes', 'edges'] as const
const PROJECT_KEYS = ['schemaVersion', 'revision', 'id', 'workspaceId', 'createdAt', 'updatedAt', 'metadata', 'activeCanvasId', 'canvases'] as const
const NODE_KEYS = new Set(['id', 'type', 'kindVersion', 'position', 'zIndex', 'style', 'data'])
const EDGE_KEYS = new Set(['id', 'type', 'kindVersion', 'source', 'target', 'sourceHandle', 'targetHandle', 'data'])

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function isJsonValue(value: unknown, ancestors = new Set<object>(), depth = 0): value is JsonValue {
  if (depth > MAX_CANVAS_JSON_DEPTH) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || ancestors.has(value)) return false
  if (!Array.isArray(value) && !isPlainObject(value)) return false

  ancestors.add(value)
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors, depth + 1))
    : Object.entries(value).every(([key, entry]) =>
      !DANGEROUS_KEYS.has(key) && isJsonValue(entry, ancestors, depth + 1))
  ancestors.delete(value)
  return valid
}

function fail(code: keyof typeof CANVAS_ERROR_CODES, message: string): never {
  throw new CanvasContractError(CANVAS_ERROR_CODES[code], message)
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string, code: keyof typeof CANVAS_ERROR_CODES): void {
  const expectedSet = new Set(expected)
  if (Object.keys(value).some((key) => !expectedSet.has(key)) || expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    fail(code, `${label} fields do not match the contract`)
  }
}

function assertIdentifier(value: unknown, label: string, code: keyof typeof CANVAS_ERROR_CODES): asserts value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || DANGEROUS_KEYS.has(value)) fail(code, `Invalid ${label}: ${String(value)}`)
}

export function assertProjectId(value: unknown): asserts value is string {
  assertIdentifier(value, 'project id', 'INVALID_PROJECT_ID')
}

export function assertCanvasId(value: unknown): asserts value is string {
  assertIdentifier(value, 'canvas id', 'INVALID_CANVAS_ID')
}

export function assertWorkspaceId(value: unknown): asserts value is string {
  assertIdentifier(value, 'workspace id', 'INVALID_WORKSPACE_ID')
}

export function assertNodeId(value: unknown): asserts value is string {
  assertIdentifier(value, 'node id', 'INVALID_NODE_ID')
}

export function assertEdgeId(value: unknown): asserts value is string {
  assertIdentifier(value, 'edge id', 'INVALID_EDGE_ID')
}

function assertRevision(value: unknown, label: string, code: keyof typeof CANVAS_ERROR_CODES): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code, `${label} revision must be a non-negative safe integer`)
}

function assertTimestamp(value: unknown, label: string, code: keyof typeof CANVAS_ERROR_CODES): void {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(code, `${label} must be an ISO-8601 UTC timestamp`)
  }
}

function assertMetadata(value: unknown, code: keyof typeof CANVAS_ERROR_CODES): void {
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || typeof value.title !== 'string') {
    fail(code, 'metadata must contain only a string title')
  }
}

function assertJsonByteSize(
  value: unknown,
  maximum: number,
  label: string,
  code: keyof typeof CANVAS_ERROR_CODES,
): void {
  const json = JSON.stringify(value)
  if (new TextEncoder().encode(json).byteLength > maximum) {
    fail(code, `${label} exceeds ${maximum} JSON bytes`)
  }
}

export function assertCanvasNode(value: unknown): asserts value is CanvasNode {
  if (!isPlainObject(value)) fail('INVALID_NODE', 'Node must be a plain object')
  if (Object.keys(value).some((key) => !NODE_KEYS.has(key)) || NODE_KEYS.size !== Object.keys(value).length) {
    fail('INVALID_NODE', 'Node fields do not match the persistent contract')
  }
  assertNodeId(value.id)
  if (typeof value.type !== 'string' || value.type.length === 0) fail('INVALID_NODE', 'Node type must be non-empty')
  if (!Number.isSafeInteger(value.kindVersion) || (value.kindVersion as number) < 1) fail('INVALID_NODE', 'kindVersion must be a positive safe integer')
  if (!isPlainObject(value.position) || Object.keys(value.position).length !== 2 || !Number.isFinite(value.position.x) || !Number.isFinite(value.position.y)) {
    fail('INVALID_NODE', 'position must contain only finite x and y')
  }
  if (!Number.isFinite(value.zIndex)) fail('INVALID_NODE', 'zIndex must be finite')
  if (!isPlainObject(value.style) || !isJsonValue(value.style)) fail('INVALID_JSON_VALUE', 'Node style must be a JSON-safe object')
  if (value.style.width !== undefined && (!Number.isFinite(value.style.width) || (value.style.width as number) < 0)) fail('INVALID_NODE', 'style.width must be non-negative')
  if (value.style.height !== undefined && (!Number.isFinite(value.style.height) || (value.style.height as number) < 0)) fail('INVALID_NODE', 'style.height must be non-negative')
  if (!isPlainObject(value.data) || !isJsonValue(value.data)) fail('INVALID_JSON_VALUE', 'Node data must be a JSON-safe object')
}

export function assertCanvasEdge(value: unknown): asserts value is CanvasEdge {
  if (!isPlainObject(value)) fail('INVALID_EDGE', 'Edge must be a plain object')
  const required = ['id', 'type', 'kindVersion', 'source', 'target', 'data']
  if (Object.keys(value).some((key) => !EDGE_KEYS.has(key)) || required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    fail('INVALID_EDGE', 'Edge fields do not match the persistent contract')
  }
  assertEdgeId(value.id)
  if (typeof value.type !== 'string' || value.type.length === 0) fail('INVALID_EDGE', 'Edge type must be non-empty')
  if (!Number.isSafeInteger(value.kindVersion) || (value.kindVersion as number) < 1) {
    fail('INVALID_EDGE', 'Edge kindVersion must be a positive safe integer')
  }
  assertNodeId(value.source)
  assertNodeId(value.target)
  for (const key of ['sourceHandle', 'targetHandle'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length === 0)) fail('INVALID_EDGE', `${key} must be non-empty when present`)
  }
  if (!isPlainObject(value.data) || !isJsonValue(value.data)) fail('INVALID_JSON_VALUE', 'Edge data must be a JSON-safe object')
}

function assertSupportedSchemaVersion(value: Readonly<Record<string, unknown>>, label: string): void {
  if (Object.prototype.hasOwnProperty.call(value, 'version')
    || (Object.prototype.hasOwnProperty.call(value, 'schemaVersion')
      && value.schemaVersion !== CANVAS_SCHEMA_VERSION)) {
    fail('UNSUPPORTED_SCHEMA_VERSION', `${label} schema is unsupported; expected schemaVersion ${CANVAS_SCHEMA_VERSION}`)
  }
}

export function assertCanvasDocument(value: unknown): asserts value is CanvasDocument {
  if (!isPlainObject(value)) fail('INVALID_DOCUMENT', 'Document must be a plain object')
  assertSupportedSchemaVersion(value, 'Document')
  assertExactKeys(value, DOCUMENT_KEYS, 'Document', 'INVALID_DOCUMENT')
  if (value.schemaVersion !== CANVAS_SCHEMA_VERSION) fail('INVALID_DOCUMENT', `schemaVersion must be ${CANVAS_SCHEMA_VERSION}`)
  assertRevision(value.revision, 'Document', 'INVALID_DOCUMENT')
  assertCanvasId(value.id)
  assertWorkspaceId(value.workspaceId)
  assertTimestamp(value.createdAt, 'createdAt', 'INVALID_DOCUMENT')
  assertTimestamp(value.updatedAt, 'updatedAt', 'INVALID_DOCUMENT')
  assertMetadata(value.metadata, 'INVALID_DOCUMENT')
  if (!isPlainObject(value.viewport) || Object.keys(value.viewport).length !== 3 || !Number.isFinite(value.viewport.x) || !Number.isFinite(value.viewport.y) || !Number.isFinite(value.viewport.zoom) || (value.viewport.zoom as number) <= 0) {
    fail('INVALID_DOCUMENT', 'viewport must contain finite x/y and positive zoom')
  }
  if (!isPlainObject(value.nodes)) fail('INVALID_DOCUMENT', 'nodes must be a node ID map')
  if (Object.keys(value.nodes).length > MAX_CANVAS_NODES) {
    fail('INVALID_DOCUMENT', `nodes must contain at most ${MAX_CANVAS_NODES} entries`)
  }
  for (const [id, node] of Object.entries(value.nodes)) {
    assertNodeId(id)
    assertCanvasNode(node)
    if (node.id !== id) fail('INVALID_NODE', `Node map key ${id} does not match node.id`)
  }
  if (!isPlainObject(value.edges)) fail('INVALID_DOCUMENT', 'edges must be an edge ID map')
  if (Object.keys(value.edges).length > MAX_CANVAS_EDGES) {
    fail('INVALID_DOCUMENT', `edges must contain at most ${MAX_CANVAS_EDGES} entries`)
  }
  for (const [id, edge] of Object.entries(value.edges)) {
    assertEdgeId(id)
    assertCanvasEdge(edge)
    if (edge.id !== id) fail('INVALID_EDGE', `Edge map key ${id} does not match edge.id`)
    if (!Object.prototype.hasOwnProperty.call(value.nodes, edge.source) || !Object.prototype.hasOwnProperty.call(value.nodes, edge.target)) {
      fail('INVALID_EDGE', `Edge ${id} references a missing node`)
    }
  }
  assertJsonByteSize(value, MAX_CANVAS_DOCUMENT_BYTES, 'Document', 'INVALID_DOCUMENT')
}

export function assertCanvasProject(value: unknown): asserts value is CanvasProject {
  if (!isPlainObject(value)) fail('INVALID_PROJECT', 'Project must be a plain object')
  assertSupportedSchemaVersion(value, 'Project')
  assertExactKeys(value, PROJECT_KEYS, 'Project', 'INVALID_PROJECT')
  if (value.schemaVersion !== CANVAS_SCHEMA_VERSION) fail('INVALID_PROJECT', `schemaVersion must be ${CANVAS_SCHEMA_VERSION}`)
  assertRevision(value.revision, 'Project', 'INVALID_PROJECT')
  assertProjectId(value.id)
  assertWorkspaceId(value.workspaceId)
  assertTimestamp(value.createdAt, 'createdAt', 'INVALID_PROJECT')
  assertTimestamp(value.updatedAt, 'updatedAt', 'INVALID_PROJECT')
  assertMetadata(value.metadata, 'INVALID_PROJECT')
  assertCanvasId(value.activeCanvasId)
  if (!isPlainObject(value.canvases)) fail('INVALID_PROJECT', 'canvases must be a canvas ID map')
  const canvasCount = Object.keys(value.canvases).length
  if (canvasCount === 0 || canvasCount > MAX_PROJECT_CANVASES) {
    fail('INVALID_PROJECT', `canvases must contain between 1 and ${MAX_PROJECT_CANVASES} entries`)
  }
  for (const [id, document] of Object.entries(value.canvases)) {
    assertCanvasId(id)
    assertCanvasDocument(document)
    if (document.id !== id) fail('INVALID_PROJECT', `Canvas map key ${id} does not match document.id`)
    if (document.workspaceId !== value.workspaceId) fail('INVALID_PROJECT', `Canvas ${id} belongs to a different workspace`)
  }
  if (!Object.prototype.hasOwnProperty.call(value.canvases, value.activeCanvasId)) {
    fail('INVALID_PROJECT', 'activeCanvasId must reference a canvas in the project')
  }
  assertJsonByteSize(value, MAX_CANVAS_PROJECT_BYTES, 'Project', 'INVALID_PROJECT')
}

export function parseCanvasDocument(value: unknown): CanvasDocument {
  assertCanvasDocument(value)
  return structuredClone(value)
}

export function parseCanvasProject(value: unknown): CanvasProject {
  assertCanvasProject(value)
  return structuredClone(value)
}

export function parseCanvasDocumentJson(json: string): CanvasDocument {
  return parseJsonContract(json, MAX_CANVAS_DOCUMENT_BYTES, 'Document', parseCanvasDocument)
}

export function parseCanvasProjectJson(json: string): CanvasProject {
  return parseJsonContract(json, MAX_CANVAS_PROJECT_BYTES, 'Project', parseCanvasProject)
}

export function serializeCanvasDocument(document: CanvasDocument): string {
  assertCanvasDocument(document)
  return JSON.stringify(document)
}

export function serializeCanvasProject(project: CanvasProject): string {
  assertCanvasProject(project)
  return JSON.stringify(project)
}

function parseJsonContract<T>(
  json: string,
  maximum: number,
  label: string,
  parse: (value: unknown) => T,
): T {
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > maximum) {
    fail(label === 'Project' ? 'INVALID_PROJECT' : 'INVALID_DOCUMENT', `${label} JSON exceeds ${maximum} bytes`)
  }
  try {
    return parse(JSON.parse(json) as unknown)
  } catch (error) {
    if (error instanceof CanvasContractError) throw error
    fail(label === 'Project' ? 'INVALID_PROJECT' : 'INVALID_DOCUMENT', `${label} JSON is invalid`)
  }
}
