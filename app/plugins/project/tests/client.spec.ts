import { describe, expect, it, vi } from 'vitest'
import { ProjectNavigator, ProjectShell, WorkbenchAgentPanel } from '../src/client/components.tsx'
import { apply } from '../src/client/index.ts'
import { PROJECT_FILES_REMOTE_CONTRIBUTION } from '../src/remote-contract.ts'

interface Registration {
  readonly options: {
    readonly name: string
    readonly id?: string
    readonly priority?: number
    readonly children?: Readonly<Record<string, unknown>>
    readonly inject?: () => Record<string, unknown>
  }
  readonly component: unknown
  readonly dispose: ReturnType<typeof vi.fn>
}

function observable<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    store: {
      getSnapshot: () => snapshot,
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    set(next: T) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

describe('project Client plugin', () => {
  it('owns root directly, provides the active project scope, and disposes every contribution', async () => {
    const registrations: Registration[] = []
    const declarations = new Set(['sidebar.workspaces'])
    const pending = new Map<string, Array<() => void>>()
    const providers = new Map<string, unknown>()
    const providerDisposers = new Map<string, ReturnType<typeof vi.fn>>()
    const scopeDisposers: Array<ReturnType<typeof vi.fn>> = []
    const workspaceFeed = observable({
      items: [{ workspaceId: 'workspace-1', title: 'Project', sessionIds: ['session-1'] }],
      phase: 'ready',
      recentWorkspaceId: 'workspace-1' as string | undefined,
    })
    const sessionFeed = observable({ current: 'session-1' as string | undefined })
    let remoteScope = false
    let injectedDispose: (() => void | Promise<void>) | undefined
    const wait = vi.fn((_request: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => {
      const abort = (): void => reject(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    }))
    const projectFiles = {
      open: vi.fn(async ({ workspaceId }: { readonly workspaceId: string }) => ({
        ok: true,
        value: { leaseId: `lease:${workspaceId}`, workspaceId, sequence: 0 },
      })),
      list: vi.fn(async () => ({ ok: true, value: { path: '', sequence: 0, entries: [], truncated: false } })),
      read: vi.fn(async ({ path }: { readonly path: string }) => ({
        ok: true,
        value: { kind: 'text', path, name: 'README.md', size: 2, mimeType: 'text/markdown', text: 'hi' },
      })),
      preview: vi.fn(async ({ path }: { readonly path: string }) => ({
        ok: true,
        value: { kind: 'text', path, name: 'README.md', size: 2, mimeType: 'text/markdown', text: 'hi' },
      })),
      releasePreview: vi.fn(async () => ({ ok: true, value: { released: true } })),
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
      const dispose = vi.fn(() => {
        if (providers.get(name) === service) providers.delete(name)
      })
      providerDisposers.set(name, dispose)
      if (name === 'comicProject') scopeDisposers.push(dispose)
      return dispose
    }
    const ctx = {
      remote,
      inject: injectRemote,
      provide,
      workspaces: {
        list: workspaceFeed.store,
        create: vi.fn(),
      },
      uiWorkspace: {
        connectWorkspace: vi.fn(async () => 'session-1'),
        pickDirectory: vi.fn(),
      },
      sessions: {
        list: sessionFeed.store,
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
    expect(remote.$mount).toHaveBeenCalledWith(PROJECT_FILES_REMOTE_CONTRIBUTION)
    expect(injectRemote).toHaveBeenCalledOnce()
    expect(registrations[0]).toMatchObject({ options: { name: 'root' }, component: ProjectShell })
    expect(registrations[0]?.options.inject?.()).toMatchObject({
      runtime: expect.any(Object),
      layout: expect.any(Object),
      sessions: ctx.sessions,
    })
    expect(registrations.find(entry => entry.component === ProjectNavigator)?.options).toMatchObject({
      name: 'sidebar.workspaces', priority: -100,
    })
    const agentRegistration = registrations.find(entry => entry.component === WorkbenchAgentPanel)
    expect(agentRegistration).toBeDefined()
    expect(agentRegistration?.options.children).toMatchObject({
      conversation: { kind: 'single', scope: 'session-maybe' },
      details: { kind: 'single', scope: 'session' },
    })
    expect(agentRegistration?.options.inject?.()).toMatchObject({
      runtime: expect.any(Object),
      sessions: ctx.sessions,
      workspaces: ctx.workspaces,
    })
    expect(providers.get('comicProject')).toMatchObject({ workspaceId: 'workspace-1', projectId: 'project:root' })
    const firstScope = providers.get('comicProject') as {
      readFile(path: string, signal: AbortSignal): Promise<unknown>
      previewFile(path: string, signal: AbortSignal): Promise<unknown>
      releasePreview(previewId: string): Promise<void>
    }
    const readSignal = new AbortController().signal
    await expect(firstScope.readFile('README.md', readSignal)).resolves.toMatchObject({ kind: 'text', text: 'hi' })
    expect(projectFiles.read).toHaveBeenCalledWith({ workspaceId: 'workspace-1', path: 'README.md' }, readSignal)
    await expect(firstScope.previewFile('README.md', readSignal)).resolves.toMatchObject({ kind: 'text', text: 'hi' })
    expect(projectFiles.preview).toHaveBeenCalledWith({ workspaceId: 'workspace-1', path: 'README.md' }, readSignal)
    projectFiles.preview.mockRejectedValueOnce(new Error('client api: projectFiles/preview failed: transport failure for /api/projectFiles/preview: HTTP 404'))
    await expect(firstScope.previewFile('README.md', readSignal)).resolves.toMatchObject({ kind: 'text', text: 'hi' })
    expect(projectFiles.read).toHaveBeenCalledTimes(2)
    await firstScope.releasePreview('preview-1')
    expect(projectFiles.releasePreview).toHaveBeenCalledWith({ previewId: 'preview-1' })
    expect(providers.has('layout')).toBe(true)

    workspaceFeed.set({
      items: [
        { workspaceId: 'workspace-1', title: 'Project', sessionIds: ['session-1'] },
        { workspaceId: 'workspace-2', title: 'Other', sessionIds: ['session-2'] },
      ],
      phase: 'ready',
      recentWorkspaceId: 'workspace-2',
    })
    sessionFeed.set({ current: 'session-2' })
    await vi.waitFor(() => expect(providers.get('comicProject')).toMatchObject({
      workspaceId: 'workspace-2', projectId: 'project:root',
    }))
    expect(scopeDisposers).toHaveLength(2)
    expect(scopeDisposers[0]).toHaveBeenCalledOnce()

    await dispose()
    for (const registration of registrations) expect(registration.dispose).toHaveBeenCalledOnce()
    expect(providerDisposers.get('comicProject')).toHaveBeenCalledOnce()
    expect(providerDisposers.get('layout')).toHaveBeenCalledOnce()
    expect(remoteDispose).toHaveBeenCalledOnce()
  })
})
