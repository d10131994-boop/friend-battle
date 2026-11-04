import { dataService } from '../core/dataService'
import type { DatabaseRecord } from '../types/database.types'
import type { QueryOptions } from '../types/query.types'

export interface TableRepository<TRecord extends DatabaseRecord> {
  getOne(options?: QueryOptions): Promise<TRecord | null>
  getMany(options?: QueryOptions): Promise<TRecord[]>
  getById(id: string | number): Promise<TRecord | null>
  count(filters?: QueryOptions['filters']): Promise<number>
  create(values: DatabaseRecord): Promise<TRecord>
  createMany(values: DatabaseRecord[]): Promise<TRecord[]>
  update(values: DatabaseRecord, filters: NonNullable<QueryOptions['filters']>): Promise<TRecord[]>
  upsert(values: DatabaseRecord | DatabaseRecord[], onConflict?: string): Promise<TRecord[]>
  delete(filters: NonNullable<QueryOptions['filters']>): Promise<TRecord[]>
}

/**
 * Creates a typed repository for a table.
 *
 * Table names are supplied by feature repositories once the corresponding
 * schema is agreed. The factory does not create or migrate database tables.
 */
export function createRepository<TRecord extends DatabaseRecord>(
  tableName: string,
  idColumn = 'id',
): TableRepository<TRecord> {
  return {
    getOne: (options = {}) => dataService.getOne<TRecord>(tableName, options),
    getMany: (options = {}) => dataService.getMany<TRecord>(tableName, options),
    getById: (id) => dataService.getById<TRecord>(tableName, id, idColumn),
    count: (filters) => dataService.count(tableName, filters),
    create: (values) => dataService.create<TRecord>(tableName, values),
    createMany: (values) => dataService.createMany<TRecord>(tableName, values),
    update: (values, filters) => dataService.update<TRecord>(tableName, values, filters),
    upsert: (values, onConflict) =>
      dataService.upsert<TRecord>(tableName, values, onConflict),
    delete: (filters) => dataService.delete<TRecord>(tableName, filters),
  }
}
