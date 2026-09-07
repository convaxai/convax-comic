import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComicProjectScope, PreviewProjectFileResult, ProjectFileEntry } from '../src/contracts.js'
import { ProjectFilePreviewController } from '../src/client/file-drag-preview.js'

class FakeElement {
  readonly dataset: Record<string, string | undefined> = {}
  readonly children: FakeElement[] = []
  readonly attributes = new Map<string, string>()
  className = ''
  src = ''
  alt = ''
  draggable = true
  removed = false

  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  append(...children: FakeElement[]): void { this.children.push(...children) }
  remove(): void { this.removed = true }
}

class FakeCanvas extends FakeElement {
  width = 0
  height = 0
  readonly drawImage = vi.fn()
  getContext(): { readonly drawImage: (...args: unknown[]) => unknown } { return { drawImage: this.drawImage } }
  toBlob(callback: (blob: Blob | null) => void): void { callback(new Blob(['thumbnail'], { type: 'image/webp' })) }
}

class FakeVideo extends FakeElement {
  muted = false
  preload = ''
  playsInline = false
  duration = 0
  videoWidth = 640
  videoHeight = 360
  currentTime = 0
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'loadeddata') return
    queueMicrotask(() => {
      if (typeof listener === 'function') listener({ type } as Event)
      else listener.handleEvent({ type } as Event)
    })
  }
  removeEventListener(): void {}
  pause(): void {}
  load(): void {}
  removeAttribute(): void {}
}

function entry(name: string): ProjectFileEntry {
  return Object.freeze({ kind: 'file', name, path: `art/${name}`, size: 12, mtimeMs: 1, expandable: false })
}

function scopeWith(previewFile: (path: string, signal: AbortSignal) => Promise<PreviewProjectFileResult>): ComicProjectScope {
  return Object.freeze({
    workspaceId: 'workspace-1',
    projectId: 'project:root',
    readFile: vi.fn(),
    previewFile,
    releasePreview: vi.fn(async () => undefined),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Project file native previews', () => {
  it('downscales real Host-validated image pixels for icons and drag images', async () => {
    const body = new FakeElement()
    vi.stubGlobal('document', {
      body,
      createElement: (tag: string) => tag === 'canvas' ? new FakeCanvas() : new FakeElement(),
    })
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void) => { callback(); return 1 },
    })
    vi.stubGlobal('Image', class {
      decoding = ''
      src = ''
      naturalWidth = 640
      naturalHeight = 480
      async decode(): Promise<void> {}
    })
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:source-image')
      .mockReturnValueOnce('blob:image-thumbnail')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const imageEntry = entry('panel.png')
    const previewFile = vi.fn(async () => ({
      kind: 'image' as const,
      path: imageEntry.path,
      name: imageEntry.name,
      size: 3,
      mimeType: 'image/png',
      dataBase64: 'YWJj',
    }))
    const controller = new ProjectFilePreviewController(() => scopeWith(previewFile))

    controller.preloadMedia([imageEntry])
    await vi.waitFor(() => { expect(controller.getSnapshot().thumbnails[imageEntry.path]).toBe('blob:image-thumbnail') })
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:source-image')

    const setDragImage = vi.fn()
    controller.setDragImage({ setDragImage } as unknown as DataTransfer, imageEntry)
    expect(setDragImage).toHaveBeenCalledOnce()
    const [preview, offsetX, offsetY] = setDragImage.mock.calls[0] as unknown as [FakeElement, number, number]
    expect(preview.children[0]).toMatchObject({ className: 'cvxProjectFileDragPreviewImage', src: 'blob:image-thumbnail' })
    expect([offsetX, offsetY]).toEqual([24, 24])
    expect(preview.removed).toBe(true)

    controller.dispose()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:image-thumbnail')
  })

  it('uses a ranged media lease for video hover and releases it on close', async () => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => tag === 'video' ? new FakeVideo() : tag === 'canvas' ? new FakeCanvas() : new FakeElement(),
    })
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-poster')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const videoEntry = entry('scene.mp4')
    const releasePreview = vi.fn(async () => undefined)
    const scope: ComicProjectScope = Object.freeze({
      workspaceId: 'workspace-1',
      projectId: 'project:root',
      readFile: vi.fn(),
      previewFile: vi.fn(async () => ({
        kind: 'video' as const,
        path: videoEntry.path,
        name: videoEntry.name,
        size: 129_598_824,
        mimeType: 'video/mp4',
        previewId: 'preview-1',
        mediaUrl: '/convax/project-media/preview-1',
      })),
      releasePreview,
    })
    const controller = new ProjectFilePreviewController(() => scope)

    controller.open(videoEntry)
    await vi.waitFor(() => {
      expect(controller.getSnapshot().active).toMatchObject({
        status: 'ready', kind: 'video', url: '/convax/project-media/preview-1',
      })
    })
    controller.close(videoEntry.path)
    await vi.waitFor(() => { expect(releasePreview).toHaveBeenCalledWith('preview-1') })
    controller.dispose()
  })

  it('loads bounded text on hover and does not fabricate unavailable media thumbnails', async () => {
    const textEntry = entry('scene.md')
    const videoEntry = entry('scene.mp4')
    const previewFile = vi.fn(async () => ({
      kind: 'text' as const,
      path: textEntry.path,
      name: textEntry.name,
      size: 5,
      mimeType: 'text/markdown',
      text: 'hello',
    }))
    const controller = new ProjectFilePreviewController(() => scopeWith(previewFile))
    const setDragImage = vi.fn()

    controller.open(textEntry)
    await vi.waitFor(() => { expect(controller.getSnapshot().active).toMatchObject({ status: 'ready', kind: 'text', text: 'hello' }) })
    controller.setDragImage({ setDragImage } as unknown as DataTransfer, videoEntry)

    expect(previewFile).toHaveBeenCalledOnce()
    expect(setDragImage).not.toHaveBeenCalled()
    controller.dispose()
  })
})
