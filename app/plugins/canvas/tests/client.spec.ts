import { CANVAS_SCHEMA_VERSION, type CanvasDocument, type CanvasProject } from '@convax/canvas-api'
import { describe, expect, it, vi } from 'vitest'
import {
  CanvasCenter,
  CanvasProjectCanvases,
} from '../src/client/Workbench.tsx'
import { apply, inject as requiredServices } from '../src/client/index.ts'
import type { ComicCanvasWorkspace } from '../src/client/comic-workspace-v2.ts'
import { CANVAS_REMOTE_V2_CONTRIBUTION } from '../src/remote-v2-contract.ts'

interface Registration {
  readonly options: {
    readonly name: string
    readonly id?: string
    readonly order?: number
    readonly children?: Readonly<Record<string, { readonly kind: string; readonly scope: string }>>
    readonly inject?: () => Record<string, unknown>
  }
  readonly component: unknown
  readonly dispose: ReturnType<typeof vi.fn>
}

const timestamp = '2026-08-27T00:00:00.000Z'
const document: CanvasDocument = {
  schemaVersion: CANVAS_SCHEMA_VERSION,
  revision: 0,
  id: 'canvas:main',
  workspaceId: 'workspace:test',
  createdAt: timestamp,
  updatedAt: timestamp,
  metadata: { title: 'Test canvas' },
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: {},
  edges: {},
}
const project: CanvasProject = {
  schemaVersion: CANVAS_SCHEMA_VERSION,
  revision: 0,
  id: 'project:root',
  workspaceId: 'workspace:test',
  createdAt: timestamp,
  updatedAt: timestamp,
  metadata: { title: 'Test canvas' },
  activeCanvasId: document.id,
  canvases: { [document.id]: document },
}

function success<T>(value: T) {
  return { ok: true as const, value }
}

describe('Canvas V2 Client plugin', () => {
  it('activates before a project scope exists and waits in a child injection', async () => {
    const disposeRemote = vi.fn()
    const injectScope = vi.fn()
    const dispose = await apply({
      remote: { $mount: vi.fn(async () => disposeRemote), canvasV2: {} },
      inject: injectScope,
    } as never)

    expect(requiredServices).toEqual(['slots', 'remote'])
    expect(injectScope).toHaveBeenCalledWith(['remote.canvasV2', 'comicProject'], expect.any(Function))
    await dispose()
    expect(disposeRemote).toHaveBeenCalledOnce()
  })

  it('mounts as project-scoped center and canvas-list contributions', async () => {
    const registrations: Registration[] = []
    const declarations = new Set(['workbench.center', 'project.canvases'])
    const injectionDisposers: Array<ReturnType<typeof vi.fn>> = []
    const provided = new Map<string, unknown>()
    const providerDisposers = new Map<string, ReturnType<typeof vi.fn>>()
    const disposeRemote = vi.fn()
    let injectedCleanup: (() => Promise<void>) | undefined
    let injectedReady = Promise.resolve()
    const waitForRevision = vi.fn((_request: unknown, signal?: AbortSignal) => new Promise((_, reject) => {
      const abort = (): void => reject(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    }))
    const remote = {
      $mount: vi.fn(async () => disposeRemote),
      canvasV2: {
        getProject: vi.fn(async () => success(structuredClone(project))),
        createProject: vi.fn(),
        getDocument: vi.fn(async () => success(structuredClone(document))),
        applyPatch: vi.fn(),
        waitForRevision,
        createDocument: vi.fn(),
        setActiveCanvas: vi.fn(),
      },
    }
    const ctx = {
      remote,
      comicProject: {
        workspaceId: 'workspace:test',
        projectId: 'project:root',
        readFile: vi.fn(),
      },
      provide(name: string, service: unknown): ReturnType<typeof vi.fn> {
        provided.set(name, service)
        const dispose = vi.fn(() => { provided.delete(name) })
        providerDisposers.set(name, dispose)
        return dispose
      },
      reflect: {
        provide(name: string, service: unknown): ReturnType<typeof vi.fn> {
          provided.set(name, service)
          const dispose = vi.fn(() => { provided.delete(name) })
          providerDisposers.set(name, dispose)
          return dispose
        },
      },
      async inject(names: readonly string[], callback: (inner: unknown) => Promise<() => Promise<void>>): Promise<void> {
        expect(names).toEqual(['remote.canvasV2', 'comicProject'])
        injectedReady = callback(ctx).then((cleanup) => { injectedCleanup = cleanup })
        await injectedReady
      },
      slots: {
        inject(name: string, callback: () => unknown): () => void {
          expect(declarations.has(name)).toBe(true)
          const cleanup = callback()
          const dispose = vi.fn(() => { if (typeof cleanup === 'function') cleanup() })
          injectionDisposers.push(dispose)
          return dispose
        },
        register(options: Registration['options'], component: unknown): () => void {
          const dispose = vi.fn()
          registrations.push({ options, component, dispose })
          return dispose
        },
      },
    }

    const dispose = await apply(ctx as never)
    await injectedReady
    expect(remote.$mount).toHaveBeenCalledWith(CANVAS_REMOTE_V2_CONTRIBUTION)
    expect(waitForRevision).toHaveBeenCalledOnce()
    expect(provided.has('canvasClient')).toBe(true)
    expect(registrations).toHaveLength(2)
    expect(registrations[0]?.options.name).toBe('workbench.center')
    expect(registrations[0]?.component).toBe(CanvasCenter)
    expect(registrations[1]?.options.name).toBe('project.canvases')
    expect(registrations[1]?.component).toBe(CanvasProjectCanvases)

    const workspace = registrations[0]?.options.inject?.().workspace as ComicCanvasWorkspace
    const browserProps = registrations[1]?.options.inject?.() as Record<string, unknown>
    const browserWorkspace = browserProps.workspace as ComicCanvasWorkspace
    const browserProject = browserProps.canvasProject as { getSnapshot(): { activeCanvasId: string } }
    expect(browserProps).not.toHaveProperty('project')
    expect(workspace.getSnapshot().document.title).toBe('Test canvas')
    expect(browserWorkspace).toBe(workspace)
    expect(browserProject.getSnapshot().activeCanvasId).toBe('canvas:main')

    await injectedCleanup?.()
    await dispose()
    for (const registration of registrations) expect(registration.dispose).toHaveBeenCalledOnce()
    for (const injectionDispose of injectionDisposers) expect(injectionDispose).toHaveBeenCalledOnce()
    expect(providerDisposers.get('canvasClient')).toHaveBeenCalledOnce()
    expect(disposeRemote).toHaveBeenCalledOnce()
    expect(() => { workspace.openCanvas() }).toThrow('ComicCanvasWorkspace has been disposed')
  })
})
