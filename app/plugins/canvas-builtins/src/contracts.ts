import type {
  CanvasEdgeTypeDefinition,
  CanvasNodeTypeDefinition,
  JsonObject,
} from '@convax/canvas-api'

export const COMIC_NOTE_NODE_TYPE = 'comic.note' as const
export const COMIC_IMAGE_NODE_TYPE = 'comic.image' as const
export const COMIC_SEQUENCE_EDGE_TYPE = 'comic.sequence' as const
export const COMIC_BUILTIN_KIND_VERSION = 1 as const

const MAX_TITLE_LENGTH = 256
const MAX_NOTE_TEXT_LENGTH = 100_000
const MAX_ALT_LENGTH = 2_000
const MAX_ASSET_ID_LENGTH = 512
const MAX_URL_LENGTH = 8_192
const MAX_SEQUENCE_LABEL_LENGTH = 512

export interface ComicNoteData extends JsonObject {
  title: string
  text: string
}

export type ComicMediaSource =
  | ({ type: 'asset'; assetId: string } & JsonObject)
  | ({ type: 'url'; url: string } & JsonObject)

export interface ComicImageData extends JsonObject {
  title: string
  source: ComicMediaSource
  alt: string
}

export interface ComicSequenceData extends JsonObject {
  label: string
}

export const comicNoteNodeType: CanvasNodeTypeDefinition<ComicNoteData> = Object.freeze({
  type: COMIC_NOTE_NODE_TYPE,
  kindVersion: COMIC_BUILTIN_KIND_VERSION,
  createData: () => ({ title: '', text: '' }),
  validateData(data: unknown): data is ComicNoteData {
    return exactObject(data, ['title', 'text'])
      && boundedString(data.title, MAX_TITLE_LENGTH)
      && boundedString(data.text, MAX_NOTE_TEXT_LENGTH)
  },
})

export const comicImageNodeType: CanvasNodeTypeDefinition<ComicImageData> = Object.freeze({
  type: COMIC_IMAGE_NODE_TYPE,
  kindVersion: COMIC_BUILTIN_KIND_VERSION,
  createData: (): ComicImageData => ({
    title: '',
    source: { type: 'asset', assetId: 'asset:pending' },
    alt: '',
  }),
  validateData(data: unknown): data is ComicImageData {
    return exactObject(data, ['title', 'source', 'alt'])
      && boundedString(data.title, MAX_TITLE_LENGTH)
      && boundedString(data.alt, MAX_ALT_LENGTH)
      && isMediaSource(data.source)
  },
})

export const comicSequenceEdgeType: CanvasEdgeTypeDefinition<ComicSequenceData> = Object.freeze({
  type: COMIC_SEQUENCE_EDGE_TYPE,
  kindVersion: COMIC_BUILTIN_KIND_VERSION,
  createData: () => ({ label: '' }),
  validateData(data: unknown): data is ComicSequenceData {
    return exactObject(data, ['label']) && boundedString(data.label, MAX_SEQUENCE_LABEL_LENGTH)
  },
})

function isMediaSource(value: unknown): value is ComicMediaSource {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'asset') {
    return exactObject(value, ['type', 'assetId'])
      && boundedString(value.assetId, MAX_ASSET_ID_LENGTH, 1)
  }
  if (value.type !== 'url' || !exactObject(value, ['type', 'url']) || !boundedString(value.url, MAX_URL_LENGTH, 1)) return false
  try {
    const parsed = new URL(value.url)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.username === ''
      && parsed.password === ''
  } catch {
    return false
  }
}

function boundedString(value: unknown, maximum: number, minimum = 0): value is string {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum
}

function exactObject<const Keys extends readonly string[]>(value: unknown, keys: Keys): value is Record<Keys[number], unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
