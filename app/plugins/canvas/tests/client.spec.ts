import { CANVAS_SCHEMA_VERSION, type CanvasDocument, type CanvasProject } from '@convax/canvas-api'
import { describe, expect, it, vi } from 'vitest'
import {
  CanvasProjectBrowser,
  CanvasWorkbench,
  NewSessionAction,
  WorkbenchAgentPanel,
} from '../src/client/Workbench.tsx'
import { apply } from '../src/client/index.ts'
import type { ComicCanvasWorkspace } from '../src/client/comic-workspace-v2.ts'
import type { WorkbenchLayout } from '../src/client/layout.ts'

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
  workspaceId: 'workspace:default',
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
  id: 'project:default',
  workspaceId: 'workspace:default',
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
  it('mounts strict V2 Remote, provides canvasClient, and preserves recursive panel slots', async () => {
    const registrations: Registration[] = []
    const pending = new Map<string, Array<() => unknown>>()
    const declarations = new Set(['sidebar.workspaces'])
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
        getDocument: vi.fn(async () => success(structuredClone(document))),
        applyPatch: vi.fn(),
        waitForRevision,
        createDocument: vi.fn(),
        setActiveCanvas: vi.fn(),
      },
    }
    const ctx = {
      remote,
      workspaces: {
        list: {
          getSnapshot: () => ({
            items: [{ workspaceId: 'workspace:test' }],
            recentWorkspaceId: 'workspace:test',
          }),
        },
        startSession: vi.fn(),
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
        expect(names).toEqual(['remote.canvasV2'])
        injectedReady = callback(ctx).then((cleanup) => { injectedCleanup = cleanup })
        await injectedReady
      },
      slots: {
        inject(name: string, callback: () => unknown): () => void {
          let cleanup: unknown
          const run = (): void => { cleanup = callback() }
          if (declarations.has(name)) run()
          else pending.set(name, [...(pending.get(name) ?? []), run])
          const dispose = vi.fn(() => { if (typeof cleanup === 'function') cleanup() })
          injectionDisposers.push(dispose)
          return dispose
        },
        register(options: Registration['options'], component: unknown): () => void {
          const dispose = vi.fn()
          registrations.push({ options, component, dispose })
          for (const name of Object.keys(options.children ?? {})) {
            declarations.add(name)
            for (const activate of pending.get(name) ?? []) activate()
            pending.delete(name)
          }
          return dispose
        },
      },
    }

    const dispose = await apply(ctx as never)
    await injectedReady
    expect(remote.$mount).toHaveBeenCalledOnce()
    expect(waitForRevision).toHaveBeenCalledOnce()
    expect(provided.has('canvasClient')).toBe(true)
    expect(registrations).toHaveLength(4)
    expect(registrations[0]?.options).toMatchObject({
      name: 'root',
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        'workbench.agent': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    })
    expect(registrations[0]?.component).toBe(CanvasWorkbench)
    expect(registrations[1]?.component).toBe(CanvasProjectBrowser)
    expect(registrations[2]?.component).toBe(WorkbenchAgentPanel)
    expect(registrations[3]?.options).toMatchObject({
      name: 'workbench.agent.header.action',
      id: 'app-canvas-new-session',
      order: 100,
    })
    expect(registrations[3]?.component).toBe(NewSessionAction)

    const workspace = registrations[0]?.options.inject?.().workspace as ComicCanvasWorkspace
    const layout = registrations[0]?.options.inject?.().layout as WorkbenchLayout
    const browserWorkspace = registrations[1]?.options.inject?.().workspace as ComicCanvasWorkspace
    const browserProject = registrations[1]?.options.inject?.().project as { getSnapshot(): { activeCanvasId: string } }
    const startSession = registrations[3]?.options.inject?.().startSession as () => void
    expect(workspace.getSnapshot().document.title).toBe('Test canvas')
    expect(browserWorkspace).toBe(workspace)
    expect(browserProject.getSnapshot().activeCanvasId).toBe('canvas:main')
    layout.openDetails()
    expect(layout.getSnapshot().detailsOpen).toBe(true)
    startSession()
    expect(ctx.workspaces.startSession).toHaveBeenCalledWith('workspace:test')

    await injectedCleanup?.()
    await dispose()
    for (const registration of registrations) expect(registration.dispose).toHaveBeenCalledOnce()
    for (const injectionDispose of injectionDisposers) expect(injectionDispose).toHaveBeenCalledOnce()
    expect(providerDisposers.get('canvasClient')).toHaveBeenCalledOnce()
    expect(providerDisposers.get('layout')).toHaveBeenCalledOnce()
    expect(disposeRemote).toHaveBeenCalledOnce()
    expect(() => { workspace.openCanvas() }).toThrow('ComicCanvasWorkspace has been disposed')
  })
})
