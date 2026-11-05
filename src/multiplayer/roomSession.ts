import { realtime } from '../database'
import type {
  MultiplayerAuth,
  MultiplayerRoom,
  MultiplayerRoomToken,
  MultiplayerService,
} from './types'
import { createRoomWatcher, type RoomWatcher, type RoomWatcherStatus } from './roomWatcher'

const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000
const HEARTBEAT_INTERVAL_MS = 30 * 1000
const TOKEN_CHECK_INTERVAL_MS = 30 * 1000

const roomTokenCache = new Map<string, MultiplayerRoomToken>()
let activeSession: symbol | null = null

export interface MultiplayerRoomSessionOptions {
  roomId: string
  auth: MultiplayerAuth
  service: MultiplayerService
  onRoom: (room: MultiplayerRoom) => void
  onStatus?: (status: RoomWatcherStatus, error?: Error) => void
  onError?: (error: Error) => void
}

export interface MultiplayerRoomSession {
  start(): Promise<void>
  stop(): Promise<void>
  isActive(): boolean
}

/**
 * Owns the one active room's Realtime JWT, heartbeat, and room watcher.
 * JWTs are cached in memory by room ID and are never persisted to storage.
 */
export function createMultiplayerRoomSession(
  options: MultiplayerRoomSessionOptions,
): MultiplayerRoomSession {
  if (!options.roomId.trim()) throw new TypeError('A room ID is required.')
  if (!options.auth.initData.trim()) throw new TypeError('Telegram initData is required.')

  let started = false
  let stopped = false
  let watcher: RoomWatcher | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let tokenTimer: ReturnType<typeof setInterval> | null = null
  let heartbeatInFlight = false
  let tokenRefreshInFlight = false
  const sessionId = Symbol('multiplayer-room-session')

  const reportError = (error: unknown) => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)))
  }

  const getCachedToken = (): MultiplayerRoomToken | null => {
    const token = roomTokenCache.get(options.roomId)
    if (!token) return null
    if (Date.parse(token.expiresAt) <= Date.now()) {
      roomTokenCache.delete(options.roomId)
      return null
    }
    return token
  }

  const installToken = (token: MultiplayerRoomToken) => {
    roomTokenCache.set(options.roomId, token)
    realtime.setAuth(token.accessToken)
  }

  const refreshTokenIfNeeded = async (force = false) => {
    if (stopped || tokenRefreshInFlight) return
    const current = getCachedToken()
    if (!force && current && Date.parse(current.expiresAt) - Date.now() > TOKEN_REFRESH_WINDOW_MS) {
      return
    }

    tokenRefreshInFlight = true
    try {
      const next = await options.service.getRoomToken(options.auth, { roomId: options.roomId })
      if (!stopped) installToken(next)
    } catch (error) {
      reportError(error)
    } finally {
      tokenRefreshInFlight = false
    }
  }

  const sendHeartbeat = async () => {
    if (stopped || heartbeatInFlight) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    heartbeatInFlight = true
    try {
      await options.service.heartbeat(options.auth, { roomId: options.roomId })
    } catch (error) {
      reportError(error)
    } finally {
      heartbeatInFlight = false
    }
  }

  const stopTimers = () => {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
    if (tokenTimer !== null) clearInterval(tokenTimer)
    heartbeatTimer = null
    tokenTimer = null
  }

  const stop = async () => {
    if (stopped) return
    stopped = true
    stopTimers()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    if (watcher) {
      const currentWatcher = watcher
      watcher = null
      await currentWatcher.stop()
    }
    if (activeSession === sessionId) activeSession = null
  }

  const onVisibilityChange = () => {
    if (stopped || typeof document === 'undefined' || document.visibilityState === 'hidden') return
    void sendHeartbeat()
    void refreshTokenIfNeeded()
  }

  const handleRoom = (room: MultiplayerRoom) => {
    options.onRoom(room)
    if (room.status === 'finished' || room.status === 'cancelled') {
      void stop()
    }
  }

  return {
    async start() {
      if (started) return
      if (stopped) throw new Error('A stopped Multiplayer room session cannot be restarted.')
      if (activeSession !== null && activeSession !== sessionId) {
        throw new Error('Only one Multiplayer room can be active on the shared Realtime client.')
      }

      activeSession = sessionId
      started = true
      try {
        const cached = getCachedToken()
        if (cached && Date.parse(cached.expiresAt) - Date.now() > TOKEN_REFRESH_WINDOW_MS) {
          installToken(cached)
        } else {
          await refreshTokenIfNeeded(true)
          const availableToken = getCachedToken()
          if (!availableToken) throw new Error('Не удалось получить действующий токен комнаты.')
          // If refresh failed but the cached token is still valid, install it as a fallback.
          installToken(availableToken)
        }

        if (stopped) return

        watcher = createRoomWatcher({
          roomId: options.roomId,
          getRoom: (roomId) => options.service.getRoom(options.auth, { roomId }),
          onRoom: handleRoom,
          onStatus: options.onStatus,
          onError: reportError,
        })

        await sendHeartbeat()
        heartbeatTimer = setInterval(() => { void sendHeartbeat() }, HEARTBEAT_INTERVAL_MS)
        tokenTimer = setInterval(() => { void refreshTokenIfNeeded() }, TOKEN_CHECK_INTERVAL_MS)
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', onVisibilityChange)
        }
      } catch (error) {
        await stop()
        throw error
      }
    },
    stop,
    isActive: () => started && !stopped,
  }
}
