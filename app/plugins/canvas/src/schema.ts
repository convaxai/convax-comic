export const CANVAS_DOCUMENT_VERSION = 1 as const
export const CANVAS_PROJECT_VERSION = 1 as const
export const CANVAS_DROP_MIME_V1 = 'application/vnd.convax.canvas-node.v1+json' as const
export const MAX_CANVAS_DOCUMENT_BYTES = 16 * 1024 * 1024
export const MAX_CANVAS_PROJECT_BYTES = 64 * 1024 * 1024
export const MAX_CANVAS_NODES = 5_000
export const MAX_CANVAS_EDGES = 10_000
export const MAX_PROJECT_CANVASES = 256

const MAX_ID_LENGTH = 128
const MAX_TITLE_LENGTH = 500
const MAX_NOTE_LENGTH = 1_000_000
const MAX_DROP_PAYLOAD_BYTES = 64 * 1024
const MAX_COORDINATE = 10_000_000
const MAX_NODE_SIZE = 1_000_000
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u

export interface CanvasPointV1 {
  readonly x: number
  readonly y: number
}

export interface CanvasSizeV1 {
  readonly width: number
  readonly height: number
}

export interface CanvasViewportV1 extends CanvasPointV1 {
  readonly zoom: number
}

export type CanvasMediaSourceV1 =
  | { readonly type: 'asset'; readonly assetId: string }
  | { readonly type: 'url'; readonly url: string }

interface CanvasNodeBaseV1 {
  readonly id: string
  readonly position: CanvasPointV1
  readonly size: CanvasSizeV1
  readonly title: string
}

export interface CanvasNoteNodeV1 extends CanvasNodeBaseV1 {
  readonly kind: 'note'
  readonly text: string
}

export interface CanvasImageNodeV1 extends CanvasNodeBaseV1 {
  readonly kind: 'image'
  readonly source: CanvasMediaSourceV1
  readonly alt: string
}

/** @deprecated Parse-only compatibility for Canvas V1 documents created before Comic removed video. */
export interface CanvasVideoNodeV1 extends CanvasNodeBaseV1 {
  readonly kind: 'video'
  readonly source: CanvasMediaSourceV1
}

export type CanvasNodeV1 = CanvasNoteNodeV1 | CanvasImageNodeV1 | CanvasVideoNodeV1

export interface CanvasEdgeV1 {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string
  readonly targetHandle?: string
}

export interface CanvasDocumentV1 {
  readonly version: typeof CANVAS_DOCUMENT_VERSION
  readonly id: string
  readonly title: string
  readonly viewport: CanvasViewportV1
  readonly nodes: readonly CanvasNodeV1[]
  readonly edges: readonly CanvasEdgeV1[]
}

/** Product-owned project file. Canvas documents remain independently versioned and portable. */
export interface CanvasProjectV1 {
  readonly version: typeof CANVAS_PROJECT_VERSION
  readonly id: string
  readonly activeCanvasId: string
  readonly canvases: readonly CanvasDocumentV1[]
}

export type CanvasDropPayloadV1 =
  | {
      readonly version: typeof CANVAS_DOCUMENT_VERSION
      readonly kind: 'note'
      readonly title: string
      readonly text: string
    }
  | {
      readonly version: typeof CANVAS_DOCUMENT_VERSION
      readonly kind: 'image'
      readonly title: string
      readonly source: CanvasMediaSourceV1
      readonly alt: string
    }
  | {
      /** @deprecated Parse-only compatibility; new Comic drops reject video payloads. */
      readonly version: typeof CANVAS_DOCUMENT_VERSION
      readonly kind: 'video'
      readonly title: string
      readonly source: CanvasMediaSourceV1
    }

export class CanvasSchemaError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'CanvasSchemaError'
    this.path = path
  }
}

function fail(path: string, message: string): never {
  throw new CanvasSchemaError(path, message)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'expected an object')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(path, 'expected a plain JSON object')
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(`${path}.${key}`, 'unknown field')
  }
  for (const key of allowed) {
    if (!(key in value)) fail(`${path}.${key}`, 'missing field')
  }
}

