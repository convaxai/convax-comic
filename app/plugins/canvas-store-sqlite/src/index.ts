import type { Context } from '@deepseek-ai/cordis'
import { parseCanvasProjectJson } from '@convax/canvas-api'
import {
  CANVAS_STORE_SERVICE,
  CanvasStoreError,
  CanvasStoreRevisionConflict,
  type CanvasStore,
  type CommitCanvasProjectInput,
  type DeleteCanvasProjectInput,
  type StoredCanvasProject,
} from '@convax/canvas-store-api'
import {
  SqliteRuntimeError,
  type SqliteLease,
} from '@convax/sqlite-runtime'

const CANVAS_STORE_APPLICATION_ID = 0x43565354

interface ProjectRow extends Readonly<Record<string, unknown>> {
  readonly workspace_id: string
  readonly project_id: string
  readonly revision: number
  readonly project_json: string
}

export interface CanvasStoreSqliteConfig {
  readonly projectScope?: string
  readonly databaseName?: string
}

export const name = 'app-canvas-store-sqlite'
export const inject = ['sqliteRuntime']

declare module '@deepseek-ai/cordis' {
  interface Context {
    canvasStore: CanvasStore
  }
}

export class SqliteCanvasStore implements CanvasStore {
  constructor(private readonly lease: SqliteLease) {}

  async list(workspaceId: string): Promise<readonly StoredCanvasProject[]> {
    validateWorkspaceId(workspaceId)
    try {
      return this.lease.read(db => Object.freeze(db.all<ProjectRow>(
        `SELECT workspace_id, project_id, revision, project_json
          FROM canvas_projects WHERE workspace_id = ? ORDER BY project_id ASC`,
        [workspaceId],
      ).map(stored)))
    } catch (error) {
      throw storeIoError('list', error)
    }
  }

  async read(workspaceId: string, projectId: string): Promise<StoredCanvasProject | undefined> {
    validateWorkspaceId(workspaceId)
    validateProjectId(projectId)
    try {
      return this.lease.read(db => {
        const row = db.get<ProjectRow>(
          `SELECT workspace_id, project_id, revision, project_json
            FROM canvas_projects WHERE workspace_id = ? AND project_id = ?`,
          [workspaceId, projectId],
        )
        return row === undefined ? undefined : stored(row)
      })
    } catch (error) {
      throw storeIoError('read', error)
    }
  }

  async initialize(workspaceId: string, projectId: string, projectJson: string): Promise<StoredCanvasProject> {
    validateWorkspaceId(workspaceId)
    validateProjectId(projectId)
    validateProjectJson(projectJson, workspaceId, projectId, 0)
    try {
      return this.lease.write(db => {
        const now = new Date().toISOString()
        db.run(
          `INSERT OR IGNORE INTO canvas_projects
            (workspace_id, project_id, revision, project_json, created_at, updated_at)
            VALUES (?, ?, 0, ?, ?, ?)`,
          [workspaceId, projectId, projectJson, now, now],
        )
        const row = db.get<ProjectRow>(
          `SELECT workspace_id, project_id, revision, project_json
            FROM canvas_projects WHERE workspace_id = ? AND project_id = ?`,
          [workspaceId, projectId],
        )
        if (row === undefined) throw new Error('CanvasStore initialize did not create or find the project')
        return stored(row)
      })
    } catch (error) {
      throw storeIoError('initialize', error)
    }
  }

  async commit(input: CommitCanvasProjectInput): Promise<StoredCanvasProject> {
    validateWorkspaceId(input.workspaceId)
    validateProjectId(input.projectId)
    validateRevision(input.expectedRevision)
    validateProjectJson(
      input.projectJson,
      input.workspaceId,
      input.projectId,
      input.expectedRevision + 1,
    )
    let conflict: number | undefined
    let missing = false
    try {
      const result = this.lease.write(db => {
        const current = db.get<{ revision: number }>(
          'SELECT revision FROM canvas_projects WHERE workspace_id = ? AND project_id = ?',
          [input.workspaceId, input.projectId],
        )
        if (current === undefined) {
          missing = true
          return undefined
        }
        if (current.revision !== input.expectedRevision) {
          conflict = current.revision
          return undefined
        }
        const revision = current.revision + 1
        const update = db.run(
          `UPDATE canvas_projects SET revision = ?, project_json = ?, updated_at = ?
            WHERE workspace_id = ? AND project_id = ? AND revision = ?`,
          [
            revision,
            input.projectJson,
            new Date().toISOString(),
            input.workspaceId,
            input.projectId,
            current.revision,
          ],
        )
        if (Number(update.changes) !== 1) throw new Error('CanvasStore CAS update did not change exactly one row')
        return Object.freeze({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          revision,
          projectJson: input.projectJson,
        })
      })
      if (missing) {
        throw new CanvasStoreError(
          'NOT_FOUND',
          `canvas project not found: ${input.workspaceId}/${input.projectId}`,
        )
      }
      if (conflict !== undefined) throw new CanvasStoreRevisionConflict(input.expectedRevision, conflict)
      if (result === undefined) throw new CanvasStoreError('IO', 'CanvasStore commit returned no result')
      return result
    } catch (error) {
      if (error instanceof CanvasStoreError) throw error
      throw storeIoError('commit', error)
    }
  }

