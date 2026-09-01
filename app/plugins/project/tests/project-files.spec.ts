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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function harness() {
  const root = '/workspace/project'
  const directories = new Set([root, `${root}/src`])
  const links = new Set([`${root}/link`])
  const files = new Map<string, Uint8Array>([
    [`${root}/README.md`, new TextEncoder().encode('# Project\n')],
    [`${root}/cover.png`, Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    [`${root}/bad.png`, new TextEncoder().encode('not a png')],
    [`${root}/archive.zip`, Uint8Array.of(0x50, 0x4b, 0x03, 0x04)],
  ])
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
      const bytes = files.get(path)
      if (bytes !== undefined) return { type: 'file' as const, size: bytes.byteLength }
      return undefined
    },
    async lstat(path, options) {
      const absolute = posix.resolve(options?.cwd ?? '/', path)
      if (links.has(absolute)) return { type: 'symlink' as const }
      if (directories.has(absolute)) return { type: 'directory' as const }
      const bytes = files.get(absolute)
      if (bytes !== undefined) return { type: 'file' as const, size: bytes.byteLength }
      return undefined
    },
    async readBytes(value, _signal, maxBytes) {
      const bytes = files.get((value as Target).path)
      if (bytes === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      if (bytes.byteLength > maxBytes) throw Object.assign(new Error('too large'), { code: 'FS_TOO_LARGE' })
      return bytes.slice()
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
  const watchers: FakeWatcher[] = []
  const watchRoots: string[] = []
  const ctx = { logger: { warn: vi.fn() } }
  const workspaces = { get: (id: string) => id === 'workspace-1' ? { path: root } : undefined }
  const manager = new ProjectFilesManager(ctx as never, fs, workspaces as never, {
    watcherFactory: (watchRoot) => {
      const next = watchers.length === 0 ? watcher : new FakeWatcher()
      watchers.push(next)
      watchRoots.push(watchRoot)
      return next
    },
    coalesceMs: 0,
  })
  return { manager, watcher, watchers, watchRoots, fs, root }
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

  it('watches only the root and directories that the client actually opens', async () => {
    const { manager, watchRoots, watchers, root } = harness()
    const opened = await manager.open({ workspaceId: 'workspace-1' })

    expect(watchRoots).toEqual([root])
    await manager.list({ leaseId: opened.leaseId, path: '' })
    expect(watchRoots).toEqual([root])

    await manager.list({ leaseId: opened.leaseId, path: 'src' })
    expect(watchRoots).toEqual([root, `${root}/src`])

    const changed = manager.wait({
      leaseId: opened.leaseId,
      afterSequence: opened.sequence,
      timeoutMs: 1_000,
    }, new AbortController().signal)
    watchers[1]!.emit('all', 'change', `${root}/src/index.ts`)
    await expect(changed).resolves.toEqual({ status: 'changed', sequence: 1, paths: ['src'], reset: false })

    await manager.closeLease(opened.leaseId)
    expect(watchers.every(active => active.closed)).toBe(true)
  })

  it('checks directory entries concurrently instead of serializing local metadata reads', async () => {
    const { manager, fs } = harness()
    const gate = deferred<void>()
    const original = fs.lstat.bind(fs)
    let active = 0
    let peak = 0
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      active += 1
      peak = Math.max(peak, active)
      await gate.promise
      try { return await original(...args) } finally { active -= 1 }
    })
    const opened = await manager.open({ workspaceId: 'workspace-1' })
    const listing = manager.list({ leaseId: opened.leaseId, path: '' })

    await vi.waitFor(() => { expect(peak).toBeGreaterThan(1) })
    gate.resolve()
    await listing
    await manager.dispose()
  })

  it('reads supported text and image files through workspace-relative authority only', async () => {
    const { manager } = harness()
    await expect(manager.read(
      { workspaceId: 'workspace-1', path: 'README.md' },
      new AbortController().signal,
    )).resolves.toEqual({
      kind: 'text', path: 'README.md', name: 'README.md', size: 10,
      mimeType: 'text/markdown', text: '# Project\n',
    })
    await expect(manager.read(
      { workspaceId: 'workspace-1', path: 'cover.png' },
      new AbortController().signal,
    )).resolves.toMatchObject({
      kind: 'image', path: 'cover.png', name: 'cover.png', size: 8,
      mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=',
    })
    await expect(manager.read(
      { workspaceId: 'workspace-1', path: 'bad.png' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    await expect(manager.read(
      { workspaceId: 'workspace-1', path: 'archive.zip' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' })
    await expect(manager.read(
      { workspaceId: 'workspace-1', path: 'link' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'SYMLINK_NOT_EXPANDABLE' })
    await expect(manager.read(
      { workspaceId: 'workspace-1', path: '../escape' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await manager.dispose()
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
