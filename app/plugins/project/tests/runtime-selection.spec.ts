import { describe, expect, it, vi } from 'vitest'
import { ComicProjectRuntime, selectActiveWorkspace, type WorkspaceViewLike } from '../src/client/runtime.ts'

const workspaces: WorkspaceViewLike[] = [
  { workspaceId: 'workspace:a', title: 'A', sessionIds: ['session:a'] },
  { workspaceId: 'workspace:b', title: 'B', sessionIds: ['session:b'] },
]

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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function waitUntilAbort(_input: unknown, signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = (): void => { reject(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

describe('ComicProjectRuntime selection', () => {
  it('prefers the current session workspace', () => {
    expect(selectActiveWorkspace(workspaces, 'session:b', 'workspace:a')).toBe('workspace:b')
  })

  it('falls back only when no current session exists', () => {
    expect(selectActiveWorkspace(workspaces, undefined, 'workspace:b')).toBe('workspace:b')
    expect(selectActiveWorkspace(workspaces, undefined, 'workspace:missing')).toBe('workspace:a')
    expect(selectActiveWorkspace(workspaces, 'session:ungrouped', 'workspace:b')).toBeUndefined()
    expect(selectActiveWorkspace([], undefined, undefined)).toBeUndefined()
  })

  it('loads directory children lazily when their BEUI expansion changes', async () => {
    const list = vi.fn(async ({ path }: { readonly path: string }) => ({
      ok: true as const,
      value: {
        path,
        sequence: 0,
        entries: path === ''
          ? [{ name: 'assets', path: 'assets', kind: 'directory' as const, expandable: true }]
          : [{ name: 'cover.png', path: 'assets/cover.png', kind: 'file' as const, expandable: false }],
        truncated: false,
      },
    }))
    const wait = vi.fn((_input: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => {
      const abort = (): void => { reject(signal?.reason) }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    }))
    const runtime = new ComicProjectRuntime({
      open: vi.fn(async () => ({ ok: true, value: { leaseId: 'lease-1', workspaceId: 'workspace:a', sequence: 0 } })),
      list,
      wait,
      close: vi.fn(async () => ({ ok: true, value: { closed: true } })),
    } as never, {
      list: {
        getSnapshot: () => ({ items: [workspaces[0]], baselinesReady: true, recentWorkspaceId: 'workspace:a' }),
        subscribe: () => () => {},
      },
    } as never, {
      list: { getSnapshot: () => ({ current: 'session:a' }), subscribe: () => () => {} },
    } as never)

    runtime.start()
    await vi.waitFor(() => expect(list).toHaveBeenCalledWith({ leaseId: 'lease-1', path: '' }))
    expect(list).not.toHaveBeenCalledWith({ leaseId: 'lease-1', path: 'assets' })

    await runtime.toggleDirectory('assets')

    expect(list).toHaveBeenCalledWith({ leaseId: 'lease-1', path: 'assets' })
    expect(runtime.getSnapshot().expanded).toEqual(['assets'])
    expect(runtime.getSnapshot().directories.assets?.entries[0]?.path).toBe('assets/cover.png')
    await runtime.dispose()
  })

  it('waits for authoritative baselines instead of opening the first workspace', async () => {
    const workspaceFeed = observable({
      items: workspaces,
      baselinesReady: false,
      recentWorkspaceId: undefined as string | undefined,
    })
    const sessionFeed = observable({ current: 'session:b' as string | undefined })
    const open = vi.fn(async ({ workspaceId }: { readonly workspaceId: string }) => ({
      ok: true as const,
      value: { leaseId: `lease:${workspaceId}`, workspaceId, sequence: 0 },
    }))
    const runtime = new ComicProjectRuntime({
      open,
      list: vi.fn(async ({ leaseId, path }: { readonly leaseId: string; readonly path: string }) => ({
        ok: true as const,
        value: { path, sequence: 0, entries: [{ name: leaseId, path: leaseId, kind: 'file' as const, expandable: false }], truncated: false },
      })),
      wait: vi.fn(waitUntilAbort),
      close: vi.fn(async () => ({ ok: true as const, value: { closed: true } })),
    } as never, {
      list: workspaceFeed.store,
    } as never, {
      list: sessionFeed.store,
    } as never)

    runtime.start()
    expect(open).not.toHaveBeenCalled()

    workspaceFeed.set({ items: workspaces, baselinesReady: true, recentWorkspaceId: 'workspace:a' })

    await vi.waitFor(() => expect(open).toHaveBeenCalledWith({ workspaceId: 'workspace:b' }))
    expect(open).not.toHaveBeenCalledWith({ workspaceId: 'workspace:a' })
    expect(runtime.getSnapshot().activeWorkspaceId).toBe('workspace:b')
    await runtime.dispose()
  })

  it('makes rapid project navigation last-intent-wins and loads that tree immediately', async () => {
    const allWorkspaces = [
      ...workspaces,
      { workspaceId: 'workspace:c', title: 'C', sessionIds: ['session:c'] },
    ]
    const workspaceFeed = observable({
      items: allWorkspaces,
      baselinesReady: true,
      recentWorkspaceId: 'workspace:a' as string | undefined,
    })
    const sessionFeed = observable({ current: 'session:a' as string | undefined })
    const connects = new Map([
      ['workspace:b', deferred<string>()],
      ['workspace:c', deferred<string>()],
    ])
    const sessionsOpen = vi.fn((sessionId: string) => { sessionFeed.set({ current: sessionId }) })
    const runtime = new ComicProjectRuntime({
      open: vi.fn(async ({ workspaceId }: { readonly workspaceId: string }) => ({
        ok: true as const,
        value: { leaseId: `lease:${workspaceId}`, workspaceId, sequence: 0 },
      })),
      list: vi.fn(async ({ leaseId, path }: { readonly leaseId: string; readonly path: string }) => ({
        ok: true as const,
        value: {
          path,
          sequence: 0,
          entries: [{ name: `${leaseId}.txt`, path: `${leaseId}.txt`, kind: 'file' as const, expandable: false }],
          truncated: false,
        },
      })),
      wait: vi.fn(waitUntilAbort),
      close: vi.fn(async () => ({ ok: true as const, value: { closed: true } })),
    } as never, {
      list: workspaceFeed.store,
      connectWorkspace: vi.fn((workspaceId: string) => connects.get(workspaceId)?.promise ?? Promise.resolve('session:a')),
    } as never, {
      list: sessionFeed.store,
      open: sessionsOpen,
    } as never)

    runtime.start()
    await vi.waitFor(() => expect(runtime.getSnapshot().phase).toBe('ready'))

    const first = runtime.switchWorkspace('workspace:b')
    expect(runtime.getSnapshot().activeWorkspaceId).toBe('workspace:b')
    const second = runtime.switchWorkspace('workspace:c')
    expect(runtime.getSnapshot().activeWorkspaceId).toBe('workspace:c')

    connects.get('workspace:b')?.reject(new Error('stale navigation failed'))
    await expect(first).resolves.toBeUndefined()
    expect(sessionsOpen).not.toHaveBeenCalledWith('session:b')
    connects.get('workspace:c')?.resolve('session:c')
    await second

    await vi.waitFor(() => expect(runtime.getSnapshot().directories['']?.entries[0]?.name).toBe('lease:workspace:c.txt'))
    expect(sessionsOpen).toHaveBeenCalledTimes(1)
    expect(sessionsOpen).toHaveBeenCalledWith('session:c')
    expect(runtime.getSnapshot().activeWorkspaceId).toBe('workspace:c')
    await runtime.dispose()
  })

  it('does not let an older Add Project picker override a later explicit switch', async () => {
    const workspaceFeed = observable({
      items: workspaces,
      baselinesReady: true,
      recentWorkspaceId: 'workspace:a' as string | undefined,
    })
    const sessionFeed = observable({ current: 'session:a' as string | undefined })
    const picker = deferred<string | null>()
    const create = vi.fn(async () => ({ workspaceId: 'workspace:new', title: 'New', sessionIds: ['session:new'] }))
    const runtime = new ComicProjectRuntime({
      open: vi.fn(async ({ workspaceId }: { readonly workspaceId: string }) => ({
        ok: true as const,
        value: { leaseId: `lease:${workspaceId}`, workspaceId, sequence: 0 },
      })),
      list: vi.fn(async ({ path }: { readonly path: string }) => ({
        ok: true as const,
        value: { path, sequence: 0, entries: [], truncated: false },
      })),
      wait: vi.fn(waitUntilAbort),
      close: vi.fn(async () => ({ ok: true as const, value: { closed: true } })),
    } as never, {
      list: workspaceFeed.store,
      pickDirectory: vi.fn(() => picker.promise),
      create,
      connectWorkspace: vi.fn(async (workspaceId: string) => workspaceId === 'workspace:b' ? 'session:b' : 'session:new'),
    } as never, {
      list: sessionFeed.store,
      open: (sessionId: string) => { sessionFeed.set({ current: sessionId }) },
    } as never)

    runtime.start()
    await vi.waitFor(() => expect(runtime.getSnapshot().phase).toBe('ready'))
    const adding = runtime.addProject()
    await runtime.switchWorkspace('workspace:b')
    picker.resolve('/new')
    await adding

    expect(create).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().activeWorkspaceId).toBe('workspace:b')
    await runtime.dispose()
  })

  it('opens a newly added project and ignores an older overlapping directory response', async () => {
    const created = { workspaceId: 'workspace:new', title: 'New', sessionIds: ['session:new'] }
    const workspaceFeed = observable({
      items: [workspaces[0]],
      baselinesReady: true,
      recentWorkspaceId: 'workspace:a' as string | undefined,
    })
    const sessionFeed = observable({ current: 'session:a' as string | undefined })
    const older = deferred<unknown>()
    const newer = deferred<unknown>()
    let rootLists = 0
    const list = vi.fn(({ leaseId, path }: { readonly leaseId: string; readonly path: string }) => {
      rootLists += 1
      if (leaseId === 'lease:workspace:new' && rootLists === 3) return older.promise
      if (leaseId === 'lease:workspace:new' && rootLists === 4) return newer.promise
      return Promise.resolve({
        ok: true as const,
        value: { path, sequence: 0, entries: [], truncated: false },
      })
    })
    const runtime = new ComicProjectRuntime({
      open: vi.fn(async ({ workspaceId }: { readonly workspaceId: string }) => ({
        ok: true as const,
        value: { leaseId: `lease:${workspaceId}`, workspaceId, sequence: 0 },
      })),
      list,
      wait: vi.fn(waitUntilAbort),
      close: vi.fn(async () => ({ ok: true as const, value: { closed: true } })),
    } as never, {
      list: workspaceFeed.store,
      pickDirectory: vi.fn(async () => '/new'),
      create: vi.fn(async () => {
        workspaceFeed.set({ items: [created, workspaces[0]], baselinesReady: true, recentWorkspaceId: 'workspace:new' })
        return created
      }),
      connectWorkspace: vi.fn(async () => 'session:new'),
    } as never, {
      list: sessionFeed.store,
      open: (sessionId: string) => { sessionFeed.set({ current: sessionId }) },
    } as never)

    runtime.start()
    await vi.waitFor(() => expect(runtime.getSnapshot().phase).toBe('ready'))
    await runtime.addProject()
    await vi.waitFor(() => expect(runtime.getSnapshot().activeWorkspaceId).toBe('workspace:new'))
    await vi.waitFor(() => expect(runtime.getSnapshot().directories['']?.loading).toBe(false))

    const oldLoad = runtime.loadDirectory('')
    const newLoad = runtime.loadDirectory('')
    newer.resolve({
      ok: true,
      value: {
        path: '', sequence: 2,
        entries: [{ name: 'new.txt', path: 'new.txt', kind: 'file', expandable: false }],
        truncated: false,
      },
    })
    await newLoad
    older.resolve({
      ok: true,
      value: {
        path: '', sequence: 1,
        entries: [{ name: 'old.txt', path: 'old.txt', kind: 'file', expandable: false }],
        truncated: false,
      },
    })
    await oldLoad

    expect(runtime.getSnapshot().directories['']?.entries[0]?.name).toBe('new.txt')
    await runtime.dispose()
  })
})
