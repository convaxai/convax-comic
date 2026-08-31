import { posix } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ProjectFilesManager,
  type ProjectFileSystem,
  type ProjectFsTarget,
  type WatcherLike,
} from '../src/host/project-files.ts'

interface Target extends ProjectFsTarget { readonly path: string }

class FakeWatcher implements WatcherLike {
  readonly listeners = new Map<string, Array<(...args: never[]) => void>>()
  closed = false

  on(event: 'ready' | 'error' | 'all', listener: (...args: never[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    if (event === 'ready') queueMicrotask(() => { this.emit('ready') })
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args as never[])
  }

  async close(): Promise<void> { this.closed = true }
}

function target(path: string): Target {
  return { path, targetKey: path, displayPath: path }
}

function harness() {
  const root = '/workspace/project'
  const directories = new Set([root, `${root}/src`])
  const links = new Set([`${root}/link`])
  const fs: ProjectFileSystem = {
    async resolve(path, options) {
      const absolute = path === 'escape'
        ? '/outside/escape'
        : path.startsWith('/') ? posix.normalize(path) : posix.resolve(options?.cwd ?? '/', path)
      return target(absolute)
    },
    processPath(value) { return (value as Target).path },
    contains(parent, child) {
      const relative = posix.relative((parent as Target).path, (child as Target).path)
      return relative === '' || (!relative.startsWith('../') && relative !== '..' && !posix.isAbsolute(relative))
    },
    async stat(value) {
      const path = (value as Target).path
      if (directories.has(path)) return { type: 'directory' as const }
      if (path === `${root}/README.md`) return { type: 'file' as const, size: 10 }
      return undefined
    },
    async lstat(path, options) {
      const absolute = posix.resolve(options?.cwd ?? '/', path)
      if (links.has(absolute)) return { type: 'symlink' as const }
      if (directories.has(absolute)) return { type: 'directory' as const }
      if (absolute === `${root}/README.md`) return { type: 'file' as const, size: 10 }
      return undefined
    },
    async listDir(value) {
      const path = (value as Target).path
      if (path === root) return [
        { name: '.git', type: 'directory' as const },
        { name: 'README.md', type: 'file' as const, size: 10 },
        { name: 'link', type: 'directory' as const },
        { name: 'src', type: 'directory' as const },
      ]
      if (path === `${root}/src`) return [{ name: 'index.ts', type: 'file' as const, size: 20 }]
      return []
    },
  }
  const watcher = new FakeWatcher()
  const ctx = { logger: { warn: vi.fn() } }
  const workspaces = { get: (id: string) => id === 'workspace-1' ? { path: root } : undefined }
  const manager = new ProjectFilesManager(ctx as never, fs, workspaces as never, {
    watcherFactory: () => watcher,
    coalesceMs: 0,
  })
  return { manager, watcher, root }
}

describe('ProjectFilesManager', () => {
  it('lists one authoritative level, ignores noisy trees, and never expands symlinks', async () => {
    const { manager, watcher } = harness()
    const opened = await manager.open({ workspaceId: 'workspace-1' })
    const listed = await manager.list({ leaseId: opened.leaseId, path: '' })
    expect(listed.entries).toEqual([
      { name: 'src', path: 'src', kind: 'directory', expandable: true },
      { name: 'link', path: 'link', kind: 'symlink', expandable: false },
      { name: 'README.md', path: 'README.md', kind: 'file', expandable: false, size: 10 },
    ])
    expect(listed.entries.some(entry => entry.name === '.git')).toBe(false)
    await expect(manager.list({ leaseId: opened.leaseId, path: 'link' })).rejects.toMatchObject({
      code: 'SYMLINK_NOT_EXPANDABLE',
    })
    await expect(manager.list({ leaseId: opened.leaseId, path: '../escape' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await manager.closeLease(opened.leaseId)
    expect(watcher.closed).toBe(true)
  })

  it('converts observed writes into sequenced invalidations and aborts pending waits on close', async () => {
    const { manager, root } = harness()
    const opened = await manager.open({ workspaceId: 'workspace-1' })
    const changed = manager.wait({ leaseId: opened.leaseId, afterSequence: 0, timeoutMs: 1_000 }, new AbortController().signal)
    manager.observeTarget(target(`${root}/src/index.ts`), { name: 'write' })
    await expect(changed).resolves.toEqual({ status: 'changed', sequence: 1, paths: ['src'], reset: false })

    const pending = manager.wait({ leaseId: opened.leaseId, afterSequence: 1, timeoutMs: 1_000 }, new AbortController().signal)
    await manager.closeLease(opened.leaseId)
    await expect(pending).rejects.toMatchObject({ code: 'LEASE_CLOSED' })
  })

  it('rejects unknown workspaces and contained-resolution escapes', async () => {
    const { manager } = harness()
    await expect(manager.open({ workspaceId: 'missing' })).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' })
    const opened = await manager.open({ workspaceId: 'workspace-1' })
    await expect(manager.list({ leaseId: opened.leaseId, path: 'escape' })).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    await manager.dispose()
  })
})
