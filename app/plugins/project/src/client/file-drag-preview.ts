import type { ComicProjectScope, PreviewProjectFileResult, ProjectFileEntry } from '../contracts.js'
import { projectEntryMediaKind, projectEntryPreviewKind, type ProjectEntryPreviewKind } from './icons.js'

const DRAG_PREVIEW_HOTSPOT = 24
const IMAGE_PRELOAD_CAP = 24
const VIDEO_PRELOAD_CAP = 4
const THUMBNAIL_CACHE_CAP = 32
const THUMBNAIL_CONCURRENCY = 2
const THUMBNAIL_WIDTH = 320
const THUMBNAIL_HEIGHT = 220
const TEXT_PREVIEW_CHARS = 16_000
const VIDEO_POSTER_TIMEOUT_MS = 8_000

type Listener = () => void

export type ProjectFileHoverPreview =
  | { readonly status: 'loading'; readonly path: string; readonly name: string; readonly kind: ProjectEntryPreviewKind }
  | { readonly status: 'error'; readonly path: string; readonly name: string; readonly kind: ProjectEntryPreviewKind; readonly message: string }
  | { readonly status: 'ready'; readonly path: string; readonly name: string; readonly kind: 'image'; readonly url: string }
  | { readonly status: 'ready'; readonly path: string; readonly name: string; readonly kind: 'video'; readonly url: string }
  | { readonly status: 'ready'; readonly path: string; readonly name: string; readonly kind: 'text'; readonly text: string; readonly truncated: boolean }

export interface ProjectFilePreviewSnapshot {
  readonly revision: number
  readonly thumbnails: Readonly<Record<string, string>>
  readonly active?: ProjectFileHoverPreview
}

interface ThumbnailRecord {
  readonly path: string
  readonly url: string
}

function previewKey(workspaceId: string, path: string): string {
  return `${workspaceId}\u0000${path}`
}

function binaryBlob(content: Extract<PreviewProjectFileResult, { kind: 'image' }>): Blob {
  const binary = atob(content.dataBase64)
  if (binary.length !== content.size) throw new TypeError('project preview size does not match its content')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: content.mimeType })
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob === null) reject(new Error('browser could not create a project thumbnail'))
      else resolve(blob)
    }, 'image/webp', 0.84)
  })
}

function thumbnailSize(width: number, height: number): { readonly width: number; readonly height: number } {
  if (!(width > 0) || !(height > 0)) throw new TypeError('project preview has invalid dimensions')
  const scale = Math.min(1, THUMBNAIL_WIDTH / width, THUMBNAIL_HEIGHT / height)
  return Object.freeze({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) })
}

