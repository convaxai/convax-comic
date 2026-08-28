import { isAbsolute, join, relative, sep, resolve } from 'node:path'
import type { SqliteAcquireOptions, SqliteRuntimeConfig } from './contract.js'
import { SqliteRuntimeError } from './errors.js'

const SEGMENT = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u

export function resolveSqliteRoot(config: SqliteRuntimeConfig): string {
  const configured = config.dataDir ?? process.env.CONVAX_PROJECTS_HOME
  if (configured === undefined || configured.length === 0) {
    throw new SqliteRuntimeError('INVALID_CONFIG', 'sqliteRuntime requires config.dataDir or CONVAX_PROJECTS_HOME')
  }
  if (!isAbsolute(configured)) {
    throw new SqliteRuntimeError('INVALID_CONFIG', 'sqliteRuntime dataDir must be absolute')
  }
  return resolve(configured)
}

export function sqliteDatabasePath(root: string, options: Pick<SqliteAcquireOptions, 'owner' | 'name' | 'scope'>): string {
  const owner = segment(options.owner, 'owner')
  const name = segment(options.name, 'name')
  const scopeRoot = options.scope.kind === 'product'
    ? join(root, '.product')
    : join(root, segment(options.scope.projectId, 'projectId'))
  const result = join(scopeRoot, '.stores', 'sqlite', owner, `${name}.sqlite3`)
  const relativePath = relative(root, result)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new SqliteRuntimeError('INVALID_PATH', 'resolved SQLite path escapes the product data root')
  }
  return result
}

function segment(value: string, label: string): string {
  if (!SEGMENT.test(value)) {
    throw new SqliteRuntimeError(
      'INVALID_PATH',
      `SQLite ${label} must be a lowercase path-safe segment of 1-64 characters`,
    )
  }
  return value
}
