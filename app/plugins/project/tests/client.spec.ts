import { describe, expect, it, vi } from 'vitest'
import { ProjectNavigator, ProjectShell, WorkbenchAgentPanel } from '../src/client/components.tsx'
import { apply } from '../src/client/index.ts'

interface Registration {
  readonly options: { readonly name: string; readonly id?: string; readonly children?: Readonly<Record<string, unknown>> }
  readonly component: unknown
  readonly dispose: ReturnType<typeof vi.fn>
}

describe('project Client plugin', () => {
  it('owns root directly, provides the active project scope, and disposes every contribution', async () => {
    const registrations: Registration[] = []
    const declarations = new Set(['sidebar.workspaces'])
    const pending = new Map<string, Array<() => void>>()
    const providers = new Map<string, unknown>()
    const providerDisposers = new Map<string, ReturnType<typeof vi.fn>>()
    let remoteScope = false
    let injectedDispose: (() => void | Promise<void>) | undefined
    const wait = vi.fn((_request: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => {
      const abort = (): void => reject(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    }))
    const projectFiles = {
      open: vi.fn(async () => ({ ok: true, value: { leaseId: 'lease-1', workspaceId: 'workspace-1', sequence: 0 } })),
      list: vi.fn(async () => ({ ok: true, value: { path: '', sequence: 0, entries: [], truncated: false } })),
      wait,
      close: vi.fn(async () => ({ ok: true, value: { closed: true } })),
    }
    const remoteDispose = vi.fn(async () => { await injectedDispose?.() })
    const remote = new Proxy({ $mount: vi.fn(async () => remoteDispose), projectFiles }, {
      get(target, property, receiver) {
        if (property === 'projectFiles' && !remoteScope) throw new Error('remote.projectFiles accessed without inject')
        return Reflect.get(target, property, receiver)
      },
    })
    let scopedContext: unknown
    const injectRemote = vi.fn(async (
      dependencies: readonly string[],
      callback: (scoped: unknown) => unknown,
    ) => {
      expect(dependencies).toEqual(['remote.projectFiles'])
      remoteScope = true
      try {
        injectedDispose = await callback(scopedContext) as (() => void | Promise<void>)
      } finally {
        remoteScope = false
      }
    })
    const provide = (name: string, service: unknown): ReturnType<typeof vi.fn> => {
      providers.set(name, service)
      const dispose = vi.fn(() => { providers.delete(name) })
      providerDisposers.set(name, dispose)
      return dispose
    }
    const ctx = {
      remote,
      inject: injectRemote,
      provide,
      workspaces: {
        list: {
          getSnapshot: () => ({
            items: [{ workspaceId: 'workspace-1', title: 'Project', sessionIds: ['session-1'] }],
            recentWorkspaceId: 'workspace-1',
          }),
          subscribe: () => () => {},
        },
        connectWorkspace: vi.fn(async () => 'session-1'),
        create: vi.fn(),
        pickDirectory: vi.fn(),
      },
      sessions: {
        list: {
          getSnapshot: () => ({ current: 'session-1' }),
          subscribe: () => () => {},
        },
        open: vi.fn(),
      },
      reflect: { provide },
      slots: {
        inject(name: string, callback: () => unknown): () => void {
          let cleanup: unknown
          const activate = (): void => { cleanup = callback() }
          if (declarations.has(name)) activate()
          else pending.set(name, [...(pending.get(name) ?? []), activate])
          return () => { if (typeof cleanup === 'function') cleanup() }
        },
        register(options: Registration['options'], component: unknown): () => void {
          const dispose = vi.fn()
          registrations.push({ options, component, dispose })
          for (const child of Object.keys(options.children ?? {})) {
            declarations.add(child)
            for (const activate of pending.get(child) ?? []) activate()
            pending.delete(child)
          }
          return dispose
        },
      },
    }
    scopedContext = ctx

    const dispose = await apply(ctx as never)
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce())
    expect(injectRemote).toHaveBeenCalledOnce()
    expect(registrations[0]).toMatchObject({ options: { name: 'root' }, component: ProjectShell })
    expect(registrations.some(entry => entry.component === ProjectNavigator)).toBe(true)
    expect(registrations.some(entry => entry.component === WorkbenchAgentPanel)).toBe(true)
    expect(providers.get('comicProject')).toEqual({ workspaceId: 'workspace-1', projectId: 'project:root' })
    expect(providers.has('layout')).toBe(true)

    await dispose()
    for (const registration of registrations) expect(registration.dispose).toHaveBeenCalledOnce()
    expect(providerDisposers.get('comicProject')).toHaveBeenCalledOnce()
    expect(providerDisposers.get('layout')).toHaveBeenCalledOnce()
    expect(remoteDispose).toHaveBeenCalledOnce()
  })
})
