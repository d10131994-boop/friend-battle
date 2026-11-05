import { realtime } from '../database'
import type { MultiplayerRoom } from './types'

export type RoomWatcherStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR'
export interface RoomWatcherOptions {
  roomId: string
  getRoom: (roomId: string) => Promise<MultiplayerRoom>
  onRoom: (room: MultiplayerRoom) => void
  onStatus?: (status: RoomWatcherStatus, error?: Error) => void
  onError?: (error: Error) => void
}
export interface RoomWatcher { stop(): Promise<void> }

export const ROOM_BROADCAST_EVENTS = [
  'room_updated', 'player_joined', 'player_updated', 'player_left', 'room_finished',
] as const

/**
 * Watches a private room:<roomId> Broadcast channel. Broadcast payloads are
 * invalidation signals only; canonical room state always comes from getRoom.
 * Install a room-scoped JWT with database.realtime.setAuth() before creating.
 */
export function createRoomWatcher(options: RoomWatcherOptions): RoomWatcher {
  if (typeof options.roomId !== 'string' || options.roomId.trim().length === 0) throw new TypeError('A room ID is required to watch a Multiplayer room.')
  if (typeof options.getRoom !== 'function' || typeof options.onRoom !== 'function') throw new TypeError('Room watcher requires getRoom and onRoom callbacks.')

  let stopped = false
  let inFlight = false
  let refreshQueued = false
  let generation = 0

  const reportError = (error: unknown) => {
    if (!stopped) options.onError?.(error instanceof Error ? error : new Error(String(error)))
  }
  const refresh = async () => {
    if (stopped) return
    if (inFlight) { refreshQueued = true; return }
    inFlight = true
    const currentGeneration = ++generation
    try {
      const room = await options.getRoom(options.roomId)
      if (!stopped && currentGeneration === generation) options.onRoom(room)
    } catch (error) { reportError(error) }
    finally {
      inFlight = false
      if (refreshQueued && !stopped) { refreshQueued = false; void refresh() }
    }
  }

  const channel = realtime.subscribeBroadcast(
    'room:' + options.roomId,
    ROOM_BROADCAST_EVENTS,
    () => { void refresh() },
    {
      private: true,
      onStatus: (status, error) => {
        options.onStatus?.(status, error)
        if (status === 'SUBSCRIBED') void refresh()
      },
    },
  )

  return {
    async stop() {
      if (stopped) return
      stopped = true
      generation += 1
      refreshQueued = false
      await realtime.unsubscribe(channel)
    },
  }
}