function exactKeysWithOptional(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowedSet = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(`${path}.${key}`, 'unknown field')
  }
  for (const key of required) {
    if (!(key in value)) fail(`${path}.${key}`, 'missing field')
  }
}

function stringValue(value: unknown, path: string, maximum: number, allowEmpty = true): string {
  if (typeof value !== 'string') return fail(path, 'expected a string')
  if (!allowEmpty && value.length === 0) return fail(path, 'must not be empty')
  if (value.length > maximum) return fail(path, `must contain at most ${maximum} characters`)
  return value
}

function identifier(value: unknown, path: string): string {
  const result = stringValue(value, path, MAX_ID_LENGTH, false)
  if (!ID_PATTERN.test(result)) return fail(path, 'contains unsupported characters')
  return result
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, 'expected a finite number')
  return value
}

function point(value: unknown, path: string): CanvasPointV1 {
  const input = record(value, path)
  exactKeys(input, ['x', 'y'], path)
  const x = finiteNumber(input.x, `${path}.x`)
  const y = finiteNumber(input.y, `${path}.y`)
  if (Math.abs(x) > MAX_COORDINATE) return fail(`${path}.x`, 'coordinate is out of range')
  if (Math.abs(y) > MAX_COORDINATE) return fail(`${path}.y`, 'coordinate is out of range')
  return { x, y }
}

function size(value: unknown, path: string): CanvasSizeV1 {
  const input = record(value, path)
  exactKeys(input, ['width', 'height'], path)
  const width = finiteNumber(input.width, `${path}.width`)
  const height = finiteNumber(input.height, `${path}.height`)
  if (width <= 0 || width > MAX_NODE_SIZE) return fail(`${path}.width`, 'must be positive and in range')
  if (height <= 0 || height > MAX_NODE_SIZE) return fail(`${path}.height`, 'must be positive and in range')
  return { width, height }
}

function viewport(value: unknown, path: string): CanvasViewportV1 {
  const input = record(value, path)
  exactKeys(input, ['x', 'y', 'zoom'], path)
  const position = point({ x: input.x, y: input.y }, path)
  const zoom = finiteNumber(input.zoom, `${path}.zoom`)
  if (zoom < 0.05 || zoom > 8) return fail(`${path}.zoom`, 'must be between 0.05 and 8')
  return { ...position, zoom }
}

function httpUrl(value: unknown, path: string): string {
  const input = stringValue(value, path, 16_384, false)
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return fail(path, 'expected an absolute URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return fail(path, 'only http and https URLs are supported')
  }
  if (parsed.username !== '' || parsed.password !== '') return fail(path, 'URL credentials are not supported')
  return parsed.href
}

function mediaSource(value: unknown, path: string): CanvasMediaSourceV1 {
  const input = record(value, path)
  if (input.type === 'asset') {
    exactKeys(input, ['type', 'assetId'], path)
    return { type: 'asset', assetId: identifier(input.assetId, `${path}.assetId`) }
  }
  if (input.type === 'url') {
    exactKeys(input, ['type', 'url'], path)
    return { type: 'url', url: httpUrl(input.url, `${path}.url`) }
  }
  return fail(`${path}.type`, 'expected "asset" or "url"')
}

