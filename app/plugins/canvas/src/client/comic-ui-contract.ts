export const CANVAS_DROP_MIME = 'application/vnd.convax.canvas-node.v2+json' as const
const MAX_DROP_BYTES = 64 * 1024

export interface ComicCanvasPoint { readonly x: number; readonly y: number }
export interface ComicCanvasSize { readonly width: number; readonly height: number }
export interface ComicCanvasViewport extends ComicCanvasPoint { readonly zoom: number }
export type ComicCanvasMediaSource =
  | { readonly type: 'asset'; readonly assetId: string }
  | { readonly type: 'url'; readonly url: string }

interface ComicCanvasNodeBase {
  readonly id: string
  readonly position: ComicCanvasPoint
  readonly size: ComicCanvasSize
  readonly title: string
}
export interface ComicCanvasNoteNodeProjection extends ComicCanvasNodeBase {
  readonly kind: 'note'
  readonly text: string
}
export interface ComicCanvasImageNodeProjection extends ComicCanvasNodeBase {
  readonly kind: 'image'
  readonly source: ComicCanvasMediaSource
  readonly alt: string
}
export type ComicCanvasNode = ComicCanvasNoteNodeProjection | ComicCanvasImageNodeProjection
export interface ComicCanvasEdgeProjection {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string
  readonly targetHandle?: string
}
export interface ComicCanvasDocumentProjection {
  readonly id: string
  readonly title: string
  readonly viewport: ComicCanvasViewport
  readonly nodes: readonly ComicCanvasNode[]
  readonly edges: readonly ComicCanvasEdgeProjection[]
}

export type ComicCanvasDropPayload =
  | { readonly kind: 'note'; readonly title: string; readonly text: string }
  | { readonly kind: 'image'; readonly title: string; readonly source: ComicCanvasMediaSource; readonly alt: string }

export type CanvasIdKind = 'asset' | 'document' | 'edge' | 'node'
export type CanvasCreateNodeKind = 'image' | 'note' | 'text'
export interface CanvasSelection { readonly nodeIds: readonly string[]; readonly edgeIds: readonly string[] }
export interface CanvasObjectUrlApi { createObjectURL(file: Blob): string; revokeObjectURL(url: string): void }
export interface CanvasMediaPolicy {
  readonly image: { readonly mimeTypes: readonly string[]; readonly maxBytes: number }
}
export interface CanvasMediaInput { readonly src: string; readonly name?: string; readonly mimeType?: string }
export type CanvasProjectFileContent =
  | {
    readonly kind: 'image'
    readonly path: string
    readonly name: string
    readonly size: number
    readonly mimeType: string
    readonly dataBase64: string
  }
  | {
    readonly kind: 'text'
    readonly path: string
    readonly name: string
    readonly size: number
    readonly mimeType: string
    readonly text: string
  }
export type CanvasProjectFileReader = (path: string, signal: AbortSignal) => Promise<CanvasProjectFileContent>
export interface CanvasCreateNodeInput {
  readonly kind: CanvasCreateNodeKind
  readonly position: ComicCanvasPoint
  readonly size?: ComicCanvasSize
  readonly title?: string
  readonly text?: string
  readonly alt?: string
  readonly source?: ComicCanvasMediaSource
  readonly media?: CanvasMediaInput
}
export interface CanvasUpdateNodePatch {
  readonly title?: string
  readonly text?: string
  readonly alt?: string
  readonly position?: ComicCanvasPoint
  readonly size?: ComicCanvasSize
  readonly source?: ComicCanvasMediaSource
  readonly media?: CanvasMediaInput
}
export interface CanvasMoveNodeInput { readonly id: string; readonly position: ComicCanvasPoint }
export interface CanvasConnectInput {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}
export type CanvasFileCollection = ArrayLike<File> | Iterable<File>
export type CanvasFileErrorCode = 'empty' | 'too-large' | 'unsupported-type' | 'wrong-kind'
export class CanvasFileError extends Error {
  readonly code: CanvasFileErrorCode
  readonly fileName: string
  constructor(code: CanvasFileErrorCode, fileName: string, message: string) {
    super(message)
    this.name = 'CanvasFileError'
    this.code = code
    this.fileName = fileName
  }
}

export function parseCanvasDropPayload(value: unknown): ComicCanvasDropPayload {
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (new TextEncoder().encode(value).byteLength > MAX_DROP_BYTES) throw new TypeError('Canvas drop payload is too large')
    try { parsed = JSON.parse(value) } catch { throw new TypeError('Canvas drop payload is not valid JSON') }
  }
  if (!plain(parsed)) throw new TypeError('Canvas drop payload must be an object')
  const title = text(parsed.title, 'title', 500)
  if (parsed.kind === 'note') {
    exact(parsed, ['kind', 'title', 'text'])
    return { kind: 'note', title, text: text(parsed.text, 'text', 1_000_000) }
  }
  if (parsed.kind === 'image') {
    exact(parsed, ['kind', 'title', 'source', 'alt'])
    return { kind: 'image', title, source: mediaSource(parsed.source), alt: text(parsed.alt, 'alt', 2_000) }
  }
  throw new TypeError('Canvas drop kind must be note or image')
}

function mediaSource(value: unknown): ComicCanvasMediaSource {
  if (!plain(value)) throw new TypeError('Canvas media source must be an object')
  if (value.type === 'asset') {
    exact(value, ['type', 'assetId'])
    return { type: 'asset', assetId: text(value.assetId, 'assetId', 512, false) }
  }
  if (value.type === 'url') {
    exact(value, ['type', 'url'])
    const raw = text(value.url, 'url', 8_192, false)
    let url: URL
    try { url = new URL(raw) } catch { throw new TypeError('Canvas media URL must be absolute') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') {
      throw new TypeError('Canvas media URL must be credential-free HTTP(S)')
    }
    return { type: 'url', url: url.href }
  }
  throw new TypeError('Canvas media source type is unsupported')
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError('Canvas drop payload fields are invalid')
  }
}
function text(value: unknown, label: string, maximum: number, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`Canvas ${label} is invalid`)
  }
  return value
}
