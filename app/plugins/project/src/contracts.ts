export const PROJECT_ROOT_ID = 'project:root' as const
export const PROJECT_FILES_NAMESPACE = 'projectFiles' as const
export const PROJECT_FILES_RESPONSE_CAP = 500
export const PROJECT_FILES_RING_CAP = 128

export interface ComicProjectScope {
  readonly workspaceId: string
  readonly projectId: typeof PROJECT_ROOT_ID
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
export interface CloseProjectFilesRequest { readonly leaseId: string }
export interface CloseProjectFilesResult { readonly closed: boolean }

export interface ProjectFilesApi {
  open(request: OpenProjectFilesRequest): Promise<OpenProjectFilesResult>
  list(request: ListProjectFilesRequest): Promise<ListProjectFilesResult>
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
  if (value === '') return
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/') || value.endsWith('/')) {
    throw new ProjectFilesError('INVALID_PATH', 'project path must be relative and slash-separated')
  }
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new ProjectFilesError('INVALID_PATH', 'project path contains an invalid segment')
  }
}

export function joinProjectPath(parent: string, name: string): string {
  assertProjectRelativePath(parent)
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new ProjectFilesError('INVALID_PATH', 'filesystem returned an invalid child name')
  }
  return parent === '' ? name : `${parent}/${name}`
}