function node(value: unknown, path: string): CanvasNodeV1 {
  const input = record(value, path)
  const baseKeys = ['id', 'kind', 'position', 'size', 'title'] as const
  const id = identifier(input.id, `${path}.id`)
  const positionValue = point(input.position, `${path}.position`)
  const sizeValue = size(input.size, `${path}.size`)
  const title = stringValue(input.title, `${path}.title`, MAX_TITLE_LENGTH)

  if (input.kind === 'note') {
    exactKeys(input, [...baseKeys, 'text'], path)
    return {
      id,
      kind: 'note',
      position: positionValue,
      size: sizeValue,
      title,
      text: stringValue(input.text, `${path}.text`, MAX_NOTE_LENGTH),
    }
  }
  if (input.kind === 'image') {
    exactKeys(input, [...baseKeys, 'source', 'alt'], path)
    return {
      id,
      kind: 'image',
      position: positionValue,
      size: sizeValue,
      title,
      source: mediaSource(input.source, `${path}.source`),
      alt: stringValue(input.alt, `${path}.alt`, MAX_TITLE_LENGTH),
    }
  }
  if (input.kind === 'video') {
    exactKeys(input, [...baseKeys, 'source'], path)
    return {
      id,
      kind: 'video',
      position: positionValue,
      size: sizeValue,
      title,
      source: mediaSource(input.source, `${path}.source`),
    }
  }
  return fail(`${path}.kind`, 'expected "note", "image", or "video"')
}

function edge(value: unknown, path: string): CanvasEdgeV1 {
  const input = record(value, path)
  exactKeysWithOptional(input, ['id', 'source', 'target'], ['sourceHandle', 'targetHandle'], path)
  const result: {
    id: string
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  } = {
    id: identifier(input.id, `${path}.id`),
    source: identifier(input.source, `${path}.source`),
    target: identifier(input.target, `${path}.target`),
  }
  if ('sourceHandle' in input) {
    result.sourceHandle = identifier(input.sourceHandle, `${path}.sourceHandle`)
  }
  if ('targetHandle' in input) {
    result.targetHandle = identifier(input.targetHandle, `${path}.targetHandle`)
  }
  return result
}

function parseJsonInput(value: unknown, path: string, maximumBytes?: number): unknown {
  if (typeof value !== 'string') return value
  if (maximumBytes !== undefined && new TextEncoder().encode(value).byteLength > maximumBytes) {
    return fail(path, `payload exceeds ${maximumBytes} bytes`)
  }
  try {
    return JSON.parse(value) as unknown
  } catch {
    return fail(path, 'invalid JSON')
  }
}

function parseVersion(value: unknown, path: string): typeof CANVAS_DOCUMENT_VERSION {
  if (value !== CANVAS_DOCUMENT_VERSION) return fail(path, `unsupported version ${String(value)}`)
  return CANVAS_DOCUMENT_VERSION
}

export function parseCanvasDocument(value: unknown): CanvasDocumentV1 {
  const input = record(parseJsonInput(value, '$', MAX_CANVAS_DOCUMENT_BYTES), '$')
  exactKeys(input, ['version', 'id', 'title', 'viewport', 'nodes', 'edges'], '$')
  const version = parseVersion(input.version, '$.version')
  const id = identifier(input.id, '$.id')
  const title = stringValue(input.title, '$.title', MAX_TITLE_LENGTH)
  const viewportValue = viewport(input.viewport, '$.viewport')
  if (!Array.isArray(input.nodes)) return fail('$.nodes', 'expected an array')
  if (!Array.isArray(input.edges)) return fail('$.edges', 'expected an array')
  if (input.nodes.length > MAX_CANVAS_NODES) return fail('$.nodes', `must contain at most ${MAX_CANVAS_NODES} nodes`)
  if (input.edges.length > MAX_CANVAS_EDGES) return fail('$.edges', `must contain at most ${MAX_CANVAS_EDGES} edges`)
  const nodes = input.nodes.map((item, index) => node(item, `$.nodes[${index}]`))
  const edges = input.edges.map((item, index) => edge(item, `$.edges[${index}]`))

  const nodeIds = new Set<string>()
  for (let index = 0; index < nodes.length; index += 1) {
    const current = nodes[index]
    if (current === undefined) continue
    if (nodeIds.has(current.id)) fail(`$.nodes[${index}].id`, 'duplicate node id')
    nodeIds.add(current.id)
  }
  const edgeIds = new Set<string>()
  for (let index = 0; index < edges.length; index += 1) {
    const current = edges[index]
    if (current === undefined) continue
    if (edgeIds.has(current.id)) fail(`$.edges[${index}].id`, 'duplicate edge id')
    edgeIds.add(current.id)
    if (!nodeIds.has(current.source)) fail(`$.edges[${index}].source`, 'references a missing node')
    if (!nodeIds.has(current.target)) fail(`$.edges[${index}].target`, 'references a missing node')
  }

  return { version, id, title, viewport: viewportValue, nodes, edges }
}

