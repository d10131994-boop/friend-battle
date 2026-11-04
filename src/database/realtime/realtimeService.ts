import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js'
import { supabaseClient } from '../client/supabaseClient'
import { normalizeDatabaseError } from '../errors/normalizeError'
import type { DatabaseRecord } from '../types/database.types'

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

export type RealtimeSubscriptionStatus =
  | 'SUBSCRIBED'
  | 'TIMED_OUT'
  | 'CLOSED'
  | 'CHANNEL_ERROR'

export interface RealtimeSubscriptionOptions {
  schema?: string
  event?: RealtimeEvent
  filter?: string
  /** Receives connection lifecycle updates and the underlying error, when present. */
  onStatus?: (status: RealtimeSubscriptionStatus, error?: Error) => void
}

export type RealtimeCallback = (
  payload: RealtimePostgresChangesPayload<DatabaseRecord>,
) => void

export const realtime = {
  subscribe(
    table: string,
    callback: RealtimeCallback,
    options: RealtimeSubscriptionOptions = {},
  ): RealtimeChannel {
    try {
      if (typeof table !== 'string' || table.trim().length === 0) {
        throw new TypeError('Realtime table name must be a non-empty string.')
      }
      if (typeof callback !== 'function') {
        throw new TypeError('Realtime callback must be a function.')
      }
      if (options.schema !== undefined &&
        (typeof options.schema !== 'string' || options.schema.trim().length === 0)) {
        throw new TypeError('Realtime schema must be a non-empty string when provided.')
      }

      const schema = options.schema ?? 'public'
      const channel = supabaseClient.channel(`database:${schema}:${table}:${crypto.randomUUID()}`)

      return channel
        .on(
          'postgres_changes',
          {
            event: options.event ?? '*',
            schema,
            table,
            filter: options.filter,
          },
          callback,
        )
        .subscribe((status, error) => {
          options.onStatus?.(
            status,
            error
              ? normalizeDatabaseError(error, `realtime.subscribe:${table}`)
              : undefined,
          )
        })
    } catch (error) {
      throw normalizeDatabaseError(error, `realtime.subscribe:${table}`)
    }
  },

  async unsubscribe(channel: RealtimeChannel): Promise<void> {
    try {
      const status = await supabaseClient.removeChannel(channel)
      if (status === 'error') {
        throw new Error('Supabase could not remove the Realtime channel.')
      }
    } catch (error) {
      throw normalizeDatabaseError(error, 'realtime.unsubscribe')
    }
  },
}
