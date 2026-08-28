export type SqliteRuntimeErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_PATH'
  | 'APPLICATION_ID_MISMATCH'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'MIGRATION_FAILED'
  | 'OWNER_ALREADY_ACQUIRED'
  | 'RUNTIME_CLOSED'
  | 'LEASE_CLOSED'
  | 'TRANSACTION_FAILED'

export class SqliteRuntimeError extends Error {
  constructor(
    readonly code: SqliteRuntimeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SqliteRuntimeError'
  }
}