export function serializeCanvasDocument(value: CanvasDocumentV1): string {
  return JSON.stringify(parseCanvasDocument(value))
}

export function parseCanvasProject(value: unknown): CanvasProjectV1 {
  const input = record(parseJsonInput(value, '$project', MAX_CANVAS_PROJECT_BYTES), '$project')
  exactKeys(input, ['version', 'id', 'activeCanvasId', 'canvases'], '$project')
  if (input.version !== CANVAS_PROJECT_VERSION) {
    return fail('$project.version', `unsupported version ${String(input.version)}`)
  }
  const id = identifier(input.id, '$project.id')
  const activeCanvasId = identifier(input.activeCanvasId, '$project.activeCanvasId')
  if (!Array.isArray(input.canvases)) return fail('$project.canvases', 'expected an array')
  if (input.canvases.length === 0) return fail('$project.canvases', 'must contain at least one canvas')
  if (input.canvases.length > MAX_PROJECT_CANVASES) {
    return fail('$project.canvases', `must contain at most ${MAX_PROJECT_CANVASES} canvases`)
  }
  const canvases = input.canvases.map((item, index) => {
    try {
      return parseCanvasDocument(item)
    } catch (error) {
      if (error instanceof CanvasSchemaError) {
        return fail(`$project.canvases[${index}]${error.path.slice(1)}`, error.message.replace(/^\$[^:]*:\s*/u, ''))
      }
      throw error
    }
  })
  const canvasIds = new Set<string>()
  for (let index = 0; index < canvases.length; index += 1) {
    const canvas = canvases[index]
    if (canvas === undefined) continue
    if (canvasIds.has(canvas.id)) return fail(`$project.canvases[${index}].id`, 'duplicate canvas id')
    canvasIds.add(canvas.id)
  }
  if (!canvasIds.has(activeCanvasId)) return fail('$project.activeCanvasId', 'references a missing canvas')
  return { version: CANVAS_PROJECT_VERSION, id, activeCanvasId, canvases }
}

export function serializeCanvasProject(value: CanvasProjectV1): string {
  return JSON.stringify(parseCanvasProject(value))
}

export function parseCanvasDropPayload(value: unknown): CanvasDropPayloadV1 {
  const input = record(parseJsonInput(value, '$drop', MAX_DROP_PAYLOAD_BYTES), '$drop')
  parseVersion(input.version, '$drop.version')
  const title = stringValue(input.title, '$drop.title', MAX_TITLE_LENGTH)
  if (input.kind === 'note') {
    exactKeys(input, ['version', 'kind', 'title', 'text'], '$drop')
    return {
      version: CANVAS_DOCUMENT_VERSION,
      kind: 'note',
      title,
      text: stringValue(input.text, '$drop.text', MAX_NOTE_LENGTH),
    }
  }
  if (input.kind === 'image') {
    exactKeys(input, ['version', 'kind', 'title', 'source', 'alt'], '$drop')
    return {
      version: CANVAS_DOCUMENT_VERSION,
      kind: 'image',
      title,
      source: mediaSource(input.source, '$drop.source'),
      alt: stringValue(input.alt, '$drop.alt', MAX_TITLE_LENGTH),
    }
  }
  if (input.kind === 'video') {
    exactKeys(input, ['version', 'kind', 'title', 'source'], '$drop')
    return {
      version: CANVAS_DOCUMENT_VERSION,
      kind: 'video',
      title,
      source: mediaSource(input.source, '$drop.source'),
    }
  }
  return fail('$drop.kind', 'expected "note", "image", or "video"')
}

export function serializeCanvasDropPayload(value: CanvasDropPayloadV1): string {
  return JSON.stringify(parseCanvasDropPayload(value))
}
