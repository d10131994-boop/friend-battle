/**
 * Database operations return their data directly and throw DatabaseError on
 * failure. This keeps call sites simple while preserving a normalized error.
 */
export type Awaitable<T> = T | Promise<T>
