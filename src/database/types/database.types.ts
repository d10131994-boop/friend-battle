/**
 * Database schema types are intentionally kept separate from the client API.
 *
 * Once the target PostgreSQL schema is agreed and created, replace the
 * placeholder with generated types from:
 *   supabase gen types typescript --project-id <project-id>
 *
 * The Database module accepts table names generically in the meantime, so its
 * core does not need to be rewritten when the planned tables are introduced.
 */
export type DatabaseTableName = string

export type DatabaseRecord = Record<string, unknown>

export type DatabaseId = string | number
