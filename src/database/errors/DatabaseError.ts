export interface DatabaseErrorOptions {
  code?: string
  details?: string
  hint?: string
  operation?: string
  status?: number
  cause?: unknown
}

export class DatabaseError extends Error {
  readonly code: string
  readonly details?: string
  readonly hint?: string
  readonly operation?: string
  readonly status?: number
  override readonly cause?: unknown

  constructor(message: string, options: DatabaseErrorOptions = {}) {
    super(message)
    this.name = 'DatabaseError'
    this.code = options.code ?? 'DATABASE_ERROR'
    this.details = options.details
    this.hint = options.hint
    this.operation = options.operation
    this.status = options.status
    this.cause = options.cause
  }
}
