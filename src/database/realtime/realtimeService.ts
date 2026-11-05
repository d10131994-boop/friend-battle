import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabaseClient } from '../client/supabaseClient'
import { normalizeDatabaseError } from '../errors/normalizeError'
import type { DatabaseRecord } from '../types/database.types'

export type RealtimeSubscriptionStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR'
export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'
export type RealtimeBroadcastCallback = (payload: Record<string, unknown>) => void

export interface RealtimeSubscriptionOptions {
  schema?: string
  event?: RealtimeEvent
  filter?: string
  onStatus?: (status: RealtimeSubscriptionStatus, error?: Error) => void
}

export interface RealtimeBroadcastOptions {
  private?: boolean
  onStatus?: (status: RealtimeSubscriptionStatus, error?: Error) => void
}

export type RealtimeCallback = (payload: RealtimePostgresChangesPayload<DatabaseRecord>) => void

function normalizeStatusError(error: Error | undefined, operation: string) {
  return error ? normalizeDatabaseError(error, operation) : undefined
}

function subscribe(table: string, callback: RealtimeCallback, options: RealtimeSubscriptionOptions = {}): RealtimeChannel {
  try {
    if (typeof table !== 'string' || table.trim().length === 0) throw new TypeError('Realtime table name must be a non-empty string.')
    if (typeof callback !== 'function') throw new TypeError('Realtime callback must be a function.')
    if (options.schema !== undefined && (typeof options.schema !== 'string' || options.schema.trim().length === 0)) {
      throw new TypeError('Realtime schema must be a non-empty string when provided.')
    }
    const schema = options.schema ?? 'public'
    const channel = supabaseClient.channel('database:' + schema + ':' + table + ':' + crypto.randomUUID())
    return channel.on('postgres_changes', {
      event: options.event ?? '*', schema, table, filter: options.filter,
    }, callback).subscribe((status, error) => {
      options.onStatus?.(status, normalizeStatusError(error, 'realtime.subscribe:' + table))
    })
  } catch (error) {
    throw normalizeDatabaseError(error, 'realtime.subscribe:' + table)
  }
}

function setAuth(token: string): void {
  if (typeof token !== 'string' || token.trim().length === 0) throw new TypeError('A non-empty Realtime access token is required.')
  try { supabaseClient.realtime.setAuth(token) }
  catch (error) { throw normalizeDatabaseError(error, 'realtime.setAuth') }
}

function subscribeBroadcast(
  topic: string,
  events: readonly string[],
  callback: RealtimeBroadcastCallback,
  options: RealtimeBroadcastOptions = {},
): RealtimeChannel {
  try {
    if (typeof topic !== 'string' || topic.trim().length === 0) throw new TypeError('Realtime Broadcast topic must be a non-empty string.')
    if (!Array.isArray(events) || events.length === 0 || events.some((event) => typeof event !== 'string' || event.trim().length === 0)) {
      throw new TypeError('At least one non-empty Broadcast event name is required.')
    }
    if (typeof callback !== 'function') throw new TypeError('Realtime Broadcast callback must be a function.')
    let channel = supabaseClient.channel(topic, { config: { private: options.private ?? true } })
    for (const event of new Set(events)) {
      channel = channel.on('broadcast', { event }, ({ payload }) => callback(payload as Record<string, unknown>))
    }
    return channel.subscribe((status, error) => {
      options.onStatus?.(status, normalizeStatusError(error, 'realtime.broadcast:' + topic))
    })
  } catch (error) {
    throw normalizeDatabaseError(error, 'realtime.broadcast:' + topic)
  }
}

async function unsubscribe(channel: RealtimeChannel): Promise<void> {
  try {
    const status = await supabaseClient.removeChannel(channel)
    if (status === 'error') throw new Error('Supabase could not remove the Realtime channel.')
  } catch (error) {
    throw normalizeDatabaseError(error, 'realtime.unsubscribe')
  }
}

export const realtime = { subscribe, unsubscribe, setAuth, subscribeBroadcast }
