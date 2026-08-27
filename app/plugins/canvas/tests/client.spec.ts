import { describe, expect, it, vi } from 'vitest'
import {
  CanvasProjectBrowser,
  CanvasWorkbench,
  NewSessionAction,
  WorkbenchAgentPanel,
} from '../src/client/Workbench.tsx'
import { apply } from '../src/client/index.ts'
import type { CanvasWorkspace } from '../src/client/store.ts'
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

const initial = JSON.stringify({
  version: 1,
  id: 'document:test',
  title: 'Test canvas',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
})

const initialWire = {
  revision: 0,
  documentJson: initial,
  activeCanvasId: 'document:test',
  canvases: [{ id: 'document:test', title: 'Test canvas', nodeCount: 0, edgeCount: 0 }],
}

describe('canvas client plugin', () => {
  it('mounts Remote and composes the workbench through recursive panel slots', async () => {
    const registrations: Registration[] = []
    const pending = new Map<string, Array<() => unknown>>()
    const declarations = new Set(['sidebar.workspaces'])
    const injectionDisposers: Array<ReturnType<typeof vi.fn>> = []
    const disposeRemote = vi.fn()
    let injectedCleanup: (() => Promise<void>) | undefined
    let injectedReady = Promise.resolve()
    const remote = {
      $mount: vi.fn(async () => disposeRemote),
      canvas: {
        read: vi.fn(async () => ({ ok: true, value: initialWire })),
        replace: vi.fn(async (documentJson: string) => ({
          ok: true,
          value: { ...initialWire, revision: 1, documentJson },
        })),
        create: vi.fn(async () => ({ ok: true, value: initialWire })),
        select: vi.fn(async () => ({ ok: true, value: initialWire })),
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
          expect(name).toBe('layout')
          expect(service).toBeTypeOf('object')
          return vi.fn()
        },
      },
      async inject(names: readonly string[], callback: (inner: unknown) => Promise<() => Promise<void>>): Promise<void> {
        expect(names).toEqual(['remote.canvas'])
        injectedReady = callback(ctx).then((cleanup) => { injectedCleanup = cleanup })
        await injectedReady
      },
      slots: {
        inject(name: string, callback: () => unknown): () => void {
          let cleanup: unknown
          const run = (): void => { cleanup = callback() }
          if (declarations.has(name)) run()
          else pending.set(name, [...(pending.get(name) ?? []), run])
          const dispose = vi.fn(() => {
            if (typeof cleanup === 'function') cleanup()
          })
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
    expect(registrations).toHaveLength(4)
    expect(registrations[0]?.options.name).toBe('root')
    expect(registrations[0]?.options.children).toEqual({
      sidebar: { kind: 'single', scope: 'root' },
      'workbench.agent': { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    })
    expect(registrations[0]?.component).toBe(CanvasWorkbench)
    expect(registrations[1]?.options.name).toBe('sidebar.workspaces')
    expect(registrations[1]?.component).toBe(CanvasProjectBrowser)
    expect(registrations[2]?.options).toMatchObject({
      name: 'workbench.agent',
      children: {
        conversation: { kind: 'single', scope: 'session-maybe' },
        details: { kind: 'single', scope: 'session' },
        'workbench.agent.header.action': { kind: 'list', scope: 'root' },
      },
    })
    expect(registrations[2]?.component).toBe(WorkbenchAgentPanel)
    expect(registrations[3]?.options).toMatchObject({
      name: 'workbench.agent.header.action',
      id: 'app-canvas-new-session',
      order: 100,
    })
    expect(registrations[3]?.component).toBe(NewSessionAction)

    const workspace = registrations[0]?.options.inject?.().workspace as CanvasWorkspace
    const layout = registrations[0]?.options.inject?.().layout as WorkbenchLayout
    const browserWorkspace = registrations[1]?.options.inject?.().workspace as CanvasWorkspace
    const browserProject = registrations[1]?.options.inject?.().project as { getSnapshot(): { activeCanvasId: string } }
    const startSession = registrations[3]?.options.inject?.().startSession as () => void
    expect(workspace.getSnapshot().document.title).toBe('Test canvas')
    expect(browserWorkspace).toBe(workspace)
    expect(browserProject.getSnapshot().activeCanvasId).toBe('document:test')
    expect(layout.getSnapshot()).toMatchObject({
      sidebarOpen: true,
      sidebarWidth: 280,
      agentOpen: true,
      agentWidth: 380,
      detailsOpen: false,
    })
    layout.openDetails()
    expect(layout.getSnapshot().detailsOpen).toBe(true)
    startSession()
    expect(ctx.workspaces.startSession).toHaveBeenCalledWith('workspace:test')
    await injectedCleanup?.()
    await dispose()
    for (const registration of registrations) expect(registration.dispose).toHaveBeenCalledOnce()
    for (const injectionDispose of injectionDisposers) expect(injectionDispose).toHaveBeenCalledOnce()
    expect(disposeRemote).toHaveBeenCalledOnce()
    expect(() => { workspace.openCanvas() }).toThrow('CanvasWorkspace has been disposed')
  })
})