  async delete(input: DeleteCanvasProjectInput): Promise<boolean> {
    validateWorkspaceId(input.workspaceId)
    validateProjectId(input.projectId)
    validateRevision(input.expectedRevision)
    let conflict: number | undefined
    try {
      const deleted = this.lease.write(db => {
        const current = db.get<{ revision: number }>(
          'SELECT revision FROM canvas_projects WHERE workspace_id = ? AND project_id = ?',
          [input.workspaceId, input.projectId],
        )
        if (current === undefined) return false
        if (current.revision !== input.expectedRevision) {
          conflict = current.revision
          return false
        }
        const result = db.run(
          `DELETE FROM canvas_projects
            WHERE workspace_id = ? AND project_id = ? AND revision = ?`,
          [input.workspaceId, input.projectId, input.expectedRevision],
        )
        if (Number(result.changes) !== 1) throw new Error('CanvasStore CAS delete did not change exactly one row')
        return true
      })
      if (conflict !== undefined) throw new CanvasStoreRevisionConflict(input.expectedRevision, conflict)
      return deleted
    } catch (error) {
      if (error instanceof CanvasStoreError) throw error
      throw storeIoError('delete', error)
    }
  }
}

export function apply(ctx: Context, config: CanvasStoreSqliteConfig = {}): void {
  const lease = ctx.sqliteRuntime.acquire(ctx, {
    owner: 'canvas',
    name: config.databaseName ?? 'canvas',
    scope: { kind: 'project', projectId: config.projectScope ?? 'default' },
    applicationId: CANVAS_STORE_APPLICATION_ID,
    migrations: [
      {
        version: 1,
        name: 'create-development-project-id-only-canvas-projects',
        up(db) {
          db.exec(`CREATE TABLE canvas_projects (
            project_id TEXT PRIMARY KEY,
            revision INTEGER NOT NULL CHECK (revision >= 0),
            project_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT`)
        },
      },
      {
        version: 2,
        name: 'drop-development-v1-and-create-workspace-scoped-canvas-projects',
        up(db) {
          db.exec(`DROP TABLE canvas_projects;
            CREATE TABLE canvas_projects (
              workspace_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              revision INTEGER NOT NULL CHECK (revision >= 0),
              project_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (workspace_id, project_id)
            ) STRICT`)
        },
      },
    ],
  })
  try {
    ctx.provide(CANVAS_STORE_SERVICE, new SqliteCanvasStore(lease))
  } catch (error) {
    lease.close()
    throw error
  }
}

function stored(row: ProjectRow): StoredCanvasProject {
  if (typeof row.workspace_id !== 'string'
    || typeof row.project_id !== 'string'
    || !Number.isSafeInteger(row.revision) || row.revision < 0
    || typeof row.project_json !== 'string') {
    throw new CanvasStoreError('CORRUPT', 'canvas project row is invalid')
  }
  validateWorkspaceId(row.workspace_id)
  validateProjectId(row.project_id)
  validateProjectJson(row.project_json, row.workspace_id, row.project_id, row.revision)
  return Object.freeze({
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    revision: row.revision,
    projectJson: row.project_json,
  })
}

function validateWorkspaceId(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new CanvasStoreError('CORRUPT', 'canvas workspace id must contain 1-128 characters')
  }
}

function validateProjectId(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new CanvasStoreError('CORRUPT', 'canvas project id must contain 1-128 characters')
  }
}

function validateRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CanvasStoreError('CORRUPT', 'canvas expected revision must be a non-negative safe integer')
  }
}

function validateProjectJson(
  value: string,
  workspaceId: string,
  projectId: string,
  revision: number,
): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CanvasStoreError('CORRUPT', 'canvas project JSON must not be empty')
  }
  try {
    const project = parseCanvasProjectJson(value)
    if (project.workspaceId !== workspaceId || project.id !== projectId || project.revision !== revision) {
      throw new CanvasStoreError(
        'CORRUPT',
        `canvas project JSON identity/revision does not match row ${workspaceId}/${projectId}@${String(revision)}`,
      )
    }
  } catch (error) {
    if (error instanceof CanvasStoreError) throw error
    throw new CanvasStoreError('CORRUPT', 'canvas project JSON is not a valid Canvas V2 project', { cause: error })
  }
}

function storeIoError(operation: string, error: unknown): CanvasStoreError {
  if (error instanceof CanvasStoreError) return error
  const closed = error instanceof SqliteRuntimeError
    && (error.code === 'LEASE_CLOSED' || error.code === 'RUNTIME_CLOSED')
  return new CanvasStoreError(
    closed ? 'CLOSED' : 'IO',
    `CanvasStore ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  )
}
