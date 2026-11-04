import type { DatabaseFilter, DatabaseOrder } from '../types/query.types'

type DynamicFilterQuery = {
  [method: string]: (column: string, value: unknown) => unknown
}

const SUPPORTED_FILTER_OPERATORS = new Set<DatabaseFilter['operator']>([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'is',
  'in',
  'contains',
  'containedBy',
  'overlaps',
])

export function applyFilters<TQuery>(
  query: TQuery,
  filters: DatabaseFilter[] = [],
): TQuery {
  if (!Array.isArray(filters)) {
    throw new TypeError('Database filters must be an array.')
  }

  let current = query

  for (const filter of filters) {
    if (
      !filter ||
      typeof filter !== 'object' ||
      typeof filter.column !== 'string' ||
      filter.column.trim().length === 0
    ) {
      throw new TypeError('Each database filter must specify a non-empty column.')
    }

    if (!SUPPORTED_FILTER_OPERATORS.has(filter.operator)) {
      throw new Error(`Unsupported database filter: ${String(filter.operator)}`)
    }

    if (filter.operator === 'in' && !Array.isArray(filter.value)) {
      throw new TypeError('The "in" filter requires an array value.')
    }

    const builder = current as unknown as DynamicFilterQuery
    const method = builder[filter.operator]

    if (typeof method !== 'function') {
      throw new Error(`Database query does not support filter: ${filter.operator}`)
    }

    current = method.call(builder, filter.column, filter.value) as TQuery
  }

  return current
}

export function applyOrder<TQuery>(
  query: TQuery,
  orderBy?: DatabaseOrder | DatabaseOrder[],
): TQuery {
  if (!orderBy) return query

  const orders = Array.isArray(orderBy) ? orderBy : [orderBy]
  let current = query as TQuery & {
    order: (column: string, options: {
      ascending: boolean
      nullsFirst?: boolean
      referencedTable?: string
    }) => unknown
  }

  for (const order of orders) {
    current = current.order(order.column, {
      ascending: order.ascending ?? true,
      nullsFirst: order.nullsFirst,
      referencedTable: order.referencedTable,
    }) as typeof current
  }

  return current
}
