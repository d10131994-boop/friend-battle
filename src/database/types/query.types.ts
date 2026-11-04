export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'is'
  | 'in'
  | 'contains'
  | 'containedBy'
  | 'overlaps'

export interface DatabaseFilter {
  column: string
  operator: FilterOperator
  value: unknown
}

export interface DatabaseOrder {
  column: string
  ascending?: boolean
  nullsFirst?: boolean
  referencedTable?: string
}

export interface QueryOptions {
  columns?: string
  filters?: DatabaseFilter[]
  orderBy?: DatabaseOrder | DatabaseOrder[]
  /** Maximum number of rows to return. Must be a non-negative safe integer. */
  limit?: number
  /**
   * Zero-based row offset. If used without limit in getMany(), the default
   * page size is 1000. Prefer cursor pagination for large datasets.
   */
  offset?: number
}
