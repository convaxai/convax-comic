import type { CanvasObjectUrlApi, CanvasProjectFileReader } from './comic-ui-contract.js'

const PROJECT_FILE_PREFIX = 'project-file:'

function relativePath(path: string): string | undefined {
  if (!path || path.includes('\\') || /[\u0000-\u001f\u007f]/u.test(path)) return undefined
  return path.split('/').some(part => !part || part === '.' || part === '..') ? undefined : path
}

/** Workspace identity is supplied by the owning Canvas, never by the source string. */
export function projectFileAssetId(path: string): string {
  const id = `${PROJECT_FILE_PREFIX}${path}`
  if (relativePath(path) === undefined || id.length > 512) throw new TypeError('Project image path cannot be represented as an asset reference')
  return id
}

export function projectImagePath(source: { type: 'asset'; assetId: string } | { type: 'url'; url: string }): string | undefined {
  if (source.type === 'asset') {
    return source.assetId.startsWith(PROJECT_FILE_PREFIX)
      ? relativePath(source.assetId.slice(PROJECT_FILE_PREFIX.length)) : undefined
  }
  // Legacy locally served images retain their exact workspace-relative pathname.
  // Never infer a path from a title, arbitrary remote URL, query, or credentials.
  try {
    const url = new URL(source.url)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash) return undefined
    const rawPath = /^http:\/\/[^/]+(\/[^?#]*)$/u.exec(source.url)?.[1]
    if (!rawPath) return undefined
    return relativePath(decodeURIComponent(rawPath.slice(1)))
  } catch { return undefined }
}

interface Preview {
  path: string
  abort: AbortController
  state: 'queued' | 'loading' | 'settled'
  url?: string
}

/** Derived, revocable previews only; never mutates persisted Canvas data. */
export class ProjectImagePreviews {
  readonly #entries = new Map<string, Preview>()
  #running = 0
  #disposed = false

  constructor(
    readonly reader: CanvasProjectFileReader,
    readonly objectUrl: CanvasObjectUrlApi,
    readonly changed: () => void,
    readonly maxBytes: number,
    readonly mimeTypes: readonly string[],
  ) {}

  get(key: string): string | undefined { return this.#entries.get(key)?.url }

  sync(sources: ReadonlyMap<string, string>): void {
    if (this.#disposed) return
    for (const [key, entry] of this.#entries) {
      if (sources.get(key) === entry.path) continue
      entry.abort.abort()
      if (entry.url) this.objectUrl.revokeObjectURL(entry.url)
      this.#entries.delete(key)
    }
    for (const [key, path] of sources) {
      if (!this.#entries.has(key)) this.#entries.set(key, { path, abort: new AbortController(), state: 'queued' })
    }
    this.#pump()
  }

  dispose(): void {
    this.sync(new Map())
    this.#disposed = true
  }

  #pump(): void {
    if (this.#disposed) return
    for (const [key, entry] of this.#entries) {
      if (this.#running >= 2) return
      if (entry.state !== 'queued') continue
      entry.state = 'loading'
      this.#running += 1
      void this.#load(key, entry).finally(() => { this.#running -= 1; this.#pump() })
    }
  }

  async #load(key: string, entry: Preview): Promise<void> {
    try {
      const content = await this.reader(entry.path, entry.abort.signal)
      if (entry.abort.signal.aborted || this.#entries.get(key) !== entry) return
      if (content.path !== entry.path || content.kind !== 'image' || content.size <= 0
        || content.size > this.maxBytes || !this.mimeTypes.includes(content.mimeType)
        || content.dataBase64.length > Math.ceil(this.maxBytes / 3) * 4
        || content.dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(content.dataBase64)) return
      const binary = atob(content.dataBase64)
      if (binary.length !== content.size) return
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      entry.url = this.objectUrl.createObjectURL(new Blob([bytes], { type: content.mimeType }))
      this.changed()
    } catch {
      // Missing/unreadable sources remain unavailable; keep the original node intact.
    } finally { entry.state = 'settled' }
  }
}
