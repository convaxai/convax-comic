import { describe, expect, it, vi } from 'vitest'
import { ComicProjectRuntime, selectActiveWorkspace, type WorkspaceViewLike } from '../src/client/runtime.ts'

const workspaces: WorkspaceViewLike[] = [
  { workspaceId: 'workspace:a', title: 'A', sessionIds: ['session:a'] },
  { workspaceId: 'workspace:b', title: 'B', sessionIds: ['session:b'] },
]

describe('ComicProjectRuntime selection', () => {
  it('prefers the current session workspace', () => {
    expect(selectActiveWorkspace(workspaces, 'session:b', 'workspace:a')).toBe('workspace:b')
  })

  it('falls back to valid recent then first workspace', () => {
    expect(selectActiveWorkspace(workspaces, undefined, 'workspace:b')).toBe('workspace:b')
    expect(selectActiveWorkspace(workspaces, undefined, 'workspace:missing')).toBe('workspace:a')
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
        getSnapshot: () => ({ items: [workspaces[0]], recentWorkspaceId: 'workspace:a' }),
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
})
