import { supabaseClient } from '../client/supabaseClient'
import { normalizeDatabaseError } from '../errors/normalizeError'
import type { DatabaseRecord } from '../types/database.types'
import type { QueryOptions } from '../types/query.types'
import { applyFilters, applyOrder } from './queryHelpers'

function withErrorHandling<T>(operation: string, action: () => Promise<T>): Promise<T> {
  return action().catch((error: unknown) => {
    throw normalizeDatabaseError(error, operation)
  })
}

export const dataService = {
  async getOne<TRecord extends DatabaseRecord = DatabaseRecord>(
    table: string,
    options: QueryOptions = {},
  ): Promise<TRecord | null> {
    return withErrorHandling(`getOne:${table}`, async () => {
      let query = supabaseClient.from(table).select(options.columns ?? '*')
      query = applyFilters(query, options.filters)
      const { data, error } = await query.maybeSingle()
      if (error) throw error
      return data as TRecord | null
    })
  },

  async getById<TRecord extends DatabaseRecord = DatabaseRecord>(
    table: string,
    id: string | number,
    idColumn = 'id',
    columns = '*',
  ): Promise<TRecord | null> {
    return this.getOne<TRecord>(table, {
      columns,
      filters: [{ column: idColumn, operator: 'eq', value: id }],
    })
  },

  async getMany<TRecord extends DatabaseRecord = DatabaseRecord>(
    table: string,
    options: QueryOptions = {},
  ): Promise<TRecord[]> {
    return withErrorHandling(`getMany:${table}`, async () => {
      let query = supabaseClient.from(table).select(options.columns ?? '*')
      query = applyFilters(query, options.filters)
      query = applyOrder(query, options.orderBy)

      if (options.offset !== undefined && options.limit !== undefined) {
        query = query.range(options.offset, options.offset + options.limit - 1)
      } else if (options.offset !== undefined) {
        query = query.range(options.offset, options.offset + 999)
      } else if (options.limit !== undefined) {
        query = query.limit(options.limit)
      }

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as TRecord[]
    })
  },

  async count(
    table: string,
    filters: QueryOptions['filters'] = [],
  ): Promise<number> {
    return withErrorHandling(`count:${table}`, async () => {
      let query = supabaseClient.from(table).select('*', {
        count: 'exact',
        head: true,
      })
      query = applyFilters(query, filters)
      const { count, error } = await query
      if (error) throw error
      return count ?? 0
    })
  },

  async create<TRecord extends DatabaseRecord = DatabaseRecord>(
    table: string,
    values: DatabaseRecord,
  ): Promise<TRecord> {
    return withErrorHandling(`create:${table}`, async () => {
      const { data, error } = await supabaseClient
        .from(table)
        .insert(values)
        .select()
        .single()
      if (error) throw error
      return data as TRecord
    })
  },

  async createMany<TRecord extends DatabaseRecord = DatabaseRecord>(
    table: string,
    values: DatabaseRecord[],
  ): Promise<TRecord[]> {
    return withErrorHandling(`createMany:${table}`, async () => {
      const { data, error } = await supabaseClient
        .from(table)
        .insert(values)
        .select()
      if (error) throw error
      return (data ?? []) as TRecord[]
    })
  },

  async update<TRecord extends DatabaseRecord = DatabaseRecord>(
    table: string,
    values: DatabaseRecord,
    filters: NonNullable<QueryOptions['filters']>,
  ): Promise<TRecord[]> {
    if (filters.length === 0) {
      throw normalizeDatabaseError(
        new Error('Update requires at least one filter to prevent an accidental full-table update.'),
        `update:${table}`,
      )
    }

    return withErrorHandling(`update:${table}`, async () => {
      let query = supabaseClient.from(table).update(values)
      query = applyFilters(query, filters)
      const { data, error } = await query.select()
      if (error) throw error
      return (data ?? []) as TRecord[]
    })
  },

  async upsert<TRecord extends DatabaseRecord = DatabaseRecord>(
    table: string,
    values: DatabaseRecord | DatabaseRecord[],
    onConflict?: string,
  ): Promise<TRecord[]> {
    return withErrorHandling(`upsert:${table}`, async () => {
      const { data, error } = await supabaseClient
        .from(table)
        .upsert(values, { onConflict })
        .select()
      if (error) throw error
      return (data ?? []) as TRecord[]
    })
  },

  async delete<TRecord extends DatabaseRecord = DatabaseRecord>(
    table: string,
    filters: NonNullable<QueryOptions['filters']>,
  ): Promise<TRecord[]> {
    if (filters.length === 0) {
      throw normalizeDatabaseError(
        new Error('Delete requires at least one filter to prevent an accidental full-table delete.'),
        `delete:${table}`,
      )
    }

    return withErrorHandling(`delete:${table}`, async () => {
      let query = supabaseClient.from(table).delete()
      query = applyFilters(query, filters)
      const { data, error } = await query.select()
      if (error) throw error
      return (data ?? []) as TRecord[]
    })
  },
}
