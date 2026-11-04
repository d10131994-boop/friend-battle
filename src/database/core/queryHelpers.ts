import type { DatabaseFilter, DatabaseOrder } from '../types/query.types'

type DynamicFilterQuery = {
  [method: string]: (column: string, value: unknown) => unknown
}

export function applyFilters<TQuery>(
  query: TQuery,
  filters: DatabaseFilter[] = [],
): TQuery {
  let current = query

  for (const filter of filters) {
    const builder = current as unknown as DynamicFilterQuery
    const method = builder[filter.operator]

    if (typeof method !== 'function') {
      throw new Error(`Unsupported database filter: ${filter.operator}`)
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
