export const CANVAS_STORE_SERVICE = 'canvasStore' as const

export interface StoredCanvasProject {
  readonly workspaceId: string
  readonly projectId: string
  readonly revision: number
  readonly projectJson: string
}

export interface CommitCanvasProjectInput {
  readonly workspaceId: string
  readonly projectId: string
  readonly expectedRevision: number
  readonly projectJson: string
}

export interface DeleteCanvasProjectInput {
  readonly workspaceId: string
  readonly projectId: string
  readonly expectedRevision: number
}

export type CanvasStoreErrorCode =
  | 'CLOSED'
  | 'CONFLICT'
  | 'CORRUPT'
  | 'IO'
  | 'NOT_FOUND'
  | 'READ_ONLY'

export class CanvasStoreError extends Error {
  readonly code: CanvasStoreErrorCode

  constructor(code: CanvasStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CanvasStoreError'
    this.code = code
  }
}

export class CanvasStoreRevisionConflict extends CanvasStoreError {
  readonly expected: number
  readonly actual: number

  constructor(expected: number, actual: number) {
    super('CONFLICT', `canvas store revision conflict: expected ${expected}, current ${actual}`)
    this.name = 'CanvasStoreRevisionConflict'
    this.expected = expected
    this.actual = actual
  }
}

export interface CanvasStore {
  /** Read one workspace's projects in stable projectId order. */
  list(workspaceId: string): Promise<readonly StoredCanvasProject[]>
  read(workspaceId: string, projectId: string): Promise<StoredCanvasProject | undefined>
  /** Create revision zero if absent and otherwise return the existing workspace authority. */
  initialize(workspaceId: string, projectId: string, projectJson: string): Promise<StoredCanvasProject>
  /** Atomically replace one workspace project and advance its persisted revision once. */
  commit(input: CommitCanvasProjectInput): Promise<StoredCanvasProject>
  /** Delete one workspace project iff its persisted revision matches; missing returns false. */
  delete(input: DeleteCanvasProjectInput): Promise<boolean>
}
