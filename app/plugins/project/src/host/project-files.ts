import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceId, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import {
  PROJECT_FILES_RESPONSE_CAP,
  PROJECT_FILES_RING_CAP,
  PROJECT_IMAGE_IMPORT_MAX_BYTES,
  PROJECT_TEXT_IMPORT_MAX_BYTES,
  ProjectFilesError,
  assertProjectRelativePath,
  joinProjectPath,
  type CloseProjectFilesResult,
  type ListProjectFilesRequest,
  type ListProjectFilesResult,
  type OpenProjectFilesRequest,
  type OpenProjectFilesResult,
  type ProjectFileEntry,
  type ReadProjectFileRequest,
  type ReadProjectFileResult,
  type WaitProjectFilesRequest,
  type WaitProjectFilesResult,
} from '../contracts.js'

const NOISY_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.yarn', '.pnpm-store',
  '.next', '.nuxt', '.turbo', '.cache', '.venv', '__pycache__',
  'dist', 'build', 'out', 'coverage',
])
const COALESCE_MS = 75
const DEFAULT_LIMIT = 250

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
})
const TEXT_MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.c': 'text/plain',
  '.cc': 'text/plain',
  '.cpp': 'text/plain',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.go': 'text/plain',
  '.h': 'text/plain',
  '.hpp': 'text/plain',
  '.html': 'text/html',
  '.java': 'text/plain',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsx': 'text/javascript',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.mjs': 'text/javascript',
  '.py': 'text/plain',
  '.rs': 'text/plain',
  '.sh': 'text/plain',
  '.sql': 'text/plain',
  '.toml': 'text/plain',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
})

export interface ProjectFsTarget {
  readonly targetKey: unknown
  readonly displayPath: string
}

export interface ProjectFileSystem {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<ProjectFsTarget>
  processPath(target: ProjectFsTarget): string
  contains(parent: ProjectFsTarget, child: ProjectFsTarget): boolean
  stat(target: ProjectFsTarget, signal?: AbortSignal): Promise<{ readonly type: 'file' | 'directory' | 'other'; readonly size?: number } | undefined>
  lstat(path: string, options?: { cwd?: string }, signal?: AbortSignal): Promise<{ readonly type: 'file' | 'directory' | 'symlink' | 'other'; readonly size?: number } | undefined>
  readBytes(target: ProjectFsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
  listDir(target: ProjectFsTarget, signal?: AbortSignal): Promise<Array<{
    readonly name: string
    readonly type: 'file' | 'directory' | 'other'
    readonly size?: number
  }>>
}

export interface WatcherLike {
  on(event: 'ready', listener: () => void): this
  on(event: 'error', listener: (error: unknown) => void): this
  on(event: 'all', listener: (event: string, path: string) => void): this
  close(): Promise<void>
}

export type WatcherFactory = (root: string, ignored: (path: string) => boolean) => WatcherLike

interface InvalidationRecord {
  readonly sequence: number
  readonly paths: readonly string[]
  readonly reset: boolean
}

interface Lease {
  readonly id: string
  readonly workspaceId: string
  readonly state: WorkspaceWatchState
}

interface Waiter {
  readonly after: number
  readonly resolve: (result: WaitProjectFilesResult) => void
  readonly reject: (error: unknown) => void
  readonly cleanup: () => void
}

interface WorkspaceWatchState {
  readonly workspaceId: string
  readonly rootPath: string
  readonly rootTarget: ProjectFsTarget
  readonly leases: Set<string>
  readonly ring: InvalidationRecord[]
  readonly waiters: Set<Waiter>
  readonly coalescer: InvalidationCoalescer
  watcher: WatcherLike | undefined
  opening: Promise<void> | undefined
  sequence: number
  closing: boolean
}

export class InvalidationCoalescer {
  readonly #delay: number
  readonly #flush: (paths: readonly string[]) => void
  readonly #pending = new Set<string>()
  #timer: ReturnType<typeof setTimeout> | undefined
  #closed = false

