export const PROJECT_ROOT_ID = 'project:root' as const
export const PROJECT_FILES_NAMESPACE = 'projectFiles' as const
export const PROJECT_FILES_RESPONSE_CAP = 500
export const PROJECT_FILES_RING_CAP = 128
export const PROJECT_FILE_DRAG_MIME = 'application/vnd.convax.project-file.v1+json' as const
export const PROJECT_IMAGE_IMPORT_MAX_BYTES = 10 * 1024 * 1024
export const PROJECT_TEXT_IMPORT_MAX_BYTES = 100_000

export type ReadProjectFileResult =
  | {
    readonly kind: 'image'
    readonly path: string
    readonly name: string
    readonly size: number
    readonly mimeType: string
    readonly dataBase64: string
  }
  | {
    readonly kind: 'text'
    readonly path: string
    readonly name: string
    readonly size: number
    readonly mimeType: string
    readonly text: string
  }

export interface ComicProjectScope {
  readonly workspaceId: string
  readonly projectId: typeof PROJECT_ROOT_ID
  readonly readFile: (path: string, signal: AbortSignal) => Promise<ReadProjectFileResult>
}

export interface ProjectFileDragPayload {
  readonly workspaceId: string
  readonly path: string
}

export type ProjectFileKind = 'directory' | 'file' | 'symlink' | 'other'

export interface ProjectFileEntry {
  readonly name: string
  readonly path: string
  readonly kind: ProjectFileKind
  readonly expandable: boolean
  readonly size?: number
}

export interface OpenProjectFilesRequest { readonly workspaceId: string }
export interface OpenProjectFilesResult {
  readonly leaseId: string
  readonly workspaceId: string
  readonly sequence: number
}
export interface ListProjectFilesRequest {
  readonly leaseId: string
  readonly path: string
  readonly limit?: number
}
export interface ListProjectFilesResult {
  readonly path: string
  readonly sequence: number
  readonly entries: readonly ProjectFileEntry[]
  readonly truncated: boolean
}
export interface WaitProjectFilesRequest {
  readonly leaseId: string
  readonly afterSequence: number
  readonly timeoutMs: number
}
export type WaitProjectFilesResult =
  | { readonly status: 'changed'; readonly sequence: number; readonly paths: readonly string[]; readonly reset: boolean }
  | { readonly status: 'timeout'; readonly sequence: number }
export interface ReadProjectFileRequest {
  readonly workspaceId: string
  readonly path: string
}
export interface CloseProjectFilesRequest { readonly leaseId: string }
export interface CloseProjectFilesResult { readonly closed: boolean }

export interface ProjectFilesApi {
  open(request: OpenProjectFilesRequest): Promise<OpenProjectFilesResult>
  list(request: ListProjectFilesRequest): Promise<ListProjectFilesResult>
  read(request: ReadProjectFileRequest, signal: AbortSignal): Promise<ReadProjectFileResult>
  wait(request: WaitProjectFilesRequest, signal: AbortSignal): Promise<WaitProjectFilesResult>
  close(request: CloseProjectFilesRequest): Promise<CloseProjectFilesResult>
}

export class ProjectFilesError extends Error {
  readonly code: string
  readonly details: Readonly<Record<string, unknown>>

  constructor(code: string, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message)
    this.name = 'ProjectFilesError'
    this.code = code
    this.details = details
  }
}

/** Strict slash-separated wire path. Empty string names the workspace root. */
export function assertProjectRelativePath(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new ProjectFilesError('INVALID_PATH', 'project path must be a string')
  if (value.length > 4096) throw new ProjectFilesError('INVALID_PATH', 'project path is too long')
  if (value === '') return
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/') || value.endsWith('/')) {
    throw new ProjectFilesError('INVALID_PATH', 'project path must be relative and slash-separated')
  }
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new ProjectFilesError('INVALID_PATH', 'project path contains an invalid segment')
  }
}

export function encodeProjectFileDragPayload(payload: ProjectFileDragPayload): string {
  return JSON.stringify(parseProjectFileDragPayload(payload))
}

export function parseProjectFileDragPayload(value: unknown): ProjectFileDragPayload {
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (new TextEncoder().encode(value).byteLength > 8 * 1024) {
      throw new ProjectFilesError('INVALID_DRAG_PAYLOAD', 'project file drag payload is too large')
    }
    try { parsed = JSON.parse(value) } catch {
      throw new ProjectFilesError('INVALID_DRAG_PAYLOAD', 'project file drag payload is not valid JSON')
    }
  }
  if (!plainObject(parsed)) throw new ProjectFilesError('INVALID_DRAG_PAYLOAD', 'project file drag payload must be an object')
  const keys = Object.keys(parsed).sort()
  if (keys.length !== 2 || keys[0] !== 'path' || keys[1] !== 'workspaceId') {
    throw new ProjectFilesError('INVALID_DRAG_PAYLOAD', 'project file drag payload fields are invalid')
  }
  if (typeof parsed.workspaceId !== 'string' || parsed.workspaceId.length === 0 || parsed.workspaceId.length > 256) {
    throw new ProjectFilesError('INVALID_DRAG_PAYLOAD', 'project file drag workspaceId is invalid')
  }
  assertProjectRelativePath(parsed.path)
  if (parsed.path === '' || parsed.path.length > 4096) {
    throw new ProjectFilesError('INVALID_DRAG_PAYLOAD', 'project file drag path is invalid')
  }
  return Object.freeze({ workspaceId: parsed.workspaceId, path: parsed.path })
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function joinProjectPath(parent: string, name: string): string {
  assertProjectRelativePath(parent)
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new ProjectFilesError('INVALID_PATH', 'filesystem returned an invalid child name')
  }
  return parent === '' ? name : `${parent}/${name}`
}