async function imageThumbnailUrl(content: Extract<PreviewProjectFileResult, { kind: 'image' }>): Promise<string> {
  const sourceUrl = URL.createObjectURL(binaryBlob(content))
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = sourceUrl
    await image.decode()
    const size = thumbnailSize(image.naturalWidth, image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('browser could not create a project thumbnail canvas')
    context.drawImage(image, 0, 0, size.width, size.height)
    return URL.createObjectURL(await canvasBlob(canvas))
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function waitForVideo(video: HTMLVideoElement, event: 'loadeddata' | 'seeked', signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { finish(new Error('video preview timed out')) }, VIDEO_POSTER_TIMEOUT_MS)
    const onReady = (): void => { finish() }
    const onError = (): void => { finish(new Error('video preview could not be decoded')) }
    const onAbort = (): void => { finish(signal.reason instanceof Error ? signal.reason : new Error('video preview aborted')) }
    const finish = (error?: Error): void => {
      window.clearTimeout(timeout)
      video.removeEventListener(event, onReady)
      video.removeEventListener('error', onError)
      signal.removeEventListener('abort', onAbort)
      if (error === undefined) resolve()
      else reject(error)
    }
    video.addEventListener(event, onReady, { once: true })
    video.addEventListener('error', onError, { once: true })
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

async function videoPosterUrl(url: string, signal: AbortSignal): Promise<string> {
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.playsInline = true
  video.src = url
  try {
    await waitForVideo(video, 'loadeddata', signal)
    if (Number.isFinite(video.duration) && video.duration > 0.2) {
      video.currentTime = Math.min(0.25, video.duration / 4)
      await waitForVideo(video, 'seeked', signal)
    }
    const size = thumbnailSize(video.videoWidth, video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('browser could not create a video poster canvas')
    context.drawImage(video, 0, 0, size.width, size.height)
    return URL.createObjectURL(await canvasBlob(canvas))
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
}

function createDragPreview(entry: ProjectFileEntry, thumbnailUrl: string): HTMLDivElement {
  const preview = document.createElement('div')
  preview.className = 'cvxProjectFileDragPreview'
  preview.setAttribute('aria-hidden', 'true')
  preview.setAttribute('inert', '')

  const image = document.createElement('img')
  image.className = 'cvxProjectFileDragPreviewImage'
  image.src = thumbnailUrl
  image.alt = ''
  image.draggable = false

  const label = document.createElement('span')
  label.className = 'cvxProjectFileDragPreviewLabel'
  label.textContent = entry.name
  preview.append(image, label)
  return preview
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertPreviewIdentity(content: PreviewProjectFileResult, entry: ProjectFileEntry): void {
  if (content.path !== entry.path || content.name !== entry.name) {
    throw new TypeError('project preview identity does not match the requested file')
  }
}

export class ProjectFilePreviewController {
  readonly #getScope: () => ComicProjectScope | undefined
  readonly #listeners = new Set<Listener>()
  readonly #thumbnails = new Map<string, ThumbnailRecord>()
  readonly #thumbnailLoads = new Map<string, { readonly controller: AbortController; readonly promise: Promise<string | undefined> }>()
  readonly #queuedKeys = new Set<string>()
  readonly #queue: ProjectFileEntry[] = []
  #activeThumbnailLoads = 0
  #activeController: AbortController | undefined
  #activePreviewRelease: (() => void) | undefined
  #activeVersion = 0
  #disposed = false
  #snapshot: ProjectFilePreviewSnapshot = Object.freeze({ revision: 0, thumbnails: Object.freeze({}) })

  constructor(getScope: () => ComicProjectScope | undefined) {
    this.#getScope = getScope
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  readonly getSnapshot = (): ProjectFilePreviewSnapshot => this.#snapshot

  preloadMedia(entries: readonly ProjectFileEntry[]): void {
    if (this.#disposed) return
    const scope = this.#getScope()
    if (scope === undefined) return
    const images = entries.filter(entry => entry.kind === 'file' && projectEntryMediaKind(entry.name) === 'image')
      .slice(0, IMAGE_PRELOAD_CAP)
    const videos = entries.filter(entry => (
      entry.kind === 'file' && projectEntryMediaKind(entry.name) === 'video'
    )).slice(0, VIDEO_PRELOAD_CAP)
    for (const entry of [...images, ...videos]) {
      const key = previewKey(scope.workspaceId, entry.path)
      if (this.#thumbnails.has(key) || this.#thumbnailLoads.has(key) || this.#queuedKeys.has(key)) continue
      this.#queuedKeys.add(key)
      this.#queue.push(entry)
    }
    this.#pumpQueue()
  }

  prime(entry: ProjectFileEntry): void {
    if (projectEntryMediaKind(entry.name) !== undefined) this.preloadMedia([entry])
  }

  open(entry: ProjectFileEntry): void {
    if (this.#disposed || entry.kind !== 'file') return
    const kind = projectEntryPreviewKind(entry.name)
    if (kind === undefined) return
    const scope = this.#getScope()
    if (scope === undefined) return
    const key = previewKey(scope.workspaceId, entry.path)
    const cached = this.#thumbnails.get(key)
    this.#closeActive(false)
    const version = this.#activeVersion
    if (kind === 'image' && cached !== undefined) {
      this.#setActive({ status: 'ready', path: entry.path, name: entry.name, kind, url: cached.url })
      return
    }
    this.#setActive({ status: 'loading', path: entry.path, name: entry.name, kind })
    const controller = new AbortController()
    this.#activeController = controller
    void this.#loadActive(scope, entry, kind, key, version, controller)
  }

  close(path?: string): void {
    if (path !== undefined && this.#snapshot.active?.path !== path) return
    this.#closeActive(true)
  }

  setDragImage(dataTransfer: DataTransfer, entry: ProjectFileEntry): void {
    if (this.#disposed || entry.kind !== 'file' || projectEntryMediaKind(entry.name) === undefined) return
    const scope = this.#getScope()
    if (scope === undefined) return
    const thumbnail = this.#thumbnails.get(previewKey(scope.workspaceId, entry.path))
    if (thumbnail === undefined) return
    const preview = createDragPreview(entry, thumbnail.url)
    document.body.append(preview)
    try {
      dataTransfer.setDragImage(preview, DRAG_PREVIEW_HOTSPOT, DRAG_PREVIEW_HOTSPOT)
    } catch {
      // Fall back to Chromium's native file-tree row drag image.
    } finally {
      window.setTimeout(() => { preview.remove() }, 0)
    }
  }

  reset(): void {
    this.#closeActive(false)
    for (const load of this.#thumbnailLoads.values()) load.controller.abort(new Error('project preview reset'))
    this.#thumbnailLoads.clear()
    this.#queue.length = 0
    this.#queuedKeys.clear()
    for (const thumbnail of this.#thumbnails.values()) URL.revokeObjectURL(thumbnail.url)
    this.#thumbnails.clear()
    this.#publish(undefined)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.reset()
    this.#listeners.clear()
  }

  #pumpQueue(): void {
    while (!this.#disposed && this.#activeThumbnailLoads < THUMBNAIL_CONCURRENCY && this.#queue.length > 0) {
      const entry = this.#queue.shift()!
      const scope = this.#getScope()
      if (scope === undefined) return
      const key = previewKey(scope.workspaceId, entry.path)
      this.#queuedKeys.delete(key)
      this.#activeThumbnailLoads += 1
      void this.#ensureThumbnail(scope, entry, key).finally(() => {
        this.#activeThumbnailLoads = Math.max(0, this.#activeThumbnailLoads - 1)
        this.#pumpQueue()
      })
    }
  }

  #ensureThumbnail(scope: ComicProjectScope, entry: ProjectFileEntry, key: string): Promise<string | undefined> {
    const cached = this.#thumbnails.get(key)
    if (cached !== undefined) return Promise.resolve(cached.url)
    const loading = this.#thumbnailLoads.get(key)
    if (loading !== undefined) return loading.promise
    const controller = new AbortController()
    const promise = this.#loadThumbnail(scope, entry, key, controller).finally(() => {
      if (this.#thumbnailLoads.get(key)?.controller === controller) this.#thumbnailLoads.delete(key)
    })
    this.#thumbnailLoads.set(key, { controller, promise })
    return promise
  }

  async #loadThumbnail(
    scope: ComicProjectScope,
    entry: ProjectFileEntry,
    key: string,
    controller: AbortController,
  ): Promise<string | undefined> {
    let videoPreviewId: string | undefined
    let thumbnailUrl: string | undefined
    try {
      const content = await scope.previewFile(entry.path, controller.signal)
      assertPreviewIdentity(content, entry)
      if (controller.signal.aborted || content.kind === 'text') return undefined
      if (content.kind === 'image') {
        thumbnailUrl = await imageThumbnailUrl(content)
      } else {
        videoPreviewId = content.previewId
        thumbnailUrl = await videoPosterUrl(content.mediaUrl, controller.signal)
      }
      if (controller.signal.aborted || this.#disposed || this.#getScope()?.workspaceId !== scope.workspaceId) return undefined
      this.#storeThumbnail(key, entry.path, thumbnailUrl)
      const stored = thumbnailUrl
      thumbnailUrl = undefined
      return stored
    } catch {
      return undefined
    } finally {
      if (videoPreviewId !== undefined) void scope.releasePreview(videoPreviewId).catch(() => undefined)
      if (thumbnailUrl !== undefined) URL.revokeObjectURL(thumbnailUrl)
    }
  }

  async #loadActive(
    scope: ComicProjectScope,
    entry: ProjectFileEntry,
    kind: ProjectEntryPreviewKind,
    key: string,
    version: number,
    controller: AbortController,
  ): Promise<void> {
    let unclaimedVideoPreviewId: string | undefined
    try {
      if (kind === 'image') {
        const url = await this.#ensureThumbnail(scope, entry, key)
        if (url === undefined) throw new Error('image preview is unavailable')
        if (!this.#activeCurrent(entry.path, version, controller)) return
        this.#setActive({ status: 'ready', path: entry.path, name: entry.name, kind, url })
        return
      }
      const content = await scope.previewFile(entry.path, controller.signal)
      assertPreviewIdentity(content, entry)
      if (content.kind === 'video') unclaimedVideoPreviewId = content.previewId
      if (!this.#activeCurrent(entry.path, version, controller) || content.kind !== kind) return
      if (content.kind === 'text') {
        const truncated = content.text.length > TEXT_PREVIEW_CHARS
        this.#setActive({
          status: 'ready', path: entry.path, name: entry.name, kind: 'text',
          text: truncated ? `${content.text.slice(0, TEXT_PREVIEW_CHARS)}\n…` : content.text,
          truncated,
        })
        return
      }
      if (content.kind !== 'video') throw new Error('video preview is unavailable')
      const previewId = content.previewId
      this.#activePreviewRelease = () => { void scope.releasePreview(previewId).catch(() => undefined) }
      unclaimedVideoPreviewId = undefined
      this.#setActive({ status: 'ready', path: entry.path, name: entry.name, kind: 'video', url: content.mediaUrl })
      try {
        const posterUrl = await videoPosterUrl(content.mediaUrl, controller.signal)
        if (!this.#activeCurrent(entry.path, version, controller)) {
          URL.revokeObjectURL(posterUrl)
          return
        }
        this.#storeThumbnail(key, entry.path, posterUrl)
      } catch {
        // The video can still play even when a poster frame cannot be extracted.
      }
    } catch (error) {
      if (this.#activeCurrent(entry.path, version, controller)) {
        this.#setActive({ status: 'error', path: entry.path, name: entry.name, kind, message: errorMessage(error) })
      }
    } finally {
      if (unclaimedVideoPreviewId !== undefined) void scope.releasePreview(unclaimedVideoPreviewId).catch(() => undefined)
      if (this.#activeController === controller) this.#activeController = undefined
    }
  }

  #activeCurrent(path: string, version: number, controller: AbortController): boolean {
    return !this.#disposed
      && !controller.signal.aborted
      && this.#activeVersion === version
      && this.#activeController === controller
      && this.#snapshot.active?.path === path
  }

  #storeThumbnail(key: string, path: string, url: string): void {
    const previous = this.#thumbnails.get(key)
    if (previous !== undefined) URL.revokeObjectURL(previous.url)
    this.#thumbnails.delete(key)
    this.#thumbnails.set(key, { path, url })
    while (this.#thumbnails.size > THUMBNAIL_CACHE_CAP) {
      const activePath = this.#snapshot.active?.path
      const oldestKey = [...this.#thumbnails].find(([, record]) => record.path !== activePath)?.[0]
      if (oldestKey === undefined) break
      const oldest = this.#thumbnails.get(oldestKey)
      this.#thumbnails.delete(oldestKey)
      if (oldest !== undefined) URL.revokeObjectURL(oldest.url)
    }
    this.#publish(this.#snapshot.active)
  }

  #closeActive(publish: boolean): void {
    this.#activeVersion += 1
    this.#activeController?.abort(new Error('project hover preview closed'))
    this.#activeController = undefined
    this.#activePreviewRelease?.()
    this.#activePreviewRelease = undefined
    if (publish) this.#publish(undefined)
  }

  #setActive(active: ProjectFileHoverPreview): void {
    this.#publish(active)
  }

  #publish(active: ProjectFileHoverPreview | undefined): void {
    const thumbnails = Object.freeze(Object.fromEntries(
      [...this.#thumbnails.values()].map(thumbnail => [thumbnail.path, thumbnail.url]),
    ))
    this.#snapshot = Object.freeze({
      revision: this.#snapshot.revision + 1,
      thumbnails,
      ...(active === undefined ? {} : { active }),
    })
    for (const listener of this.#listeners) listener()
  }
}
