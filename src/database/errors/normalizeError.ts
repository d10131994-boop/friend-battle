import { DatabaseError } from './DatabaseError'
import type { DatabaseErrorOptions } from './DatabaseError'

type ErrorLike = {
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
  status?: unknown
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function normalizeDatabaseError(
  error: unknown,
  operation?: string,
): DatabaseError {
  if (error instanceof DatabaseError) {
    return error
  }

  const source = (typeof error === 'object' && error !== null
    ? error
    : {}) as ErrorLike

  const options: DatabaseErrorOptions = {
    code: asString(source.code),
    details: asString(source.details),
    hint: asString(source.hint),
    operation,
    status: typeof source.status === 'number' ? source.status : undefined,
    cause: error,
  }

  const message =
    asString(source.message) ??
    (error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'An unknown database error occurred.')

  return new DatabaseError(message, options)
}
