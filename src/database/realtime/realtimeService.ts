import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js'
import { supabaseClient } from '../client/supabaseClient'
import { normalizeDatabaseError } from '../errors/normalizeError'
import type { DatabaseRecord } from '../types/database.types'

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

export interface RealtimeSubscriptionOptions {
  schema?: string
  event?: RealtimeEvent
  filter?: string
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
      const channel = supabaseClient.channel(`database:${options.schema ?? 'public'}:${table}:${crypto.randomUUID()}`)

      return channel
        .on(
          'postgres_changes',
          {
            event: options.event ?? '*',
            schema: options.schema ?? 'public',
            table,
            filter: options.filter,
          },
          callback,
        )
        .subscribe((status, error) => {
          if (error) {
            console.error(
              normalizeDatabaseError(error, `realtime.subscribe:${table}`),
            )
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error(`Realtime subscription failed for table "${table}": ${status}`)
          }
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