  constructor(flush: (paths: readonly string[]) => void, delay = COALESCE_MS) {
    this.#flush = flush
    this.#delay = delay
  }

  add(path: string): void {
    if (this.#closed) return
    this.#pending.add(path)
    this.#timer ??= setTimeout(() => { this.flush() }, this.#delay)
  }

  flush(): void {
    if (this.#closed || this.#pending.size === 0) return
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    const paths = [...this.#pending].sort(compareText)
    this.#pending.clear()
    this.#flush(paths)
  }

  close(): void {
    this.#closed = true
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#pending.clear()
  }
}

export interface ProjectFilesManagerOptions {
  readonly watcherFactory?: WatcherFactory
  readonly coalesceMs?: number
}

export class ProjectFilesManager {
  readonly #ctx: Context
  readonly #fs: ProjectFileSystem
  readonly #workspaces: WorkspaceRegistry
  readonly #watcherFactory: WatcherFactory
  readonly #coalesceMs: number
  readonly #states = new Map<string, WorkspaceWatchState>()
  readonly #openingStates = new Map<string, Promise<WorkspaceWatchState>>()
  readonly #leases = new Map<string, Lease>()
  readonly #lifecycle = new AbortController()
  #closing = false

  constructor(ctx: Context, fs: ProjectFileSystem, workspaces: WorkspaceRegistry, options: ProjectFilesManagerOptions = {}) {
    this.#ctx = ctx
    this.#fs = fs
    this.#workspaces = workspaces
    this.#watcherFactory = options.watcherFactory ?? defaultWatcherFactory
    this.#coalesceMs = options.coalesceMs ?? COALESCE_MS
  }

  async open(request: OpenProjectFilesRequest): Promise<OpenProjectFilesResult> {
    this.#assertOpen()
    if (typeof request.workspaceId !== 'string' || request.workspaceId.length === 0) {
      throw new ProjectFilesError('INVALID_WORKSPACE', 'workspaceId is required')
    }
    const workspace = this.#workspaces.get(request.workspaceId as WorkspaceId)
    if (workspace === undefined) throw new ProjectFilesError('WORKSPACE_NOT_FOUND', 'workspace does not exist')

    let state = this.#states.get(request.workspaceId)
    if (state === undefined) {
      let opening = this.#openingStates.get(request.workspaceId)
      if (opening === undefined) {
        opening = this.#initializeState(request.workspaceId, workspace.path)
        this.#openingStates.set(request.workspaceId, opening)
        void opening.finally(() => {
          if (this.#openingStates.get(request.workspaceId) === opening) this.#openingStates.delete(request.workspaceId)
        }).catch(() => undefined)
      }
      state = await opening
    }

    const leaseId = randomUUID()
    state.leases.add(leaseId)
    this.#leases.set(leaseId, { id: leaseId, workspaceId: request.workspaceId, state })
    return { leaseId, workspaceId: request.workspaceId, sequence: state.sequence }
  }

  async list(request: ListProjectFilesRequest): Promise<ListProjectFilesResult> {
    this.#assertOpen()
    const lease = this.#lease(request.leaseId)
    assertProjectRelativePath(request.path)
    const limit = request.limit ?? DEFAULT_LIMIT
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PROJECT_FILES_RESPONSE_CAP) {
      throw new ProjectFilesError('INVALID_LIMIT', `limit must be between 1 and ${PROJECT_FILES_RESPONSE_CAP}`)
    }
    await this.#assertNoSymlinkAncestor(lease.state, request.path)
    const target = await this.#resolveContained(lease.state, request.path)
    const info = await this.#fs.stat(target, this.#lifecycle.signal)
    if (info?.type !== 'directory') throw new ProjectFilesError('NOT_DIRECTORY', 'project path is not a directory')
    const children = await this.#fs.listDir(target, this.#lifecycle.signal)
    const entries: ProjectFileEntry[] = []
    for (const child of children) {
      const path = joinProjectPath(request.path, child.name)
      if (isNoisyRelative(path)) continue
      const pathInfo = await this.#fs.lstat(path, { cwd: lease.state.rootPath }, this.#lifecycle.signal)
      const kind = pathInfo?.type === 'symlink' ? 'symlink' : child.type
      entries.push({
        name: child.name,
        path,
        kind,
        expandable: kind === 'directory',
        ...(kind === 'file' && child.size !== undefined ? { size: child.size } : {}),
      })
    }
    entries.sort(compareEntries)
    return {
      path: request.path,
      sequence: lease.state.sequence,
      entries: entries.slice(0, limit),
      truncated: entries.length > limit,
    }
  }

  async read(request: ReadProjectFileRequest, signal: AbortSignal): Promise<ReadProjectFileResult> {
    this.#assertOpen()
    if (typeof request.workspaceId !== 'string' || request.workspaceId.length === 0 || request.workspaceId.length > 256) {
      throw new ProjectFilesError('INVALID_WORKSPACE', 'workspaceId is invalid')
    }
    assertProjectRelativePath(request.path)
    if (request.path === '') throw new ProjectFilesError('NOT_FILE', 'project path must name a file')
    if (isNoisyRelative(request.path)) throw new ProjectFilesError('PATH_IGNORED', 'project path is not readable')

    const activeSignal = AbortSignal.any([this.#lifecycle.signal, signal])
    const workspace = this.#workspaces.get(request.workspaceId as WorkspaceId)
    if (workspace === undefined) throw new ProjectFilesError('WORKSPACE_NOT_FOUND', 'workspace does not exist')
    await this.#assertNoSymlinkPath(workspace.path, request.path, activeSignal)
    const rootTarget = await this.#fs.resolve(workspace.path, { signal: activeSignal })
    const target = await this.#fs.resolve(request.path, { cwd: workspace.path, signal: activeSignal })
    if (!this.#fs.contains(rootTarget, target)) throw new ProjectFilesError('PATH_ESCAPE', 'project path escapes the workspace')
    const info = await this.#fs.stat(target, activeSignal)
    if (info?.type !== 'file') throw new ProjectFilesError('NOT_FILE', 'project path is not a regular file')
    const extension = extname(request.path).toLocaleLowerCase('en-US')
    const imageMimeType = IMAGE_MIME_TYPES[extension]
    const textMimeType = TEXT_MIME_TYPES[extension]
    if (imageMimeType === undefined && textMimeType === undefined) {
      throw new ProjectFilesError('UNSUPPORTED_FILE_TYPE', 'only supported image and text files can be added to Canvas')
    }
    const kind = imageMimeType === undefined ? 'text' as const : 'image' as const
    const mimeType = imageMimeType ?? textMimeType!
    const maxBytes = kind === 'image' ? PROJECT_IMAGE_IMPORT_MAX_BYTES : PROJECT_TEXT_IMPORT_MAX_BYTES
    if (info.size !== undefined && info.size > maxBytes) {
      throw new ProjectFilesError('FILE_TOO_LARGE', `project file exceeds the ${maxBytes} byte Canvas import limit`)
    }

    let bytes: Uint8Array
    try {
      bytes = await this.#fs.readBytes(target, activeSignal, maxBytes)
    } catch (error) {
      if (isErrorCode(error, 'FS_TOO_LARGE')) {
        throw new ProjectFilesError('FILE_TOO_LARGE', `project file exceeds the ${maxBytes} byte Canvas import limit`)
      }
      throw error
    }
    const name = request.path.split('/').at(-1)!
    if (kind === 'image') {
      if (!matchesImageSignature(bytes, mimeType)) {
        throw new ProjectFilesError('INVALID_IMAGE', 'project image content does not match its supported file type')
      }
      return {
        kind, path: request.path, name, size: bytes.byteLength, mimeType,
        dataBase64: Buffer.from(bytes).toString('base64'),
      }
    }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new ProjectFilesError('INVALID_TEXT_ENCODING', 'project text file must be valid UTF-8')
    }
    if (text.includes('\0')) throw new ProjectFilesError('INVALID_TEXT_ENCODING', 'project text file cannot contain NUL bytes')
    if (text.length > PROJECT_TEXT_IMPORT_MAX_BYTES) {
      throw new ProjectFilesError('FILE_TOO_LARGE', `project text exceeds the ${PROJECT_TEXT_IMPORT_MAX_BYTES} character Canvas note limit`)
    }
    return { kind, path: request.path, name, size: bytes.byteLength, mimeType, text }
  }

  wait(request: WaitProjectFilesRequest, signal: AbortSignal): Promise<WaitProjectFilesResult> {
    this.#assertOpen()
    const state = this.#lease(request.leaseId).state
    if (!Number.isSafeInteger(request.afterSequence) || request.afterSequence < 0) {
      throw new ProjectFilesError('INVALID_SEQUENCE', 'afterSequence must be a non-negative safe integer')
    }
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 30_000) {
      throw new ProjectFilesError('INVALID_TIMEOUT', 'timeoutMs must be between 1 and 30000')
    }
    const immediate = this.#changesSince(state, request.afterSequence)
    if (immediate !== undefined) return Promise.resolve(immediate)
    if (signal.aborted) return Promise.reject(signal.reason)

    return new Promise((resolveWait, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const onAbort = (): void => {
        cleanup()
        reject(signal.reason)
      }
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        state.waiters.delete(waiter)
      }
      const waiter: Waiter = { after: request.afterSequence, resolve: resolveWait, reject, cleanup }
      timer = setTimeout(() => {
        cleanup()
        resolveWait({ status: 'timeout', sequence: state.sequence })
      }, request.timeoutMs)
      signal.addEventListener('abort', onAbort, { once: true })
      state.waiters.add(waiter)
    })
  }

  async closeLease(leaseId: string): Promise<CloseProjectFilesResult> {
    const lease = this.#leases.get(leaseId)
    if (lease === undefined) return { closed: false }
    this.#leases.delete(leaseId)
    lease.state.leases.delete(leaseId)
    if (lease.state.leases.size === 0) await this.#closeState(lease.state)
    return { closed: true }
  }

  observeTarget(target: ProjectFsTarget, actor: object | undefined): void {
    const toolName = actor === undefined ? undefined : (actor as { readonly name?: unknown }).name
    if (toolName !== 'write' && toolName !== 'edit') return
    if (this.#closing) return
    for (const state of this.#states.values()) {
      if (!this.#fs.contains(state.rootTarget, target)) continue
      try {
        const processPath = this.#fs.processPath(target)
        const parent = relativeParent(state.rootPath, processPath)
        if (parent !== undefined && !isNoisyRelative(parent)) this.#commit(state, [parent], false)
      } catch {
        this.#commit(state, [''], true)
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.#closing) return
    this.#closing = true
    this.#lifecycle.abort(new ProjectFilesError('CLOSED', 'project files service disposed'))
    const states = [...this.#states.values()]
    this.#states.clear()
    this.#openingStates.clear()
    this.#leases.clear()
    await Promise.all(states.map(state => this.#closeState(state)))
  }

  async #initializeState(workspaceId: string, workspacePath: string): Promise<WorkspaceWatchState> {
    const rootTarget = await this.#fs.resolve(workspacePath, { signal: this.#lifecycle.signal })
    const info = await this.#fs.stat(rootTarget, this.#lifecycle.signal)
    if (info?.type !== 'directory') throw new ProjectFilesError('WORKSPACE_UNAVAILABLE', 'workspace directory is unavailable')
    const rootPath = this.#fs.processPath(rootTarget)
    if (!isAbsolute(rootPath)) throw new ProjectFilesError('WORKSPACE_UNAVAILABLE', 'workspace has no local canonical process path')
    const state = this.#createState(workspaceId, rootPath, rootTarget)
    this.#states.set(workspaceId, state)
    state.opening = this.#openWatcher(state)
    try {
      await state.opening
      return state
    } catch (error) {
      await this.#closeState(state)
      throw error
    } finally {
      state.opening = undefined
    }
  }

  #createState(workspaceId: string, rootPath: string, rootTarget: ProjectFsTarget): WorkspaceWatchState {
    const state = {
      workspaceId,
      rootPath,
      rootTarget,
      leases: new Set<string>(),
      ring: [],
      waiters: new Set<Waiter>(),
      sequence: 0,
      closing: false,
      watcher: undefined,
      opening: undefined,
      coalescer: undefined as unknown as InvalidationCoalescer,
    } satisfies WorkspaceWatchState
    state.coalescer = new InvalidationCoalescer(paths => { this.#commit(state, paths, false) }, this.#coalesceMs)
    return state
  }

  async #openWatcher(state: WorkspaceWatchState): Promise<void> {
    const watcher = this.#watcherFactory(state.rootPath, path => {
      const rel = relative(state.rootPath, resolve(path))
      return rel !== '' && (isOutside(rel) || isNoisyRelative(toWirePath(rel)))
    })
    state.watcher = watcher
    await new Promise<void>((resolveReady, reject) => {
      let settled = false
      const signal = this.#lifecycle.signal
      const finish = (operation: () => void): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        operation()
      }
      const onAbort = (): void => { finish(() => { reject(signal.reason) }) }
      const fail = (error: unknown): void => {
        if (!settled) {
          finish(() => { reject(error) })
        } else if (!state.closing) {
          this.#commit(state, [''], true)
        }
      }
      signal.addEventListener('abort', onAbort, { once: true })
      watcher.on('error', fail)
      watcher.on('all', (_event, path) => {
        if (state.closing) return
        const parent = relativeParent(state.rootPath, path)
        if (parent === undefined) {
          this.#commit(state, [''], true)
          return
        }
        if (!isNoisyRelative(parent)) state.coalescer.add(parent)
      })
      watcher.on('ready', () => { finish(resolveReady) })
      if (signal.aborted) onAbort()
    })
    if (this.#closing || state.closing) {
      await watcher.close()
      throw new ProjectFilesError('CLOSED', 'project files service disposed while opening watcher')
    }
  }

  async #closeState(state: WorkspaceWatchState): Promise<void> {
    if (state.closing) return
    state.closing = true
    if (this.#states.get(state.workspaceId) === state) this.#states.delete(state.workspaceId)
    state.coalescer.close()
    for (const leaseId of state.leases) this.#leases.delete(leaseId)
    state.leases.clear()
    for (const waiter of [...state.waiters]) {
      waiter.cleanup()
      waiter.reject(new ProjectFilesError('LEASE_CLOSED', 'project file lease closed'))
    }
    const watcher = state.watcher
    state.watcher = undefined
    if (watcher !== undefined) {
      try {
        await watcher.close()
      } catch (error) {
        this.#ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  async #assertNoSymlinkAncestor(state: WorkspaceWatchState, path: string): Promise<void> {
    await this.#assertNoSymlinkPath(state.rootPath, path, this.#lifecycle.signal)
  }

  async #assertNoSymlinkPath(rootPath: string, path: string, signal: AbortSignal): Promise<void> {
    if (path === '') return
    const segments = path.split('/')
    let current = ''
    for (const segment of segments) {
      current = current === '' ? segment : `${current}/${segment}`
      const info = await this.#fs.lstat(current, { cwd: rootPath }, signal)
      if (info?.type === 'symlink') throw new ProjectFilesError('SYMLINK_NOT_EXPANDABLE', 'symbolic links cannot be read')
    }
  }

  async #resolveContained(state: WorkspaceWatchState, path: string): Promise<ProjectFsTarget> {
    const target = path === ''
      ? state.rootTarget
      : await this.#fs.resolve(path, { cwd: state.rootPath, signal: this.#lifecycle.signal })
    if (!this.#fs.contains(state.rootTarget, target)) {
      throw new ProjectFilesError('PATH_ESCAPE', 'project path escapes the workspace')
    }
    return target
  }

  #commit(state: WorkspaceWatchState, paths: readonly string[], reset: boolean): void {
    if (this.#closing || state.closing) return
    const effectiveReset = reset || paths.length > PROJECT_FILES_RESPONSE_CAP
    const normalized = effectiveReset ? [''] : [...new Set(paths)].sort(compareText)
    state.sequence += 1
    state.ring.push({ sequence: state.sequence, paths: normalized, reset: effectiveReset })
    if (state.ring.length > PROJECT_FILES_RING_CAP) state.ring.shift()
    for (const waiter of [...state.waiters]) {
      const result = this.#changesSince(state, waiter.after)
      if (result === undefined) continue
      waiter.cleanup()
      waiter.resolve(result)
    }
  }

  #changesSince(state: WorkspaceWatchState, after: number): WaitProjectFilesResult | undefined {
    if (after > state.sequence) return { status: 'changed', sequence: state.sequence, paths: [''], reset: true }
    if (after === state.sequence) return undefined
    const first = state.ring[0]
    if (first === undefined || after < first.sequence - 1) {
      return { status: 'changed', sequence: state.sequence, paths: [''], reset: true }
    }
    const records = state.ring.filter(record => record.sequence > after)
    const reset = records.some(record => record.reset)
    const paths = reset ? [''] : [...new Set(records.flatMap(record => record.paths))].sort(compareText)
    if (paths.length > PROJECT_FILES_RESPONSE_CAP) {
      return { status: 'changed', sequence: state.sequence, paths: [''], reset: true }
    }
    return { status: 'changed', sequence: state.sequence, paths, reset }
  }

  #lease(leaseId: string): Lease {
    if (typeof leaseId !== 'string' || leaseId.length === 0) throw new ProjectFilesError('INVALID_LEASE', 'leaseId is required')
    const lease = this.#leases.get(leaseId)
    if (lease === undefined) throw new ProjectFilesError('LEASE_NOT_FOUND', 'project file lease is closed or unknown')
    return lease
  }

  #assertOpen(): void {
    if (this.#closing) throw new ProjectFilesError('CLOSED', 'project files service is closed')
  }
}

function defaultWatcherFactory(root: string, ignored: (path: string) => boolean): WatcherLike {
  return watch(root, {
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    atomic: true,
    ignored,
  }) as FSWatcher
}

function relativeParent(root: string, path: string): string | undefined {
  const absolute = resolve(path)
  const rel = relative(root, absolute)
  if (isOutside(rel)) return undefined
  if (rel === '') return ''
  return toWirePath(dirname(rel) === '.' ? '' : dirname(rel))
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function matchesImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') {
    return bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  }
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mimeType === 'image/gif') {
    const header = bytes.length >= 6 ? String.fromCharCode(...bytes.subarray(0, 6)) : ''
    return header === 'GIF87a' || header === 'GIF89a'
  }
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  }
  return false
}

function toWirePath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function isOutside(path: string): boolean {
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)
}

function isNoisyRelative(path: string): boolean {
  if (path === '') return false
  return path.split('/').some(segment => NOISY_DIRECTORIES.has(segment))
}

function compareText(left: string, right: string): number {
  const folded = left.toLocaleLowerCase('en-US').localeCompare(right.toLocaleLowerCase('en-US'), 'en-US')
  return folded === 0 ? left.localeCompare(right, 'en-US') : folded
}

function compareEntries(left: ProjectFileEntry, right: ProjectFileEntry): number {
  const leftRank = left.kind === 'directory' ? 0 : 1
  const rightRank = right.kind === 'directory' ? 0 : 1
  return leftRank - rightRank || compareText(left.name, right.name)
}
